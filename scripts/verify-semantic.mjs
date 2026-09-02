/**
 * Verify the semantic-search foundation (migration 0002) end-to-end:
 *   1. embed a natural-language query via OpenRouter (same model as the app),
 *   2. call the match_memories() RPC on the live DB,
 *   3. print the ranked matches (id, type, similarity, a short text preview).
 *
 * READ-ONLY: it never writes to the database. Uses the service-role key so it
 * can see every embedded row (RLS is bypassed for this diagnostic only); the
 * real app calls the same RPC through the user session, so RLS still scopes
 * results per-user in production.
 *
 * Run: node scripts/verify-semantic.mjs                 # default queries
 *      node scripts/verify-semantic.mjs "شعار" "logo"   # custom queries
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

const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const OR_KEY = env.OPENROUTER_API_KEY;
const MODEL = env.OPENROUTER_EMBEDDING_MODEL || 'openai/text-embedding-3-small';

if (!SUPA_URL || !SERVICE || !OR_KEY) {
  console.error('Missing Supabase url / service role key / OpenRouter key in .env.local.');
  process.exit(1);
}

const admin = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });

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

/** Call the RPC. pgvector accepts the JSON array; fall back to its text form. */
async function match(vec, count = 10, threshold = 0.0) {
  let { data, error } = await admin.rpc('match_memories', {
    query_embedding: vec,
    match_count: count,
    similarity_threshold: threshold,
  });
  if (error) {
    ({ data, error } = await admin.rpc('match_memories', {
      query_embedding: JSON.stringify(vec),
      match_count: count,
      similarity_threshold: threshold,
    }));
  }
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Map matched ids -> a short human preview so the ranking is readable.
async function previews(ids) {
  if (ids.length === 0) return {};
  const { data } = await admin
    .from('memories')
    .select('id, type, title, text_content')
    .in('id', ids);
  const by = {};
  for (const m of data ?? []) {
    const text = (m.title || m.text_content || '').replace(/\s+/g, ' ').trim();
    by[m.id] = `${m.type.padEnd(8)} ${text.slice(0, 60)}`;
  }
  return by;
}

const queries = process.argv.slice(2);
if (queries.length === 0) queries.push('شعار', 'logo', 'قطع غيار', 'auto parts', 'الحذاء الأسود');

console.log(`\nSemantic verify against ${SUPA_URL}\nmodel=${MODEL}\n`);

let anyMatch = false;
for (const q of queries) {
  try {
    const vec = await embed(q);
    const rows = await match(vec, 10, 0.0);
    const pv = await previews(rows.map((r) => r.id));
    console.log(`Query "${q}"  →  ${rows.length} match(es)`);
    for (const r of rows) {
      console.log(`   ${r.similarity.toFixed(3)}  ${r.id.slice(0, 8)}  ${pv[r.id] ?? ''}`);
    }
    console.log('');
    if (rows.length > 0) anyMatch = true;
  } catch (e) {
    console.log(`Query "${q}"  →  ERROR: ${e?.message || String(e)}\n`);
  }
}

console.log(anyMatch ? 'RESULT: match_memories is returning semantic results ✅' : 'RESULT: no matches — check that backfill ran and the migration is applied.');
process.exit(anyMatch ? 0 : 3);
