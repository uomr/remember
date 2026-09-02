/**
 * Backfill semantic-search embeddings for existing memories (migration 0002).
 * For each memory it builds the searchable text (title + text_content + url),
 * asks OpenRouter for an embedding, and stores it in memories.embedding.
 *
 * PREREQUISITE: migration 0002 applied (the `embedding` column + pgvector).
 * Reads .env.local; never prints the key. Idempotent: by default only fills
 * rows whose embedding IS NULL; pass --all to recompute every row.
 *
 * Run: node scripts/backfill-embeddings.mjs        # only missing
 *      node scripts/backfill-embeddings.mjs --all   # recompute all
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
const ALL = process.argv.includes('--all');

if (!SUPA_URL || !SERVICE) {
  console.error('Missing Supabase url / service role key in .env.local.');
  process.exit(1);
}
if (!OR_KEY) {
  console.error('Missing OPENROUTER_API_KEY in .env.local.');
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

let query = admin.from('memories').select('id, type, title, text_content, url');
if (!ALL) query = query.is('embedding', null);
const { data, error } = await query;
if (error) {
  console.error('Query failed:', error.message);
  console.error('(Did you apply migration 0002? The `embedding` column must exist.)');
  process.exit(2);
}

const rows = data ?? [];
console.log(`Memories to embed: ${rows.length}${ALL ? ' (--all)' : ' (missing only)'}`);

let done = 0;
let skipped = 0;
let failed = 0;

for (const m of rows) {
  const text = [m.title, m.text_content, m.url].filter(Boolean).join('\n').trim();
  if (!text) {
    console.log(`- ${m.id.slice(0, 8)} ${m.type.padEnd(8)} SKIP (no text)`);
    skipped += 1;
    continue;
  }
  try {
    const vec = await embed(text);
    const { error: upErr } = await admin
      .from('memories')
      .update({ embedding: JSON.stringify(vec) })
      .eq('id', m.id);
    if (upErr) throw new Error(upErr.message);
    done += 1;
    console.log(`- ${m.id.slice(0, 8)} ${m.type.padEnd(8)} EMBEDDED (${vec.length}d)`);
  } catch (e) {
    failed += 1;
    console.log(`- ${m.id.slice(0, 8)} ${m.type.padEnd(8)} FAILED: ${e?.message || String(e)}`);
  }
}

console.log(`\nDone. embedded=${done} skipped=${skipped} failed=${failed}`);
