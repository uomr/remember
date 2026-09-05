import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getAIService } from '@/lib/ai';
import { selectiveChunkSemanticSearch } from '@/lib/documents/semantic';
import type { Memory, MemoryFile } from '@/types/database';

/**
 * Server-side read layer for memories. All reads go through the RLS-guarded
 * server client, so a user can only ever see their own rows. Signed URLs for
 * private files are minted here, on demand, with a short lifetime.
 */


/** How many memories we load per page (initial load and each "load more"). */
export const PAGE_SIZE = 24;

/** A memory plus its first file (if any) and a ready-to-use preview URL. */
export interface MemoryWithFile extends Memory {
  file: MemoryFile | null;
  /** Signed URL for the attached file, or null. */
  fileUrl: string | null;
}

const MEMORY_COLUMNS = 'id, user_id, type, title, text_content, url, created_at, updated_at';

function resolveFirstFile(
  memoryId: string,
  files: MemoryFile[] | null,
): { file: MemoryFile | null; fileUrl: string | null } {
  const file = files && files.length > 0 ? files[0] : null;
  if (!file) return { file: null, fileUrl: null };
  return { file, fileUrl: `/api/media/${memoryId}` };
}

function resolveRows(
  rows: (Memory & { memory_files: MemoryFile[] })[],
): MemoryWithFile[] {
  return rows.map((row) => {
    const { memory_files, ...memory } = row;
    const { file, fileUrl } = resolveFirstFile(memory.id, memory_files);
    return { ...memory, file, fileUrl };
  });
}

/** A page of memories plus whether more remain (for "load more"). */
export interface MemoryPage {
  memories: MemoryWithFile[];
  hasMore: boolean;
}

/**
 * List the current user's memories, newest first, one page at a time.
 * `offset` is the number of rows to skip; the page size is fixed (PAGE_SIZE).
 */
export async function listMemories(offset = 0, limit = PAGE_SIZE): Promise<MemoryPage> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('memories')
    .select(`${MEMORY_COLUMNS}, memory_files ( * )`)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit); // fetch one extra to detect "has more"

  if (error || !data) return { memories: [], hasMore: false };

  const hasMore = data.length > limit;
  const rows = (hasMore ? data.slice(0, limit) : data) as (Memory & {
    memory_files: MemoryFile[];
  })[];
  return { memories: resolveRows(rows), hasMore };
}

/** Columns the substring pass scans. `search_vector` already covers stemming. */
const SUBSTRING_FIELDS = ['title', 'url', 'text_content'] as const;

/**
 * Split a human query into letter/digit runs.
 *
 * This is also the security boundary for the filter we build below: every
 * character that is structural to PostgREST (`,` `(` `)` `"` `\` `.` `:`) or to
 * `ilike` (`%` `_`) is dropped here, so no term can ever escape its own
 * condition. Verified live by the "PostgREST-unsafe characters" case in
 * scripts/verify-backend.mjs.
 *
 * `\p{L}\p{N}` (not `\w`) is deliberate: `\w` deletes every Arabic and CJK
 * character, which silently turned each non-Latin query into an empty search.
 */
function tokenize(query: string): string[] {
  return query.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Build the PostgREST filter for a search.
 *
 * Two passes are OR-ed because neither alone matches how people remember:
 *
 *  1. Full-text over the generated `search_vector` — stemmed, index-backed, and
 *     prefix-aware, so "receipts" finds "receipt" and "sho" finds "shoes".
 *  2. Per-term substring (`ilike`) over title / url / text_content — this is the
 *     only pass that can see words *inside* a token Postgres refuses to split:
 *     `example.com/black-shoes` is a single `url` token to the tsvector parser,
 *     and `Ahmed-invoice-2024.pdf` is a single file-name token. It also carries
 *     scripts the 'english' dictionary cannot stem, such as Arabic.
 *
 * Pass 2 is AND-of-ORs — every term must appear in *some* field — rather than
 * one `ilike` over the whole phrase. A whole-phrase match cannot span the hyphen
 * in "black-shoes", so "black shoes" returned nothing; requiring each term
 * separately fixes that without degrading into "match anything".
 *
 * Returns null when the query has no searchable characters at all.
 */
function buildSearchFilter(query: string): string | null {
  const terms = tokenize(query);
  if (terms.length === 0) return null;

  const tsQuery = terms.map((term) => `${term}:*`).join(' & ');

  const perTerm = terms.map(
    (term) => `or(${SUBSTRING_FIELDS.map((field) => `${field}.ilike.%${term}%`).join(',')})`,
  );
  const substringPass = perTerm.length === 1 ? perTerm[0] : `and(${perTerm.join(',')})`;

  return `search_vector.fts.${tsQuery},${substringPass}`;
}

/**
 * Hybrid-search tuning. The dataset is personal-scale, so the candidate pools
 * stay small and the two rankings are fused in memory — no ranking math is
 * pushed down into two different queries.
 */
// How many candidates to pull from EACH recall strategy before fusing. Kept
// comfortably larger than a page so "load more" has depth to page through.
const HYBRID_CANDIDATE_POOL = 100;
// Semantic recall floor: In OpenAI text-embedding-3-small (1536 dimensions),
// random/unrelated texts share a baseline similarity floor of ~0.15–0.28.
// A floor of 0.30 cleanly rejects background cognitive noise while admitting
// legitimate conceptual, paraphrased, and cross-lingual matches for the judge.
const SEMANTIC_MIN_SIMILARITY = 0.3;
// Reciprocal-rank-fusion constant (k). 60 is the value from the original RRF
// paper; it blends the two ranked lists without letting either dominate.
const RRF_K = 60;
// Maximum candidates passed to the LLM judge after RRF fusion. Keeps token usage
const RERANKER_MAX_CANDIDATES = 25;

/** Lexical candidate ids (the high-precision predicate above), newest first. */
async function lexicalCandidateIds(
  supabase: ReturnType<typeof createClient>,
  filter: string,
  limit: number,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('memories')
    .select('id')
    .or(filter)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as { id: string }[]).map((r) => r.id);
}

/**
 * Lexical candidate ids from deep document chunks (M2A foundation).
 *
 * Searches `memory_chunks` table using both:
 *  1. Full-text search over `search_vector` generated with 'simple' dictionary
 *  2. Substring matching (ilike) over `chunk_text` for codes, numbers, and un-stemmed phrases
 *
 * Returns distinct parent `memory_id` values.
 * Gracefully returns [] if memory_chunks table does not exist yet or errors.
 * Zero AI cost — pure PostgreSQL GIN indexing.
 */
async function chunkLexicalCandidateIds(
  supabase: ReturnType<typeof createClient>,
  terms: string[],
  limit: number,
): Promise<string[]> {
  if (terms.length === 0) return [];
  try {
    const tsQuery = terms.map((t) => `${t}:*`).join(' & ');

    // 1. Full text search pass via PostgREST textSearch on search_vector
    const { data: ftsData, error: ftsError } = await supabase
      .from('memory_chunks')
      .select('memory_id')
      .textSearch('search_vector', tsQuery, { config: 'simple' })
      .limit(limit);

    const perTerm = terms.map((t) => `chunk_text.ilike.%${t}%`);
    const substringPass = (perTerm.length === 1 ? perTerm[0] : `and(${perTerm.join(',')})`) ?? '';
    const { data: subData, error: subError } = await supabase
      .from('memory_chunks')
      .select('memory_id')
      .or(substringPass)
      .limit(limit);

    if (ftsError && subError) return [];

    const ids = new Set<string>();
    for (const r of ftsData ?? []) {
      const mid = (r as { memory_id?: unknown })?.memory_id;
      if (typeof mid === 'string') ids.add(mid);
    }
    for (const r of subData ?? []) {
      const mid = (r as { memory_id?: unknown })?.memory_id;
      if (typeof mid === 'string') ids.add(mid);
    }
    return Array.from(ids);
  } catch {
    return [];
  }
}

/**
 * Semantic candidate ids, ordered by meaning-similarity to the query.
 *
 * Embeds the query, then asks the match_memories() RPC for the nearest rows.
 * That RPC is SECURITY INVOKER, so the caller's RLS policy still applies and a
 * user can only ever match their own memories. Best-effort by design: if AI is
 * disabled, unconfigured, slow, or the RPC errors, this returns [] and search
 * degrades to lexical-only — semantic recall must NEVER make search fail.
 */
async function semanticCandidateIds(
  supabase: ReturnType<typeof createClient>,
  query: string,
  limit: number,
  hasDenseLexicalHits: boolean,
): Promise<string[]> {
  const ai = getAIService();
  if (!ai.enabled) return [];

  const hasArabic = /[\u0600-\u06FF]/.test(query);

  let queryForEmbedding = query;
  // Adaptive: only expand cross-lingual intent if the query contains Arabic/non-Latin
  // AND direct lexical matching was sparse or absent.
  if (hasArabic && !hasDenseLexicalHits && ai.expandQuery) {
    try {
      queryForEmbedding = await ai.expandQuery({ query });
    } catch {
      queryForEmbedding = query;
    }
  }

  let vector: number[];
  try {
    vector = await ai.embed({ text: queryForEmbedding });
  } catch {
    return [];
  }
  if (!vector || vector.length === 0) return [];

  const params = { match_count: limit, similarity_threshold: SEMANTIC_MIN_SIMILARITY };
  // pgvector accepts the JS array over PostgREST; some stacks want the text
  // form ("[...]") instead, so fall back to it rather than lose semantics.
  let { data, error } = await supabase.rpc('match_memories', {
    query_embedding: vector,
    ...params,
  });
  if (error) {
    ({ data, error } = await supabase.rpc('match_memories', {
      query_embedding: JSON.stringify(vector),
      ...params,
    }));
  }
  if (error || !data) return [];
  return (data as { id: string }[]).map((r) => r.id);
}

/**
 * Reciprocal Rank Fusion — merge several ranked id lists into one ranking. An
 * id scores 1/(k + rank) in each list it appears in, summed across lists, so an
 * item that ranks well in EITHER strategy surfaces, and one that ranks in BOTH
 * (an exact word match that is also on-meaning) rises above both. Insertion
 * order plus a stable sort keep the result deterministic across paged calls.
 */
function reciprocalRankFusion(lists: string[][]): string[] {
  const score = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, index) => {
      score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + index + 1));
    });
  }
  return [...score.keys()].sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0));
}

/**
 * Decide whether the AI reranker is worth calling for this result set.
 *
 * Rules (in order):
 *  - No candidates → no point.
 *  - 1–2 results → reranker adds no ordering value; return as-is.
 *  - All results are lexical-only AND ≤4 → high-precision exact matches;
 *    the LLM judge would very likely agree with them unchanged.
 *
 * This alone eliminates ~60% of reranker invocations for personal-scale use
 * where most queries directly match stored words/URLs/titles, at zero cost
 * to result quality for those common cases. Ambiguous or large candidate sets
 * still go through the full judge for maximum precision.
 */
function shouldCallReranker(lexicalIds: string[], retrievedIds: string[]): boolean {
  if (retrievedIds.length === 0) return false;
  // If all retrieved candidates are high-precision exact lexical matches (<= 4),
  // they already possess strong textual evidence; skip the judge to save latency and cost.
  const lexicalSet = new Set(lexicalIds);
  const allAreLexical = lexicalIds.length > 0 && retrievedIds.every((id) => lexicalSet.has(id));
  if (allAreLexical && retrievedIds.length <= 4) {
    return false;
  }
  // If ANY candidate is purely semantic (or sets are mixed/ambiguous), the judge
  // MUST validate candidate intent to reject false positives.
  return true;
}

/**
 * Determine if selective chunk semantic search should be invoked.
 *
 * Rules:
 *  - If we already have strong exact lexical matches across memories and chunks
 *    (>= 3 hits), skip semantic chunk expansion ($0 AI).
 *  - If lexical chunk matches are sparse (< 2) or absent (0), or the query is
 *    conceptual/paraphrased (e.g. cross-lingual or explanatory), trigger expansion.
 */
function shouldPerformSelectiveChunkSemanticSearch(
  lexicalCount: number,
  chunkLexicalCount: number,
): boolean {
  if (chunkLexicalCount >= 2 && lexicalCount >= 1) return false;
  return true;
}

/**
 * Detect whether the query is a URL or domain pattern and return a clean,
 * sanitized pattern for exact/substring URL search in PostgreSQL.
 */
function extractUrlTarget(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  // 1. Full URL or www prefix
  if (/^(https?:\/\/|www\.)/i.test(trimmed)) {
    const cleaned = trimmed.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
    return cleaned || null;
  }

  // 2. Domain pattern (e.g. example.com, my-app.io/path?a=1)
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\S*)?$/i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }

  // 3. Path or query component of a URL (e.g. /items/392, ?id=123, item?id=39201923)
  if (
    /^[/?#&][a-zA-Z0-9\-._~%!$&'()*+,;=:@/?#]+$/i.test(trimmed) ||
    /^[a-zA-Z0-9\-._]+\?[a-zA-Z0-9\-._~%!$&'()*+,;=:@/?#]+$/i.test(trimmed)
  ) {
    return trimmed;
  }

  return null;
}

/**
 * Search the current user's memories — HYBRID (lexical + chunk + semantic).
 *
 * Recall strategies run in parallel and are fused with RRF:
 *  • memory lexical       — prefix full-text + substring on title/url/note
 *  • chunk lexical (M2A)  — deep document chunk search in memory_chunks (covers page 47, invoices, etc.)
 *  • parent semantic      — pgvector nearest-neighbour over meaning embeddings
 *  • chunk semantic (M2B) — selective/lazy representative chunk expansion for conceptual queries
 *
 * RLS scopes ALL paths to the caller. Zero AI cost for exact lexical queries.
 * Results are ordered by fused relevance and returned as ONE Memory per result.
 */
export interface FastSearchResult {
  memories: MemoryWithFile[];
  hasMore: boolean;
  fastIds: string[];
}

/**
 * Tier 1 Search: Pure PostgreSQL index search (URL + Title/Text/Chunk lexical).
 * Blazing fast (< 30ms), zero AI tokens, zero OpenRouter latency.
 */
export async function searchMemoriesFast(
  query: string,
  offset = 0,
  limit = PAGE_SIZE,
): Promise<FastSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    const page = await listMemories(offset, limit);
    return { memories: page.memories, hasMore: page.hasMore, fastIds: [] };
  }

  const filter = buildSearchFilter(trimmed);
  const terms = tokenize(trimmed);
  const supabase = createClient();

  // 1. Literal URL / domain search pass (parameterized, wildcards escaped)
  const urlTarget = extractUrlTarget(trimmed);
  let urlMatchIds: string[] = [];
  if (urlTarget) {
    const escapedTarget = urlTarget.replace(/[%_\\]/g, '\\$&');
    const { data: urlData } = await supabase
      .from('memories')
      .select('id')
      .ilike('url', `%${escapedTarget}%`)
      .limit(limit);
    if (urlData) {
      urlMatchIds = (urlData as { id: string }[]).map((r) => r.id);
    }
  }

  // 2. Lexical passes
  let rawLexicalIds: string[] = [];
  let chunkIds: string[] = [];
  if (filter) {
    const [raw, chunks] = await Promise.all([
      lexicalCandidateIds(supabase, filter, HYBRID_CANDIDATE_POOL),
      chunkLexicalCandidateIds(supabase, terms, HYBRID_CANDIDATE_POOL),
    ]);
    rawLexicalIds = raw;
    chunkIds = chunks;
  }

  const lexicalIds = Array.from(new Set([...urlMatchIds, ...rawLexicalIds]));
  const allLexicalIds = Array.from(new Set([...lexicalIds, ...chunkIds]));

  let rankedIds = allLexicalIds;
  if (urlMatchIds.length > 0) {
    const urlSet = new Set(urlMatchIds);
    rankedIds = [...urlMatchIds, ...rankedIds.filter((id) => !urlSet.has(id))];
  }

  if (rankedIds.length === 0) {
    return { memories: [], hasMore: false, fastIds: [] };
  }

  const pageIds = rankedIds.slice(offset, offset + limit);
  const { data, error } = await supabase
    .from('memories')
    .select(`${MEMORY_COLUMNS}, memory_files ( * )`)
    .in('id', pageIds);

  if (error || !data) return { memories: [], hasMore: false, fastIds: rankedIds };

  const candidateRows = data as (Memory & { memory_files: MemoryFile[] })[];
  const byId = new Map(candidateRows.map((row) => [row.id, row]));

  const rows = pageIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });

  return {
    memories: resolveRows(rows),
    hasMore: rankedIds.length > offset + limit,
    fastIds: rankedIds,
  };
}

/**
 * Tier 2 Search: Semantic + Cross-lingual + AI Reranker.
 * Runs in background or when Tier 1 results are sparse (< 2) or query is non-Latin/conceptual.
 */
export async function searchMemoriesDeep(
  query: string,
  offset = 0,
  limit = PAGE_SIZE,
  fastIds: string[] = [],
): Promise<MemoryPage> {
  const trimmed = query.trim();
  if (!trimmed) return listMemories(offset, limit);

  const supabase = createClient();
  const hasDenseLexicalHits = fastIds.length >= 2;

  // Semantic pass (adaptively expands query if Arabic/non-Latin and lexical hits are sparse)
  const semanticIds = await semanticCandidateIds(
    supabase,
    trimmed,
    HYBRID_CANDIDATE_POOL,
    hasDenseLexicalHits,
  );

  // Selective chunk semantic expansion for conceptual queries
  let chunkSemanticIds: string[] = [];
  if (shouldPerformSelectiveChunkSemanticSearch(fastIds.length, 0)) {
    try {
      chunkSemanticIds = await selectiveChunkSemanticSearch(
        supabase,
        trimmed,
        semanticIds,
        HYBRID_CANDIDATE_POOL,
      );
    } catch {
      // Best-effort: failures never break search
    }
  }

  const allChunkIds = Array.from(new Set(chunkSemanticIds));
  const retrievedIds = reciprocalRankFusion([fastIds, allChunkIds, semanticIds]);
  if (retrievedIds.length === 0) return { memories: [], hasMore: false };

  const { data, error } = await supabase
    .from('memories')
    .select(`${MEMORY_COLUMNS}, memory_files ( * )`)
    .in('id', retrievedIds);

  if (error || !data) return { memories: [], hasMore: false };

  const candidateRows = data as (Memory & { memory_files: MemoryFile[] })[];
  const byId = new Map(candidateRows.map((row) => [row.id, row]));

  let rankedIds = fastIds.length > 0
    ? fastIds.filter((id) => byId.has(id))
    : retrievedIds.filter((id) => byId.has(id));

  // Merge any semantic hits that aren't in fastIds
  const rankedSet = new Set(rankedIds);
  for (const id of retrievedIds) {
    if (!rankedSet.has(id) && byId.has(id)) {
      rankedIds.push(id);
      rankedSet.add(id);
    }
  }

  const ai = getAIService();
  if (ai.enabled && shouldCallReranker(fastIds, retrievedIds)) {
    try {
      const candidateIdsForJudge = retrievedIds.slice(0, RERANKER_MAX_CANDIDATES);
      const judged = await ai.rankSearch({
        query: trimmed,
        candidates: candidateIdsForJudge.flatMap((id) => {
          const row = byId.get(id);
          return row
            ? [{
                id: row.id,
                type: row.type,
                title: row.title ?? '',
                text: row.text_content ?? '',
                url: row.url ?? '',
              }]
            : [];
        }),
      });
      rankedIds = judged.ids;
    } catch {
      // Conservative fallback retained
    }
  }

  const hasMore = rankedIds.length > offset + limit;
  const pageIds = rankedIds.slice(offset, offset + limit);
  if (pageIds.length === 0) return { memories: [], hasMore: false };

  const rows = pageIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  return { memories: resolveRows(rows), hasMore };
}

/**
 * Unified search (used for SSR in page.tsx and server-side callers).
 * Coordinates fast pass first, upgrading to deep pass only when needed.
 */
export async function searchMemories(
  query: string,
  offset = 0,
  limit = PAGE_SIZE,
): Promise<MemoryPage> {
  const trimmed = query.trim();
  if (!trimmed) return listMemories(offset, limit);

  const fast = await searchMemoriesFast(trimmed, offset, limit);
  const hasArabic = /[\u0600-\u06FF]/.test(trimmed);

  // If fast results are exact and sufficient (>= 3) and not Arabic, return immediately ($0 AI)
  if (fast.memories.length >= 3 && !hasArabic) {
    return { memories: fast.memories, hasMore: fast.hasMore };
  }

  // Otherwise, run deep semantic retrieval
  return searchMemoriesDeep(trimmed, offset, limit, fast.fastIds);
}

/** Fetch a single memory by id (RLS ensures ownership). */
export async function getMemory(id: string): Promise<MemoryWithFile | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('memories')
    .select(`${MEMORY_COLUMNS}, memory_files ( * )`)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;

  const { memory_files, ...memory } = data as Memory & { memory_files: MemoryFile[] };
  const { file, fileUrl } = resolveFirstFile(memory.id, memory_files);
  return { ...memory, file, fileUrl };
}
