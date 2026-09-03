/**
 * Phase 2 — Document Intelligence Selective Semantic Search (M2B).
 *
 * Implements cost-controlled, lazy/selective semantic retrieval for document chunks:
 *   1. Representative Chunk Selection: Introduction + Section Headings + Density + Stratified Page Spread.
 *   2. Versioned Idempotency: reuses existing chunk embeddings matching model & version ($0 AI).
 *   3. Lazy On-Demand Embedding: only computes embeddings when semantic expansion is genuinely needed.
 *   4. Safe Persistence: saves computed vectors back to `memory_chunks` for future $0 reuse.
 *   5. Failure Resilience: graceful degradation to lexical search if AI fails or times out.
 *
 * All operations respect strict PostgreSQL RLS (`user_id = auth.uid()`).
 * Results are aggregated at the parent document level — user sees ONE Memory, never chunks.
 */

import { createClient } from '@/lib/supabase/server';
import { getAIService } from '@/lib/ai';
import { AI_CONFIG } from '@/lib/config';
import type { MemoryChunk } from '@/types/database';
import type { AIService } from '@/lib/ai/types';

export const EMBEDDING_VERSION = 'v1';
export const EMBEDDING_MODEL = AI_CONFIG.openRouter.embeddingModel;
export const MAX_REPRESENTATIVE_CHUNKS = 8;
export const CHUNK_SIMILARITY_THRESHOLD = 0.35;

/** Compute vector cosine similarity between two float arrays. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Check if a chunk already has a fresh embedding matching current model and version. */
export function isChunkEmbeddingFresh(
  chunk: Pick<MemoryChunk, 'embedding' | 'embedding_model' | 'embedding_version'> | null | undefined,
  targetModel = EMBEDDING_MODEL,
  targetVersion = EMBEDDING_VERSION,
): boolean {
  if (!chunk || !chunk.embedding) return false;
  if (Array.isArray(chunk.embedding) && chunk.embedding.length === 0) return false;
  return (
    chunk.embedding_model === targetModel &&
    chunk.embedding_version === targetVersion
  );
}

/**
 * Select representative chunks covering the entire structure of a document:
 *  - Introduction / Title page (Chunk 0)
 *  - Explicit section headings / clauses (e.g. "Termination", "Payment")
 *  - High information-density chunks (highest word counts)
 *  - Stratified page distribution (spread across pages 1..N to cover deep pages like Page 47)
 *
 * Avoids blindly taking only the first N chunks.
 */
export function selectRepresentativeChunks(
  chunks: MemoryChunk[],
  maxCount = MAX_REPRESENTATIVE_CHUNKS,
): MemoryChunk[] {
  if (chunks.length <= maxCount) return chunks;

  const selectedIndices = new Set<number>();

  // 1. Always include the document intro/start
  selectedIndices.add(0);

  // 2. Chunks with distinct section titles
  const withSections = chunks.filter((c) => Boolean(c.section_title && c.section_title.trim()));
  for (const c of withSections) {
    if (selectedIndices.size >= maxCount - 2) break;
    selectedIndices.add(c.chunk_index);
  }

  // 3. Stratified page spread: ensure deep pages (middle and end) are sampled
  const pages = Array.from(new Set(chunks.map((c) => c.page_number).filter((p): p is number => p !== null)));
  if (pages.length > 2) {
    const minPage = Math.min(...pages);
    const maxPage = Math.max(...pages);
    const midPage = Math.floor((minPage + maxPage) / 2);
    const deepPage = Math.floor(minPage + (maxPage - minPage) * 0.9); // ~90% deep (e.g. page 45-47)

    const midChunk = chunks.find((c) => c.page_number === midPage);
    if (midChunk) selectedIndices.add(midChunk.chunk_index);

    const deepChunk = chunks.find((c) => c.page_number === deepPage || c.page_number === maxPage - 3);
    if (deepChunk) selectedIndices.add(deepChunk.chunk_index);
  }

  // 4. Fill remaining slots with the highest information density chunks
  const byDensity = [...chunks].sort((a, b) => (b.word_count ?? 0) - (a.word_count ?? 0));
  for (const c of byDensity) {
    if (selectedIndices.size >= maxCount) break;
    selectedIndices.add(c.chunk_index);
  }

  // Assemble selected chunks sorted by original chunk_index
  return chunks
    .filter((c) => selectedIndices.has(c.chunk_index))
    .sort((a, b) => a.chunk_index - b.chunk_index)
    .slice(0, maxCount);
}

/**
 * Ensure candidate chunks have embeddings, generating and persisting them lazily.
 * Version-checked and idempotent: identical model/version costs $0 AI.
 */
export async function ensureChunkEmbeddings(
  supabase: ReturnType<typeof createClient>,
  chunks: MemoryChunk[],
  ai: AIService,
): Promise<MemoryChunk[]> {
  if (!ai.enabled) return chunks;

  const resultChunks = [...chunks];
  const toEmbed: { index: number; chunk: MemoryChunk }[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (!c) continue;

    // If embedding is stored as text (e.g. from pgvector string format "[0.1, 0.2]"), parse it
    if (typeof c.embedding === 'string') {
      try {
        c.embedding = JSON.parse(c.embedding as unknown as string);
      } catch {
        c.embedding = null;
      }
    }

    if (!isChunkEmbeddingFresh(c)) {
      toEmbed.push({ index: i, chunk: c });
    }
  }

  if (toEmbed.length === 0) {
    return resultChunks; // Already fresh, zero AI cost ($0)
  }

  // Compute embeddings sequentially/safely to respect provider rate limits
  for (const item of toEmbed) {
    try {
      const vector = await ai.embed({ text: item.chunk.chunk_text });
      if (vector && vector.length > 0) {
        item.chunk.embedding = vector;
        item.chunk.embedding_model = EMBEDDING_MODEL;
        item.chunk.embedding_version = EMBEDDING_VERSION;
        resultChunks[item.index] = item.chunk;

        // Persist vector back to DB asynchronously for future $0 reuse
        await supabase
          .from('memory_chunks')
          .update({
            embedding: JSON.stringify(vector),
            embedding_model: EMBEDDING_MODEL,
            embedding_version: EMBEDDING_VERSION,
          } as Record<string, unknown>)
          .eq('id', item.chunk.id);
      }
    } catch (err) {
      console.warn('[semantic] chunk embedding failure for chunk:', item.chunk.id, err);
      // Graceful degradation: failure on one chunk does not abort the search
    }
  }

  return resultChunks;
}

/**
 * Selective Chunk Semantic Search:
 * Evaluates candidate documents and representative chunks against the query vector.
 *
 * Returns distinct parent `memory_id`s ranked by chunk similarity.
 */
export async function selectiveChunkSemanticSearch(
  supabase: ReturnType<typeof createClient>,
  query: string,
  candidateDocIds: string[],
  limit = 10,
): Promise<string[]> {
  const ai = getAIService();
  if (!ai.enabled) return [];

  try {
    // 1. Embed query (reused across candidates)
    const queryVector = await ai.embed({ text: query });
    if (!queryVector || queryVector.length === 0) return [];

    // 2. Load chunks for candidate documents
    let queryBuilder = supabase
      .from('memory_chunks')
      .select('id, memory_id, user_id, chunk_index, page_number, section_title, chunk_text, chunk_hash, word_count, embedding, embedding_model, embedding_version, created_at')
      .order('chunk_index', { ascending: true });

    if (candidateDocIds.length > 0) {
      queryBuilder = queryBuilder.in('memory_id', candidateDocIds);
    } else {
      // If no initial candidate docs, sample chunks from the user's document memories (capped at 50)
      queryBuilder = queryBuilder.limit(50);
    }

    const { data: rawChunks, error: chunkErr } = await queryBuilder;
    if (chunkErr || !rawChunks || rawChunks.length === 0) return [];

    const allChunks = rawChunks as MemoryChunk[];

    // 3. Group by parent memory_id
    const byMemory = new Map<string, MemoryChunk[]>();
    for (const chunk of allChunks) {
      const list = byMemory.get(chunk.memory_id) ?? [];
      list.push(chunk);
      byMemory.set(chunk.memory_id, list);
    }

    // 4. Select representative chunks per document
    const representativeChunks: MemoryChunk[] = [];
    for (const [, docChunks] of byMemory) {
      const selected = selectRepresentativeChunks(docChunks, MAX_REPRESENTATIVE_CHUNKS);
      representativeChunks.push(...selected);
    }

    // 5. Ensure representative chunks have valid embeddings (idempotent, versioned)
    const embeddedChunks = await ensureChunkEmbeddings(supabase, representativeChunks, ai);

    // 6. Score candidate documents by best matching representative chunk
    const memoryScores = new Map<string, number>();

    for (const chunk of embeddedChunks) {
      if (!chunk.embedding || !Array.isArray(chunk.embedding)) continue;
      const sim = cosineSimilarity(queryVector, chunk.embedding);
      if (sim >= CHUNK_SIMILARITY_THRESHOLD) {
        const currentBest = memoryScores.get(chunk.memory_id) ?? 0;
        if (sim > currentBest) {
          memoryScores.set(chunk.memory_id, sim);
        }
      }
    }

    // 7. Return parent memory IDs sorted by similarity
    return Array.from(memoryScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([mid]) => mid);
  } catch (err) {
    console.error('[semantic] selectiveChunkSemanticSearch error:', err);
    return []; // Best-effort: failures never break search
  }
}
