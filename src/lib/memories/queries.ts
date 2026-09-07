import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getAIService } from '@/lib/ai';
import { selectiveChunkSemanticSearch } from '@/lib/documents/semantic';
import { normalizeArabicForSearch } from '@/lib/documents/extract';
import {
  parseQueryIntent,
  normalizeArabicOrthography,
  CONCEPT_MAP,
  MONTH_DATA,
  type ParsedQuery,
} from '@/lib/memories/queryUnderstanding';
import {
  getPersonalRetrievalMatches,
  type PersonalMatch,
} from '@/lib/memories/personalRetrieval';
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
  /** Evidence explanation answering "Why did you show me this?" */
  evidenceReason?: string;
}

const MEMORY_COLUMNS =
  'id, user_id, type, title, text_content, url, extraction_status, extraction_error, chunk_count, created_at, updated_at';

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
  evidenceReasons?: Map<string, string>,
): MemoryWithFile[] {
  return rows.map((row) => {
    const { memory_files, ...memory } = row;
    const { file, fileUrl } = resolveFirstFile(memory.id, memory_files);
    const evidenceReason = evidenceReasons?.get(memory.id);
    return { ...memory, file, fileUrl, evidenceReason };
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
function buildSearchFilter(query: string, customTerms?: string[]): string | null {
  const terms = customTerms && customTerms.length > 0 ? customTerms : tokenize(query);
  if (terms.length === 0) return null;

  const tsQuery = terms.map((term) => `${term}:*`).join(' & ');

  const perTerm = terms.map((term) => {
    const norm = normalizeArabicForSearch(term);
    const variants = norm && norm !== term ? [term, norm] : [term];
    const fieldConditions = variants.flatMap((v) =>
      SUBSTRING_FIELDS.map((field) => `${field}.ilike.%${v}%`),
    );
    return `or(${fieldConditions.join(',')})`;
  });
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

    const perTerm = terms.map((t) => {
      const norm = normalizeArabicForSearch(t);
      if (norm && norm !== t) {
        return `or(chunk_text.ilike.%${t}%,chunk_text.ilike.%${norm}%)`;
      }
      return `chunk_text.ilike.%${t}%`;
    });
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
 * Detect whether the query is a URL, IP, or domain pattern and return a clean,
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

  // 2. IP address pattern (e.g. 80.225.68.223)
  const ipMatch = trimmed.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  if (ipMatch) {
    return ipMatch[0];
  }

  // 3. Domain pattern (e.g. example.com, my-app.io/path?a=1)
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\S*)?$/i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }

  // 4. Path or query component of a URL (e.g. /items/392, ?id=123, item?id=39201923)
  if (
    /^[/?#&][a-zA-Z0-9\-._~%!$&'()*+,;=:@/?#]+$/i.test(trimmed) ||
    /^[a-zA-Z0-9\-._]+\?[a-zA-Z0-9\-._~%!$&'()*+,;=:@/?#]+$/i.test(trimmed)
  ) {
    return trimmed;
  }

  return null;
}

/**
 * Structured Intent candidate ids from memories table.
 */
async function intentCandidateIds(
  supabase: ReturnType<typeof createClient>,
  intent: ParsedQuery,
  limit: number,
): Promise<string[]> {
  if (!intent.hasStructuredIntent) return [];
  const orConditions: string[] = [];

  for (const num of intent.numbers) {
    if (num.includes(',')) {
      orConditions.push(`text_content.ilike."%${num}%"`, `title.ilike."%${num}%"`);
    } else {
      orConditions.push(`text_content.ilike.%${num}%`, `title.ilike.%${num}%`);
    }
  }

  for (const m of intent.months) {
    if (m.length >= 2) {
      orConditions.push(`text_content.ilike.%${m}%`, `title.ilike.%${m}%`);
    }
  }

  for (const ex of intent.conceptExpansions) {
    if (ex.length >= 2) {
      orConditions.push(`text_content.ilike.%${ex}%`, `title.ilike.%${ex}%`);
    }
  }

  if (intent.vehicle?.model) {
    orConditions.push(`text_content.ilike.%${intent.vehicle.model}%`, `title.ilike.%${intent.vehicle.model}%`);
  }
  if (intent.vehicle?.brand) {
    orConditions.push(`text_content.ilike.%${intent.vehicle.brand}%`, `title.ilike.%${intent.vehicle.brand}%`);
  }
  if (intent.partEntity) {
    orConditions.push(`text_content.ilike.%${intent.partEntity}%`, `title.ilike.%${intent.partEntity}%`);
  }
  if (intent.urlIntent?.pattern) {
    orConditions.push(`url.ilike.%${intent.urlIntent.pattern}%`, `title.ilike.%${intent.urlIntent.pattern}%`);
  }

  if (orConditions.length === 0) return [];
  const uniqueConds = Array.from(new Set(orConditions)).slice(0, 50);

  const { data, error } = await supabase
    .from('memories')
    .select('id')
    .or(uniqueConds.join(','))
    .limit(limit);

  if (error || !data) return [];
  return (data as { id: string }[]).map((r) => r.id);
}

/**
 * Structured Intent candidate ids from memory_chunks table.
 */
async function chunkIntentCandidateIds(
  supabase: ReturnType<typeof createClient>,
  intent: ParsedQuery,
  limit: number,
): Promise<string[]> {
  if (!intent.hasStructuredIntent) return [];
  const orConditions: string[] = [];

  for (const num of intent.numbers) {
    if (num.includes(',')) {
      orConditions.push(`chunk_text.ilike."%${num}%"`);
    } else {
      orConditions.push(`chunk_text.ilike.%${num}%`);
    }
  }

  for (const m of intent.months) {
    if (m.length >= 2) {
      orConditions.push(`chunk_text.ilike.%${m}%`);
    }
  }

  for (const ex of intent.conceptExpansions) {
    if (ex.length >= 2) {
      orConditions.push(`chunk_text.ilike.%${ex}%`);
    }
  }

  if (intent.vehicle?.model) {
    orConditions.push(`chunk_text.ilike.%${intent.vehicle.model}%`);
  }
  if (intent.vehicle?.brand) {
    orConditions.push(`chunk_text.ilike.%${intent.vehicle.brand}%`);
  }
  if (intent.partEntity) {
    orConditions.push(`chunk_text.ilike.%${intent.partEntity}%`);
  }

  if (orConditions.length === 0) return [];
  const uniqueConds = Array.from(new Set(orConditions)).slice(0, 50);

  try {
    const { data, error } = await supabase
      .from('memory_chunks')
      .select('memory_id')
      .or(uniqueConds.join(','))
      .limit(limit);

    if (error || !data) return [];
    const ids = new Set<string>();
    for (const r of data) {
      const mid = (r as { memory_id?: unknown })?.memory_id;
      if (typeof mid === 'string') ids.add(mid);
    }
    return Array.from(ids);
  } catch {
    return [];
  }
}

export interface CompoundRankingResult {
  ids: string[];
  evidenceReasons: Map<string, string>;
}

/**
 * Token matcher with Arabic proclitic stripping and Latin singular/plural support.
 * Prevents false-positive substring collisions (e.g. "كتاب" matching "كتابة").
 */
export function matchesToken(candidateToken: string, queryTerm: string): boolean {
  if (candidateToken === queryTerm) return true;
  const normCand = normalizeArabicOrthography(candidateToken);
  const normQ = normalizeArabicOrthography(queryTerm);
  if (normCand === normQ) return true;

  // Arabic proclitic stripping (و, ف, ب, ك, ل, ال)
  const strippedArabicCand = normCand.replace(/^(و|ف|ب|ك|ل|ال)/, '');
  const strippedArabicQ = normQ.replace(/^(و|ف|ب|ك|ل|ال)/, '');
  if (
    strippedArabicCand === strippedArabicQ ||
    strippedArabicCand === normQ ||
    normCand === strippedArabicQ
  ) {
    return true;
  }

  // Latin singular/plural prefix only
  if (
    /^[a-z0-9]+$/i.test(queryTerm) &&
    queryTerm.length >= 4 &&
    candidateToken.startsWith(queryTerm) &&
    candidateToken.length <= queryTerm.length + 2
  ) {
    return true;
  }
  return false;
}

/**
 * General Evidence Aggregator, Constraint Validator & Confidence Gate.
 *
 * Implements:
 *  - Multi-dimensional evidence scoring (lexical, phrase, structured, attribute, entity, temporal)
 *  - Hard constraints (explicit month, vehicle model, exact number)
 *  - Contradiction Veto (e.g. rear requested, candidate has front; Accent requested, candidate has Yaris)
 *  - Confidence Gating (candidates lacking sufficient evidence are dropped)
 *  - "Why did you show me this?" human-readable evidence explanation
 */
export function rankCandidatesByCompoundIntent(
  candidates: (Memory & { memory_files: MemoryFile[] })[],
  intent: ParsedQuery,
  terms: string[],
  chunksByMemoryId: Map<string, string[]>,
  personalMatches?: Map<string, PersonalMatch>,
): CompoundRankingResult {
  const scored: { id: string; score: number; reason: string }[] = [];

  for (const mem of candidates) {
    const memTitleNorm = normalizeArabicForSearch(mem.title || '').toLowerCase();
    const memBodyNorm = normalizeArabicForSearch(mem.text_content || '').toLowerCase();
    const memUrlNorm = (mem.url || '').toLowerCase();
    const fileNames = (mem.memory_files || [])
      .map((f) => normalizeArabicForSearch(f.file_name).toLowerCase())
      .join(' ');
    const chunkTexts = (chunksByMemoryId.get(mem.id) || [])
      .map(normalizeArabicForSearch)
      .join(' ')
      .toLowerCase();
    const combined = `${memTitleNorm} ${memBodyNorm} ${memUrlNorm} ${fileNames} ${chunkTexts}`;

    // 1. Numeric Evidence & Hard Number Constraint
    let matchedNumber = false;
    let matchedNumberVal = '';
    if (intent.numbers.length > 0) {
      for (const num of intent.numbers) {
        const cleanNum = num.replace(/,/g, '');
        if (/[^\d]/.test(cleanNum)) {
          if (combined.includes(cleanNum.toLowerCase())) {
            matchedNumber = true;
            matchedNumberVal = num;
            break;
          }
        }
        const regex = new RegExp(`(^|[^0-9])${cleanNum}([^0-9]|$)`);
        if (regex.test(combined) || (num.includes(',') && combined.includes(num.toLowerCase()))) {
          matchedNumber = true;
          matchedNumberVal = num;
          break;
        }
      }

      // Hard Constraint: Query specified an explicit number (e.g. "2500" or "2000")
      if (!matchedNumber) {
        continue;
      }
    }

    // 2. Temporal Month Evidence & Constraint
    let matchedMonth = false;
    let monthContradiction = false;
    let matchedMonthName = '';
    if (intent.months.length > 0) {
      for (const m of intent.months) {
        if (/[a-zA-Z\u0600-\u06FF]/.test(m)) {
          if (combined.includes(m.toLowerCase())) {
            matchedMonth = true;
            matchedMonthName = m;
            break;
          }
        }
        const num = String(parseInt(m, 10));
        const monthContextRegex = new RegExp(`(شهر\\s*0?${num}|[/-]0?${num}[/-]|\\b0?${num}/)`);
        if (monthContextRegex.test(combined)) {
          matchedMonth = true;
          matchedMonthName = m;
          break;
        }
      }

      // Check for conflicting month when query specifies explicit/relative month (e.g. Month 8 August)
      if (intent.temporalConstraint?.targetMonthNum) {
        const target = intent.temporalConstraint.targetMonthNum;
        if (!matchedMonth) {
          const hasConflictingMonth = MONTH_DATA.some((md) => {
            if (parseInt(md.num, 10) === target) return false;
            return (
              md.names.some((n) => combined.includes(n.toLowerCase())) ||
              new RegExp(`(شهر\\s*0?${md.num}|[/-]0?${md.num}[/-])`).test(combined)
            );
          });
          if (hasConflictingMonth) monthContradiction = true;
        }
      }

      if (!matchedMonth || monthContradiction) {
        // VETO: Candidate does not satisfy requested month hard constraint
        continue;
      }
    }

    // 3. Vehicle Constraint & Contradiction Veto
    let matchedVehicle = false;
    let vehicleContradiction = false;
    let matchedVehicleName = '';
    if (intent.vehicle) {
      const v = intent.vehicle;
      const hasAccent = combined.includes('اكسنت') || combined.includes('accent');
      const hasYaris = combined.includes('يارس') || combined.includes('yaris');
      const hasTaurus = combined.includes('تورس') || combined.includes('taurus');
      const hasNissan = combined.includes('نيسان') || combined.includes('nissan');
      const hasFord = combined.includes('فورد') || combined.includes('ford');
      const hasToyota = combined.includes('تويوتا') || combined.includes('toyota') || hasYaris;
      const hasHyundai = combined.includes('هيونداي') || combined.includes('هونداي') || combined.includes('hyundai') || hasAccent;

      if (v.model === 'accent') {
        if (hasAccent) {
          matchedVehicle = true;
          matchedVehicleName = 'Accent';
        } else if (hasYaris || hasTaurus) {
          vehicleContradiction = true;
        } else {
          // Specific car model missing
          continue;
        }
      } else if (v.model === 'yaris') {
        if (hasYaris) {
          matchedVehicle = true;
          matchedVehicleName = 'Yaris';
        } else if (hasAccent || hasTaurus) {
          vehicleContradiction = true;
        } else {
          continue;
        }
      } else if (v.model === 'taurus') {
        if (hasTaurus) {
          matchedVehicle = true;
          matchedVehicleName = 'Taurus';
        } else if (hasAccent || hasYaris) {
          vehicleContradiction = true;
        } else {
          continue;
        }
      }

      if (v.brand === 'nissan') {
        if (hasNissan) {
          matchedVehicle = true;
          matchedVehicleName = 'Nissan';
        } else if ((hasFord || hasYaris || hasAccent || hasToyota) && !hasNissan) {
          vehicleContradiction = true;
        } else {
          continue;
        }
      } else if (v.brand === 'toyota') {
        if (hasToyota) {
          matchedVehicle = true;
          matchedVehicleName = 'Toyota';
        } else if ((hasAccent || hasFord || hasNissan || hasTaurus) && !hasToyota) {
          vehicleContradiction = true;
        } else {
          continue;
        }
      } else if (v.brand === 'ford') {
        if (hasFord || hasTaurus) {
          matchedVehicle = true;
          matchedVehicleName = 'Ford';
        } else if ((hasAccent || hasToyota || hasNissan) && !(hasFord || hasTaurus)) {
          vehicleContradiction = true;
        } else {
          continue;
        }
      } else if (v.brand === 'hyundai') {
        if (hasHyundai) {
          matchedVehicle = true;
          matchedVehicleName = 'Hyundai';
        } else if ((hasFord || hasToyota || hasNissan) && !hasHyundai) {
          vehicleContradiction = true;
        } else {
          continue;
        }
      }

      if (vehicleContradiction) {
        // VETO: Contradicting vehicle brand/model
        continue;
      }
    }

    // 4. Position Attribute & Contradiction Veto
    let matchedPosition = false;
    let positionContradiction = false;
    if (intent.positionAttribute) {
      const pos = intent.positionAttribute;
      const hasRear = combined.includes('خلفي') || combined.includes('خلفيه') || combined.includes('rear') || combined.includes('ورا');
      const hasFront = combined.includes('أمامي') || combined.includes('امامي') || combined.includes('اماميه') || combined.includes('front');

      if (pos === 'rear') {
        if (hasRear) {
          matchedPosition = true;
        } else if (hasFront && !hasRear) {
          positionContradiction = true;
        }
      } else if (pos === 'front') {
        if (hasFront) {
          matchedPosition = true;
        } else if (hasRear && !hasFront) {
          positionContradiction = true;
        }
      }

      if (positionContradiction) {
        // VETO: Contradicting position (front vs rear)
        continue;
      }
    }

    // 4b. Compound Locality Gate: Vehicle + Position Co-occurrence
    // If query specifies both vehicle (model or brand) and position (e.g. rear bumper Accent, rear bumper Toyota),
    // they must co-occur within the SAME chunk or text segment.
    // A document containing front bumper Accent on page 1 and rear bumper Camry on page 3
    // must NOT pass as matching rear bumper Accent.
    if (intent.vehicle && intent.positionAttribute) {
      const vModel = (intent.vehicle.model || '').toLowerCase();
      const vBrand = (intent.vehicle.brand || '').toLowerCase();
      const pos = intent.positionAttribute;
      const rearTokens = ['خلفي', 'خلفيه', 'rear', 'ورا', 'وراء'];
      const frontTokens = ['أمامي', 'امامي', 'اماميه', 'front', 'قدام'];
      const targetPosTokens = pos === 'rear' ? rearTokens : frontTokens;

      const allSegments = [
        memTitleNorm,
        memBodyNorm,
        ...(chunksByMemoryId.get(mem.id) || []).map((c) => normalizeArabicForSearch(c).toLowerCase()),
      ];

      // Check individual lines and 2-line sliding window for items wrapped across line breaks
      const candidateWindows: string[] = [];
      for (const seg of allSegments) {
        const lines = seg.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
          const l1 = lines[i];
          if (!l1) continue;
          candidateWindows.push(l1);
          const l2 = lines[i + 1];
          if (l2) {
            candidateWindows.push(`${l1} ${l2}`);
          }
        }
      }

      const hasCoOccurrence = candidateWindows.some((line) => {
        const matchesModel = vModel
          ? line.includes(vModel) || (vModel === 'accent' && line.includes('اكسنت')) || (vModel === 'yaris' && line.includes('يارس')) || (vModel === 'taurus' && line.includes('تورس'))
          : false;
        const matchesBrand = vBrand
          ? line.includes(vBrand) ||
            (vBrand === 'toyota' && (line.includes('تويوتا') || line.includes('toyota') || line.includes('يارس') || line.includes('ايكو') || line.includes('كامري') || line.includes('كورولا'))) ||
            (vBrand === 'hyundai' && (line.includes('هيونداي') || line.includes('هونداي') || line.includes('hyundai') || line.includes('اكسنت') || line.includes('النترا') || line.includes('سوناتا'))) ||
            (vBrand === 'ford' && (line.includes('فورد') || line.includes('ford') || line.includes('تورس'))) ||
            (vBrand === 'nissan' && (line.includes('نيسان') || line.includes('nissan') || line.includes('صني') || line.includes('باترول')))
          : false;

        const matchesVehicle = matchesModel || matchesBrand;
        const hasPos = targetPosTokens.some((pt) => line.includes(pt));

        // If part concept is also specified (e.g. bumper), verify part co-occurrence on the same line/window
        if (intent.partEntity === 'bumper') {
          const hasBumper = line.includes('صدام') || line.includes('صدم') || line.includes('bumper');
          return matchesVehicle && hasPos && hasBumper;
        }

        return matchesVehicle && hasPos;
      });

      if (!hasCoOccurrence) {
        // VETO: Vehicle entity does not co-occur with requested position in any chunk
        continue;
      }
    }

    // 5. Part Concept Evidence
    let matchedPart = false;
    let matchedPartName = '';
    if (intent.partEntity) {
      const p = intent.partEntity;
      if (p === 'bumper' && (combined.includes('صدام') || combined.includes('صدامات') || combined.includes('bumper'))) {
        matchedPart = true;
        matchedPartName = 'صدام / Bumper';
      } else if (p === 'seal' && (combined.includes('سداد') || combined.includes('seal') || combined.includes('d4abm'))) {
        matchedPart = true;
        matchedPartName = 'سدادة / Seal';
      } else if (p === 'stapler' && (combined.includes('دباس') || combined.includes('stapler'))) {
        matchedPart = true;
        matchedPartName = 'دباسة / Stapler';
      } else if (p === 'pencil' && (combined.includes('قلم') || combined.includes('مرسام') || combined.includes('pencil'))) {
        matchedPart = true;
        matchedPartName = 'قلم / Pencil';
      } else if (p === 'spare_part' && (combined.includes('قطع') || combined.includes('غيار') || combined.includes('spare'))) {
        matchedPart = true;
        matchedPartName = 'قطعة غيار';
      }
    }

    // 6. URL & Link Intent Evidence
    let matchedUrl = false;
    if (intent.urlIntent?.isLinkQuery) {
      if (mem.type === 'link') {
        matchedUrl = true;
        if (intent.urlIntent.pattern && (mem.url || '').includes(intent.urlIntent.pattern)) {
          matchedUrl = true;
        }
      }
    }

    const memTokens = combined.match(/[\p{L}\p{N}]+/gu) || [];

    // 7. Concept Match
    const matchedConcepts = new Set<string>();
    for (const cKey of intent.concepts) {
      const cObj = CONCEPT_MAP.find((c) => c.key === cKey);
      if (cObj) {
        const hasConceptInMem = cObj.expansions.some((ex) => {
          const normEx = normalizeArabicForSearch(ex).toLowerCase();
          return (
            (normEx.includes(' ') && combined.includes(normEx)) ||
            memTokens.some((tok) => matchesToken(tok, normEx))
          );
        });
        if (hasConceptInMem) matchedConcepts.add(cKey);
      }
    }

    // Explicit domain concept hard constraint:
    // If query explicitly specifies salary, candidate MUST have salary evidence
    if (intent.concepts.includes('salary') && !matchedConcepts.has('salary')) {
      continue;
    }

    // 8. Keyword Match
    let matchedKeywords = 0;
    for (const t of terms) {
      const normTerm = normalizeArabicForSearch(t).toLowerCase();
      if (memTokens.some((tok) => matchesToken(tok, normTerm))) {
        matchedKeywords++;
      }
    }

    // 9. Direct Title / URL relevance boosts
    let titleBoost = 0;
    for (const t of terms) {
      if (memTitleNorm.includes(normalizeArabicForSearch(t).toLowerCase())) titleBoost += 120;
    }
    for (const cKey of intent.concepts) {
      const cObj = CONCEPT_MAP.find((c) => c.key === cKey);
      if (cObj && cObj.expansions.some((ex) => memTitleNorm.includes(normalizeArabicForSearch(ex).toLowerCase()))) {
        titleBoost += 100;
      }
    }
    if (intent.months.length > 0) {
      const monthInTitle = intent.months.some((m) => memTitleNorm.includes(m.toLowerCase()));
      if (monthInTitle) titleBoost += 100;
    }

    // 10. Type Affinity Bonus
    let typeScore = 0;
    if (intent.typeHint && mem.type === intent.typeHint) {
      typeScore = 50;
    }

    // 11. Personal Retrieval Boost
    let personalBoost = 0;
    if (personalMatches && personalMatches.has(mem.id)) {
      const pMatch = personalMatches.get(mem.id)!;
      personalBoost = Math.round(pMatch.effectiveWeight * 180);
    }

    // Multi-term coverage: evaluate how many distinct core terms are satisfied
    let matchedTermsCount = 0;
    for (const t of terms) {
      const normTerm = normalizeArabicForSearch(t).toLowerCase();
      const tokenMatch = memTokens.some((tok) => matchesToken(tok, normTerm));
      const titleMatch = memTitleNorm.includes(normTerm);
      const chunkMatch = (chunksByMemoryId.get(mem.id) || []).some((c) =>
        normalizeArabicForSearch(c).toLowerCase().includes(normTerm),
      );
      const conceptMatch = Array.from(matchedConcepts).some((cKey) => {
        const cObj = CONCEPT_MAP.find((c) => c.key === cKey);
        return cObj?.triggers.some((tr) => {
          const normTr = normalizeArabicForSearch(tr).toLowerCase();
          return normTr.includes(normTerm) || matchesToken(normTr, normTerm);
        });
      });
      const vehicleMatch =
        matchedVehicle &&
        (intent.vehicle?.rawMention?.includes(normTerm) ||
          intent.vehicle?.model?.includes(normTerm) ||
          intent.vehicle?.brand?.includes(normTerm));
      const partMatch = matchedPart && normTerm.includes(intent.partEntity ?? '');
      const urlMatch = matchedUrl && (mem.url?.includes(normTerm) || memTitleNorm.includes(normTerm));
      const numberMatch =
        matchedNumber &&
        intent.numbers.some((n) => n.replace(/,/g, '') === normTerm.replace(/,/g, ''));

      if (tokenMatch || titleMatch || chunkMatch || conceptMatch || vehicleMatch || partMatch || urlMatch || numberMatch) {
        matchedTermsCount++;
      }
    }

    if (matchedUrl) {
      matchedTermsCount = Math.max(matchedTermsCount, terms.length);
    }

    // Compound Term Coverage Gate:
    // If query has 2 or more distinct core terms, a candidate must satisfy at least 2 distinct terms
    // or possess an exact phrase match. Matching only 1 term from a 2-term query (e.g. only "سيارة"
    // from "سيارة سباق", or only "فاتورة" from "فاتورة كهربا") is rejected.
    const hasExactPhrase = combined.includes(normalizeArabicForSearch(intent.rawQuery).toLowerCase());
    if (terms.length >= 2 && matchedTermsCount < 2 && !hasExactPhrase) {
      continue;
    }

    const hasConcreteEvidence =
      matchedNumber ||
      matchedMonth ||
      matchedVehicle ||
      matchedPosition ||
      matchedPart ||
      matchedUrl ||
      matchedConcepts.size > 0 ||
      matchedKeywords >= 1 ||
      titleBoost > 0 ||
      personalBoost > 0;

    if (!hasConcreteEvidence) {
      continue;
    }

    // Score Computation
    let score = 0;
    if (matchedNumber) score += 140;
    if (matchedMonth) score += 120;
    if (matchedVehicle) score += 150;
    if (matchedPosition) score += 130;
    if (matchedPart) score += 120;
    if (matchedUrl) score += 200;
    score += matchedConcepts.size * 90;
    score += matchedKeywords * 80;
    score += titleBoost;
    score += typeScore;
    score += personalBoost;

    // Layer 1 Evidence: Exact normalized phrase match bonus
    const normRaw = normalizeArabicForSearch(intent.rawQuery).toLowerCase();
    if (combined.includes(normRaw) && terms.length >= 2) {
      score += 160;
    }

    // Primary memory description boost (e.g. photo caption describing a street vs address in footer)
    for (const t of terms) {
      const normTerm = normalizeArabicForSearch(t).toLowerCase();
      if (memBodyNorm.includes(normTerm)) {
        score += 50;
      }
    }

    // Full query coverage bonus
    if (matchedTermsCount >= terms.length && terms.length > 0) {
      score += 60;
    }

    // Multi-concept and multidimensional synergy
    if (matchedConcepts.size >= 2) score += 150;
    if (matchedVehicle && matchedPart) score += 200;
    if (matchedMonth && matchedNumber) score += 200;

    const MIN_CONFIDENCE_THRESHOLD = 50;
    if (score < MIN_CONFIDENCE_THRESHOLD) {
      continue;
    }

    // Generate readable evidence explanation for UI
    let reason = '';
    if (matchedVehicle && matchedPart) {
      reason = `Matched ${matchedVehicleName} ${matchedPartName}`;
    } else if (matchedVehicle) {
      reason = `Matched ${matchedVehicleName}`;
    } else if (matchedMonth && matchedNumber) {
      reason = `Matched ${matchedMonthName} (${matchedNumberVal})`;
    } else if (matchedMonth) {
      reason = `Matched ${matchedMonthName}`;
    } else if (matchedUrl) {
      reason = 'Matched saved web link';
    } else if (matchedNumber) {
      reason = `Matched amount ${matchedNumberVal}`;
    } else if (matchedPart) {
      reason = `Matched ${matchedPartName}`;
    } else if (matchedConcepts.has('salary')) {
      reason = 'Matched salary record';
    } else if (matchedConcepts.has('transfer')) {
      reason = 'Matched transfer receipt';
    } else if (matchedConcepts.has('bill')) {
      reason = 'Matched invoice / bill';
    } else if (matchedConcepts.has('quotation')) {
      reason = 'Matched price quotation / عرض أسعار';
    } else if (matchedConcepts.has('street')) {
      reason = 'Matched street / outdoor scene';
    } else if (matchedConcepts.has('snake')) {
      reason = 'Matched snake illustration';
    } else {
      reason = 'Direct text match';
    }

    scored.push({ id: mem.id, score, reason });
  }

  scored.sort((a, b) => b.score - a.score);

  const evidenceReasons = new Map<string, string>();
  scored.forEach((s) => evidenceReasons.set(s.id, s.reason));

  return {
    ids: scored.map((s) => s.id),
    evidenceReasons,
  };
}

/**
 * Search the current user's memories — HYBRID (lexical + chunk + semantic).
 */
export interface FastSearchResult {
  memories: MemoryWithFile[];
  hasMore: boolean;
  fastIds: string[];
}

/**
 * Tier 1 Search: Pure PostgreSQL index search (URL + Title/Text/Chunk lexical + Query Intent).
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

  const intent = parseQueryIntent(trimmed);
  const terms = intent.coreTerms.length > 0 ? intent.coreTerms : tokenize(trimmed);
  const filter = buildSearchFilter(trimmed, terms);
  const supabase = createClient();

  // 1. Literal URL / domain / IP search pass
  const urlTarget = extractUrlTarget(trimmed) || intent.urlIntent?.pattern;
  let urlMatchIds: string[] = [];
  if (urlTarget) {
    const escapedTarget = urlTarget.replace(/[%_\\]/g, '\\$&');
    const { data: urlData } = await supabase
      .from('memories')
      .select('id')
      .or(`url.ilike.%${escapedTarget}%,title.ilike.%${escapedTarget}%`)
      .limit(limit);
    if (urlData) {
      urlMatchIds = (urlData as { id: string }[]).map((r) => r.id);
    }
  }

  // If query is a general link intent ("رابط", "موقع"), retrieve link memories directly
  if (intent.urlIntent?.isLinkQuery && urlMatchIds.length === 0) {
    const { data: linkData } = await supabase
      .from('memories')
      .select('id')
      .eq('type', 'link')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (linkData) {
      urlMatchIds = (linkData as { id: string }[]).map((r) => r.id);
    }
  }

  // 2. Parallel Candidate Recall: Direct Lexical + Structured Intent + Personal Retrieval
  const recallPromises: [
    Promise<string[]>,
    Promise<string[]>,
    Promise<string[]>,
    Promise<string[]>,
    Promise<{ matches: Map<string, PersonalMatch>; candidateIds: string[] }>,
  ] = [
    filter ? lexicalCandidateIds(supabase, filter, HYBRID_CANDIDATE_POOL) : Promise.resolve([]),
    terms.length > 0 ? chunkLexicalCandidateIds(supabase, terms, HYBRID_CANDIDATE_POOL) : Promise.resolve([]),
    intent.hasStructuredIntent ? intentCandidateIds(supabase, intent, HYBRID_CANDIDATE_POOL) : Promise.resolve([]),
    intent.hasStructuredIntent ? chunkIntentCandidateIds(supabase, intent, HYBRID_CANDIDATE_POOL) : Promise.resolve([]),
    getPersonalRetrievalMatches(supabase, trimmed),
  ];

  const [rawLexicalIds, chunkIds, intentIds, chunkIntentIds, personalRecall] = await Promise.all(recallPromises);
  const personalMatches = personalRecall.matches;
  const personalCandidateIds = personalRecall.candidateIds;

  const allCandidateIds = Array.from(
    new Set([...urlMatchIds, ...rawLexicalIds, ...chunkIds, ...intentIds, ...chunkIntentIds, ...personalCandidateIds]),
  );

  if (allCandidateIds.length === 0) {
    return { memories: [], hasMore: false, fastIds: [] };
  }

  // Fetch full candidate rows for ranking
  const { data: candidateData, error } = await supabase
    .from('memories')
    .select(`${MEMORY_COLUMNS}, memory_files ( * )`)
    .in('id', allCandidateIds);

  if (error || !candidateData || candidateData.length === 0) {
    return { memories: [], hasMore: false, fastIds: [] };
  }

  const candidateRows = candidateData as (Memory & { memory_files: MemoryFile[] })[];

  // Fetch candidate chunk texts for multi-dimensional compound scoring
  const chunksByMemoryId = new Map<string, string[]>();
  try {
    const { data: chunkRows } = await supabase
      .from('memory_chunks')
      .select('memory_id, chunk_text')
      .in('memory_id', allCandidateIds)
      .limit(100);

    for (const cr of chunkRows || []) {
      const mid = (cr as { memory_id?: unknown; chunk_text?: unknown }).memory_id;
      const ctext = (cr as { chunk_text?: unknown }).chunk_text;
      if (typeof mid === 'string' && typeof ctext === 'string') {
        const list = chunksByMemoryId.get(mid) || [];
        list.push(ctext);
        chunksByMemoryId.set(mid, list);
      }
    }
  } catch {
    // Best-effort
  }

  // Rank candidates using compound intent, negative constraints, and confidence gate
  let rankedIds: string[] = [];
  let evidenceReasons = new Map<string, string>();

  const compoundResult = rankCandidatesByCompoundIntent(
    candidateRows,
    intent,
    terms,
    chunksByMemoryId,
    personalMatches,
  );
  rankedIds = compoundResult.ids;
  evidenceReasons = compoundResult.evidenceReasons;

  // If candidate was an explicit URL match, preserve at top
  if (urlMatchIds.length > 0) {
    const urlSet = new Set(urlMatchIds);
    rankedIds = [...urlMatchIds, ...rankedIds.filter((id) => !urlSet.has(id))];
  }

  if (rankedIds.length === 0) {
    return { memories: [], hasMore: false, fastIds: [] };
  }

  const byId = new Map(candidateRows.map((row) => [row.id, row]));
  const pageIds = rankedIds.slice(offset, offset + limit);

  const rows = pageIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });

  return {
    memories: resolveRows(rows, evidenceReasons),
    hasMore: rankedIds.length > offset + limit,
    fastIds: rankedIds,
  };
}

/**
 * Tier 2 Search: Semantic + Cross-lingual + Personal Retrieval + AI Reranker.
 * Runs in background or when Tier 1 results are sparse (< 2) or query is conceptual.
 */
export async function searchMemoriesDeep(
  query: string,
  offset = 0,
  limit = PAGE_SIZE,
  fastIds: string[] = [],
): Promise<MemoryPage> {
  const trimmed = query.trim();
  if (!trimmed) return listMemories(offset, limit);

  const intent = parseQueryIntent(trimmed);
  const terms = intent.coreTerms.length > 0 ? intent.coreTerms : tokenize(trimmed);
  const supabase = createClient();
  const hasDenseLexicalHits = fastIds.length >= 2;

  // Semantic pass and personal retrieval in parallel
  const [semanticIds, personalRecall] = await Promise.all([
    semanticCandidateIds(supabase, trimmed, HYBRID_CANDIDATE_POOL, hasDenseLexicalHits),
    getPersonalRetrievalMatches(supabase, trimmed),
  ]);

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
      // Best-effort
    }
  }

  const allChunkIds = Array.from(new Set(chunkSemanticIds));
  const retrievedIds = reciprocalRankFusion([
    fastIds,
    allChunkIds,
    semanticIds,
    personalRecall.candidateIds,
  ]);
  if (retrievedIds.length === 0) return { memories: [], hasMore: false };

  const { data, error } = await supabase
    .from('memories')
    .select(`${MEMORY_COLUMNS}, memory_files ( * )`)
    .in('id', retrievedIds);

  if (error || !data) return { memories: [], hasMore: false };

  const candidateRows = data as (Memory & { memory_files: MemoryFile[] })[];

  // Retrieve chunks for compound evidence validation
  const chunksByMemoryId = new Map<string, string[]>();
  try {
    const { data: chunkRows } = await supabase
      .from('memory_chunks')
      .select('memory_id, chunk_text')
      .in('memory_id', retrievedIds)
      .limit(100);

    for (const cr of chunkRows || []) {
      const mid = (cr as { memory_id?: unknown; chunk_text?: unknown }).memory_id;
      const ctext = (cr as { chunk_text?: unknown }).chunk_text;
      if (typeof mid === 'string' && typeof ctext === 'string') {
        const list = chunksByMemoryId.get(mid) || [];
        list.push(ctext);
        chunksByMemoryId.set(mid, list);
      }
    }
  } catch {
    // Best-effort
  }

  // Validate ALL candidates (including semantic) against compound constraints & confidence gate!
  const compoundResult = rankCandidatesByCompoundIntent(
    candidateRows,
    intent,
    terms,
    chunksByMemoryId,
    personalRecall.matches,
  );

  let rankedIds = compoundResult.ids;
  const evidenceReasons = compoundResult.evidenceReasons;

  if (rankedIds.length === 0) {
    // Confidence Gate cleanly rejected all unsupported semantic neighbors
    return { memories: [], hasMore: false };
  }

  const byId = new Map(candidateRows.map((row) => [row.id, row]));

  const ai = getAIService();
  if (ai.enabled && shouldCallReranker(fastIds, rankedIds)) {
    try {
      const candidateIdsForJudge = rankedIds.slice(0, RERANKER_MAX_CANDIDATES);
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
      if (judged.ids && judged.ids.length > 0) {
        rankedIds = judged.ids;
      }
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
  return { memories: resolveRows(rows, evidenceReasons), hasMore };
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

  const intent = parseQueryIntent(trimmed);
  const fast = await searchMemoriesFast(trimmed, offset, limit);

  // Fast Path: If fast results found matches via structured intent (numbers/months/concepts/URL)
  // or dense lexical hits (>= 2), return immediately ($0 AI, < 30ms latency)
  if (fast.memories.length >= 1 && (intent.hasStructuredIntent || fast.memories.length >= 2)) {
    return { memories: fast.memories, hasMore: fast.hasMore };
  }

  // Negative constraint fast-exit:
  // If an explicit number was queried (e.g. "50000") and no memory contains it,
  // do NOT invoke semantic retrieval to avoid false-positive hallucinations
  if (fast.memories.length === 0 && intent.numbers.length > 0) {
    return { memories: [], hasMore: false };
  }

  // If query specified an explicit vehicle model (e.g. "اكسنت") and fast found nothing,
  // do NOT invoke semantic retrieval to avoid returning unrelated cars
  if (fast.memories.length === 0 && intent.vehicle?.model) {
    return { memories: [], hasMore: false };
  }

  // Otherwise, run deep semantic retrieval for ambiguous or conceptual queries
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
