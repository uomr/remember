import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { STORAGE_BUCKET } from '@/lib/config';
import { getAIService } from '@/lib/ai';
import type { Memory, MemoryFile } from '@/types/database';

/**
 * Server-side read layer for memories. All reads go through the RLS-guarded
 * server client, so a user can only ever see their own rows. Signed URLs for
 * private files are minted here, on demand, with a short lifetime.
 */

/** How long a generated signed file URL stays valid (seconds). */
const SIGNED_URL_TTL = 60 * 60; // 1 hour

/** How many memories we load per page (initial load and each "load more"). */
export const PAGE_SIZE = 24;

/** A memory plus its first file (if any) and a ready-to-use preview URL. */
export interface MemoryWithFile extends Memory {
  file: MemoryFile | null;
  /** Signed URL for the attached file, or null. */
  fileUrl: string | null;
}

const MEMORY_COLUMNS = 'id, user_id, type, title, text_content, url, created_at, updated_at';

async function signFirstFile(
  supabase: ReturnType<typeof createClient>,
  files: MemoryFile[] | null,
): Promise<{ file: MemoryFile | null; fileUrl: string | null }> {
  const file = files && files.length > 0 ? files[0] : null;
  if (!file) return { file: null, fileUrl: null };

  const { data } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(file.storage_path, SIGNED_URL_TTL);

  return { file, fileUrl: data?.signedUrl ?? null };
}

async function signRows(
  supabase: ReturnType<typeof createClient>,
  rows: (Memory & { memory_files: MemoryFile[] })[],
): Promise<MemoryWithFile[]> {
  return Promise.all(
    rows.map(async (row) => {
      const { memory_files, ...memory } = row;
      const { file, fileUrl } = await signFirstFile(supabase, memory_files);
      return { ...memory, file, fileUrl };
    }),
  );
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
  return { memories: await signRows(supabase, rows), hasMore };
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
// Broad recall floor only: keep plausible candidates (even a colloquial query
// such as "جزمة") for the intent-aware judge. This value does NOT decide what
// the user sees; rankSearch performs the final precision filter below.
const SEMANTIC_MIN_SIMILARITY = 0.1;
// Reciprocal-rank-fusion constant (k). 60 is the value from the original RRF
// paper; it blends the two ranked lists without letting either dominate.
const RRF_K = 60;
// Maximum candidates passed to the LLM judge after RRF fusion. Keeps token usage
// minimal (<2k tokens) and latency fast while preserving top recall.
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
): Promise<string[]> {
  const ai = getAIService();
  if (!ai.enabled) return [];

  let vector: number[];
  try {
    vector = await ai.embed({ text: query });
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
 * Search the current user's memories — HYBRID (lexical + semantic).
 *
 * Two recall strategies run in parallel and are fused with RRF:
 *  • lexical  — the prefix full-text + substring predicate (buildSearchFilter):
 *               high precision for exact words, URLs, file names, and Arabic.
 *  • semantic — pgvector nearest-neighbour over meaning embeddings: high recall
 *               for synonyms, spelling variants, and cross-language recall
 *               ("الحذاء الأسود" finds a photo whose stored text says "black shoe").
 *
 * RLS scopes BOTH paths to the caller, so this can never surface another user's
 * data. Semantic is best-effort: with AI off (or on any failure) the result is
 * exactly the previous lexical behaviour. Results are ordered by fused
 * relevance rather than recency.
 */
export async function searchMemories(
  query: string,
  offset = 0,
  limit = PAGE_SIZE,
): Promise<MemoryPage> {
  const trimmed = query.trim();
  if (!trimmed) return listMemories(offset, limit);

  const filter = buildSearchFilter(trimmed);
  // A query of pure punctuation ("!!!") has no searchable tokens. Return empty
  // rather than falling back to listMemories, which would look like the search
  // silently did nothing (and skips a pointless embedding of punctuation).
  if (!filter) return { memories: [], hasMore: false };

  const supabase = createClient();

  const [lexicalIds, semanticIds] = await Promise.all([
    lexicalCandidateIds(supabase, filter, HYBRID_CANDIDATE_POOL),
    semanticCandidateIds(supabase, trimmed, HYBRID_CANDIDATE_POOL),
  ]);

  const retrievedIds = reciprocalRankFusion([lexicalIds, semanticIds]);
  if (retrievedIds.length === 0) return { memories: [], hasMore: false };

  // Load candidate evidence once. The AI judge needs the actual description,
  // OCR/note, title and URL — a cosine score alone cannot distinguish a shoe
  // from a vaguely related logo or reject gibberish such as "JJJJ".
  const { data, error } = await supabase
    .from('memories')
    .select(`${MEMORY_COLUMNS}, memory_files ( * )`)
    .in('id', retrievedIds);
  if (error || !data) return { memories: [], hasMore: false };

  const candidateRows = data as (Memory & { memory_files: MemoryFile[] })[];
  const byId = new Map(candidateRows.map((row) => [row.id, row]));

  // Final precision pass: let the language model understand the user's actual
  // request and select only candidates that satisfy it. If the judge fails,
  // fall back to lexical matches only; never expose weak semantic noise.
  let rankedIds = lexicalIds.filter((id) => byId.has(id));
  const ai = getAIService();
  if (ai.enabled) {
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
      // Conservative lexical fallback above is intentionally retained.
    }
  }

  const hasMore = rankedIds.length > offset + limit;
  const pageIds = rankedIds.slice(offset, offset + limit);
  if (pageIds.length === 0) return { memories: [], hasMore: false };

  const rows = pageIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  return { memories: await signRows(supabase, rows), hasMore };
}

/** Fetch a single memory by id (RLS ensures ownership), with a signed file URL. */
export async function getMemory(id: string): Promise<MemoryWithFile | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('memories')
    .select(`${MEMORY_COLUMNS}, memory_files ( * )`)
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;

  const { memory_files, ...memory } = data as Memory & { memory_files: MemoryFile[] };
  const { file, fileUrl } = await signFirstFile(supabase, memory_files);
  return { ...memory, file, fileUrl };
}
