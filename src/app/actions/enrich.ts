'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getMemory } from '@/lib/memories/queries';
import { getAIService } from '@/lib/ai';
import { STORAGE_BUCKET } from '@/lib/config';

/**
 * Phase 2 — invisible intelligence.
 *
 * enrichImageMemory runs AFTER an image is saved, from a separate request the
 * capture UI fires without awaiting. This keeps the promise that AI NEVER
 * blocks or breaks capture: if the provider is disabled, slow, or errors, the
 * memory is already safely stored and this function simply does nothing.
 *
 * Idempotency: if text_content AND embedding both already exist, this is a
 * no-op. Re-enriching the same image twice costs nothing (fixes G5 / P5).
 *
 * Single-fetch: both OCR and description are run against ONE fetched image
 * copy (fixes G2 / P4 — eliminates the double network fetch).
 */
export async function enrichImageMemory(memoryId: string): Promise<void> {
  try {
    const ai = getAIService();
    if (!ai.enabled) return; // disabled/unconfigured → no-op, no cost.

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // RLS-guarded read; also mints a short-lived signed URL the model can fetch.
    const memory = await getMemory(memoryId);
    if (!memory || memory.type !== 'image' || !memory.fileUrl) return;

    // Idempotency check: if this memory was already fully enriched, skip.
    // "Fully enriched" means both a description/OCR text and an embedding exist.
    // This prevents duplicate AI calls when the action is fired more than once
    // (e.g. CaptureButton + /share firing in the same session).
    if (memory.text_content && memory.embedding) {
      console.info('[enrich] image already enriched, skipping:', memoryId);
      return;
    }

    const userNote = memory.text_content?.trim() ?? '';

    // Single image fetch: OCR + description in parallel, one network request (fixes P4).
    const analysis = await ai.ocrAndDescribeImage({ fileUrl: memory.fileUrl });
    const { description, ocrText } = analysis;

    // Preserve the user's own note first, then append what the model saw.
    const parts = [userNote, description, ocrText].filter(Boolean);
    const combined = Array.from(new Set(parts)).join('\n\n').trim();

    // The text we index (lexical) and embed (semantic). Fall back to the note.
    const searchText = combined || userNote;

    const update: { text_content?: string; embedding?: string } = {};
    if (combined && combined !== userNote) update.text_content = combined;

    // Semantic fingerprint for meaning-based search (best-effort, independent):
    if (searchText) {
      try {
        const vector = await ai.embed({ text: searchText });
        if (vector.length > 0) update.embedding = JSON.stringify(vector);
      } catch {
        // Embeddings are optional; lexical search still works without them.
      }
    }

    // Nothing new to store (no text change and no embedding) → leave as-is.
    if (Object.keys(update).length === 0) return;

    const { error: updateError } = await supabase.from('memories').update(update).eq('id', memoryId);
    if (updateError) {
      console.error('[enrich] failed to update image memory:', memoryId, updateError);
    } else {
      revalidatePath('/');
      revalidatePath(`/memory/${memoryId}`);
    }
  } catch {
    // Best-effort by design: never surface an error — capture already succeeded.
  }
}

/**
 * Phase 2 — invisible intelligence for text, links, and documents.
 *
 * Computes and stores a 1536-dimensional semantic embedding for newly created
 * notes, links, and documents so they are immediately discoverable via meaning-based
 * hybrid search without waiting for an offline batch backfill.
 *
 * Idempotency: skips if embedding already exists (no content change detected).
 */
export async function enrichGenericMemory(memoryId: string): Promise<void> {
  try {
    const ai = getAIService();
    if (!ai.enabled) return;

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const memory = await getMemory(memoryId);
    if (!memory || memory.type === 'image' || memory.embedding) return;

    const searchableParts = [memory.title, memory.text_content, memory.url].filter(Boolean);
    const searchText = searchableParts.join('\n').trim();
    if (!searchText) return;

    const vector = await ai.embed({ text: searchText });
    if (vector.length > 0) {
      const { error } = await supabase
        .from('memories')
        .update({ embedding: JSON.stringify(vector) })
        .eq('id', memoryId);

      if (error) {
        console.error('[enrich] failed to update generic memory embedding:', memoryId, error);
      } else {
        revalidatePath('/');
        revalidatePath(`/memory/${memoryId}`);
      }
    }
  } catch {
    // Best-effort by design: never surface errors.
  }
}

/**
 * Phase 2 — Document Intelligence.
 *
 * Extracts text content from supported documents (PDF, DOCX, TXT, MD) using
 * deterministic server-side parsing — NO AI call for the extraction itself.
 *
 * Pipeline:
 *   1. Check if already extracted (idempotency via content_hash).
 *   2. Download file from private Storage.
 *   3. Extract text via pdf-parse / mammoth / raw UTF-8.
 *   4. Normalize and truncate to searchable representation.
 *   5. Update memories.text_content + set extraction_status = 'done'.
 *   6. Generate and store embedding (one AI embed call, best-effort).
 *
 * The user's original file is never modified. If extraction fails, the memory
 * remains usable and the original file is intact.
 */
import { extractDocument } from '@/lib/documents/extract';
import { chunkDocument } from '@/lib/documents/chunking';
import { computeSha256, isExtractionFresh, PARSER_VERSION } from '@/lib/documents/identity';

/**
 * Phase 2 — Document Intelligence Foundation (M2A).
 *
 * Extracts text content from supported documents (PDF, DOCX, TXT, MD) using
 * deterministic server-side parsing — ZERO AI cost.
 *
 * Pipeline:
 *   1. Identity check (SHA-256 file_hash + parser_version): skips if unchanged.
 *   2. Download original file bytes from private Storage.
 *   3. Extract text respecting page boundaries (PDF) and headings (MD/DOCX).
 *   4. Structure-aware chunking (page -> section -> paragraph -> sentence).
 *   5. Deterministic atomic storage into `memory_chunks` table ($0 AI).
 *   6. Full-text search (FTS) index generated automatically in PostgreSQL via GIN.
 *   7. Update parent memory with content identity, chunk count, and a short preview.
 *
 * Failure resilience:
 *   - Original file in Storage is never touched or modified.
 *   - Parent Memory remains usable and downloadable.
 *   - extraction_status recorded as 'failed' with safe diagnostic error message.
 *   - Retrying is safe and idempotent (deletes old chunks before inserting new).
 */
export async function enrichDocumentMemory(memoryId: string): Promise<void> {
  const supabase = createClient();
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const memory = await getMemory(memoryId);
    if (!memory || memory.type !== 'document') return;
    if (!memory.file) return;

    // Download the file from private Storage.
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(memory.file.storage_path);

    if (downloadError || !fileData) {
      console.error('[enrich] failed to download document:', memoryId, downloadError);
      await supabase
        .from('memories')
        .update({
          extraction_status: 'failed',
          extraction_error: 'Failed to retrieve file from storage',
        } as Record<string, unknown>)
        .eq('id', memoryId);
      return;
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileHash = computeSha256(buffer);

    // Idempotency: if file_hash and parser_version match and chunks exist, skip entirely ($0 work).
    if (
      isExtractionFresh(fileHash, memory.file_hash, memory.parser_version) &&
      memory.extraction_status === 'done' &&
      (memory.chunk_count ?? 0) > 0
    ) {
      console.info('[enrich] document extraction is fresh and up-to-date, skipping:', memoryId);
      return;
    }

    // Set status to pending
    await supabase
      .from('memories')
      .update({ extraction_status: 'pending' } as Record<string, unknown>)
      .eq('id', memoryId);

    // Deterministic text extraction — no AI call ($0 AI)
    const extracted = await extractDocument(
      buffer,
      memory.file.file_type ?? '',
      memory.file.file_name,
    );

    if (!extracted.rawText.trim()) {
      // Empty text: distinguish between parser failures (password / corrupted) vs scanned (no text layer)
      const isExplicitFailure = Boolean(extracted.errorReason);
      await supabase
        .from('memories')
        .update({
          file_hash: extracted.fileHash,
          content_hash: extracted.contentHash,
          parser_version: PARSER_VERSION,
          extraction_status: isExplicitFailure ? 'failed' : 'skipped',
          extraction_error: extracted.errorReason || 'Scanned document with no text layer (OCR required)',
          chunk_count: 0,
        } as Record<string, unknown>)
        .eq('id', memoryId);
      return;
    }

    // Structure-aware chunking ($0 AI)
    const chunks = chunkDocument(extracted);

    // Deterministic replacement into memory_chunks
    try {
      // Delete old chunks for this memory so retries never create duplicate records
      await supabase.from('memory_chunks').delete().eq('memory_id', memoryId);

      if (chunks.length > 0) {
        const chunkRows = chunks.map((c) => ({
          memory_id: memoryId,
          user_id: user.id,
          chunk_index: c.chunkIndex,
          page_number: c.pageNumber ?? null,
          section_title: c.sectionTitle ?? null,
          chunk_text: c.chunkText,
          chunk_hash: c.chunkHash,
          word_count: c.wordCount,
        }));
        await supabase.from('memory_chunks').insert(chunkRows);
      }
    } catch (chunkErr) {
      console.warn('[enrich] memory_chunks insert note (table may not be migrated yet):', chunkErr);
    }

    // Storage discipline: do NOT store 50 pages into memories.text_content!
    // Store only the user note plus a brief preview (first ~500 chars).
    const userNote = (memory.text_content ?? '').trim();
    const rawPreview = extracted.rawText.slice(0, 500).trim();
    let combinedPreview = userNote ? `${userNote}\n\n${rawPreview}` : rawPreview;

    const ai = getAIService();

    // AI Document Understanding: if AI is available, generate clean entities & summary
    // to bridge raw PDF glyph artifacts and ensure immediate lexical hits on terms like "حوالة"
    if (ai.enabled && ai.summarizeDocument) {
      try {
        const summary = await ai.summarizeDocument({
          fileName: memory.file.file_name,
          rawText: extracted.rawText,
        });
        if (summary) {
          combinedPreview = userNote ? `${userNote}\n\n${summary}` : summary;
        }
      } catch (sumErr) {
        console.warn('[enrich] document summary note (raw text preserved):', sumErr);
      }
    }

    const updatePayload: Record<string, unknown> = {
      text_content: combinedPreview || null,
      file_hash: extracted.fileHash,
      content_hash: extracted.contentHash,
      parser_version: extracted.parserVersion,
      chunk_count: chunks.length,
      extraction_status: 'done',
      extraction_error: null,
    };

    // Semantic fingerprint for meaning-based hybrid search on documents:
    if (ai.enabled) {
      try {
        const textToEmbed = [memory.file.file_name, combinedPreview, extracted.rawText.slice(0, 1500)]
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 4000);
        if (textToEmbed.trim()) {
          const vector = await ai.embed({ text: textToEmbed });
          if (vector.length > 0) {
            updatePayload.embedding = JSON.stringify(vector);
          }
        }
      } catch (embedErr) {
        console.warn('[enrich] document embedding warning (lexical search still works):', embedErr);
      }
    }

    const { error: updateError } = await supabase
      .from('memories')
      .update(updatePayload)
      .eq('id', memoryId);

    if (updateError) {
      console.error('[enrich] failed to save document metadata:', memoryId, updateError);
    } else {
      revalidatePath('/');
      revalidatePath(`/memory/${memoryId}`);
    }
  } catch (err) {
    console.error('[enrich] document enrichment error for:', memoryId, err);
    try {
      await supabase
        .from('memories')
        .update({
          extraction_status: 'failed',
          extraction_error: err instanceof Error ? err.message.slice(0, 200) : 'Processing failed',
        } as Record<string, unknown>)
        .eq('id', memoryId);
    } catch {
      // Ignore fallback error
    }
  }
}

/**
 * Retry or reprocess document extraction for a specific memory.
 */
export async function reprocessDocumentMemory(memoryId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'Unauthorized' };

    // Reset status to pending so UI reflects immediate progress
    await supabase
      .from('memories')
      .update({ extraction_status: 'pending', extraction_error: null } as Record<string, unknown>)
      .eq('id', memoryId);

    revalidatePath('/');
    revalidatePath(`/memory/${memoryId}`);

    // Trigger background extraction
    void enrichDocumentMemory(memoryId);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Reprocess failed' };
  }
}
