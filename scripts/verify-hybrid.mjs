/**
 * Verify the HYBRID search algorithm (Phase B) against live data.
 *
 * Mirrors searchMemories() in src/lib/memories/queries.ts byte-for-byte for the
 * parts that matter — the lexical predicate, the match_memories() semantic pass,
 * and the Reciprocal Rank Fusion merge — and prints the fused ranking plus which
 * strategy (lexical / semantic / both) each hit came from.
 *
 * READ-ONLY. Uses the service-role key so it can see every embedded row across
 * all users (RLS is bypassed for this diagnostic only). The real app calls the
 * same RPC through the user session, so RLS still scopes results per-user.
 *
 * Run: node scripts/verify-hybrid.mjs                    # default queries
 *      node scripts/verify-hybrid.mjs "جزمة سوداء"        # a paraphrase, no exact words
 */
import { readFileSync } from 'node:fs';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {
    constructor() {
      throw new Error('Realtime not used.');
    }
  };
}
const { createClient } = await import('@supabase/supabase-js');

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE =
  env.SUPABASE_SECRET_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const OR_KEY = env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
const MODEL =
  env.OPENROUTER_EMBEDDING_MODEL ||
  process.env.OPENROUTER_EMBEDDING_MODEL ||
  'openai/text-embedding-3-small';

if (!SUPA_URL || !SERVICE || !OR_KEY) {
  console.error('Missing Supabase url / secret key / OpenRouter key in .env.local.');
  process.exit(1);
}

const admin = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });

// --- mirror of the app's tuning + lexical predicate --------------------------
const HYBRID_CANDIDATE_POOL = 100;
const SEMANTIC_MIN_SIMILARITY = 0.1;
const RRF_K = 60;
const SUBSTRING_FIELDS = ['title', 'url', 'text_content'];

function tokenize(query) {
  return query.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function buildSearchFilter(query) {
  const terms = tokenize(query);
  if (terms.length === 0) return null;
  const tsQuery = terms.map((term) => `${term}:*`).join(' & ');
  const perTerm = terms.map(
    (term) => `or(${SUBSTRING_FIELDS.map((field) => `${field}.ilike.%${term}%`).join(',')})`,
  );
  const substringPass = perTerm.length === 1 ? perTerm[0] : `and(${perTerm.join(',')})`;
  return `search_vector.fts.${tsQuery},${substringPass}`;
}

function reciprocalRankFusion(lists) {
  const score = new Map();
  for (const list of lists) {
    list.forEach((id, index) => {
      score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + index + 1));
    });
  }
  return [...score.keys()].sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0));
}

async function embed(text) {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OR_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Remember',
    },
    body: JSON.stringify({ model: MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const v = json.data?.[0]?.embedding;
  if (!Array.isArray(v) || v.length === 0) throw new Error('empty embedding');
  return v;
}

async function lexicalIds(filter) {
  if (!filter) return [];
  const { data } = await admin
    .from('memories')
    .select('id')
    .or(filter)
    .order('created_at', { ascending: false })
    .limit(HYBRID_CANDIDATE_POOL);
  return (data ?? []).map((r) => r.id);
}

async function semanticIds(query) {
  const vec = await embed(query);
  const { data, error } = await admin.rpc('match_memories', {
    query_embedding: vec,
    match_count: HYBRID_CANDIDATE_POOL,
    similarity_threshold: SEMANTIC_MIN_SIMILARITY,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id);
}

async function previews(ids) {
  if (ids.length === 0) return {};
  const { data } = await admin
    .from('memories')
    .select('id, type, title, text_content')
    .in('id', ids);
  const by = {};
  for (const m of data ?? []) {
    const text = (m.title || m.text_content || '').replace(/\s+/g, ' ').trim();
    by[m.id] = `${m.type.padEnd(8)} ${text.slice(0, 55)}`;
  }
  return by;
}

const queries = process.argv.slice(2);
if (queries.length === 0) queries.push('شعار', 'الحذاء الأسود', 'جزمة سوداء', 'قطع غيار السيارات');

console.log(`\nHybrid search verify against ${SUPA_URL}\nmodel=${MODEL}  threshold=${SEMANTIC_MIN_SIMILARITY}\n`);

for (const q of queries) {
  const filter = buildSearchFilter(q);
  const [lex, sem] = await Promise.all([lexicalIds(filter), semanticIds(q).catch(() => [])]);
  const merged = reciprocalRankFusion([lex, sem]);
  const pv = await previews(merged);
  const lexSet = new Set(lex);
  const semSet = new Set(sem);

  console.log(`Query "${q}"   lexical=${lex.length}  semantic=${sem.length}  fused=${merged.length}`);
  merged.forEach((id, i) => {
    const src = lexSet.has(id) && semSet.has(id) ? 'both    ' : lexSet.has(id) ? 'lexical ' : 'semantic';
    console.log(`   #${i + 1}  ${src}  ${id.slice(0, 8)}  ${pv[id] ?? ''}`);
  });
  console.log('');
}

console.log('Done. Ranking above is exactly what the app returns (RLS-scoped to one user in production).');
