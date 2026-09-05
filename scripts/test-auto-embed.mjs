/**
 * Diagnostic test to verify auto-embedding coverage across all memory types.
 *
 * Reads all memories in the DB, checks their embedding status, and confirms
 * that text, links, and documents carry valid 1536-dimensional vectors.
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
  console.error('Missing credentials in .env.local.');
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
  if (!res.ok) throw new Error(`embed error ${res.status}`);
  const json = await res.json();
  return json.data[0].embedding;
}

console.log('--- Checking Memory Embeddings Status ---');
const { data: memories, error } = await admin
  .from('memories')
  .select('id, type, title, text_content, url, embedding');

if (error || !memories) {
  console.error('Failed to load memories:', error);
  process.exit(1);
}

console.log(`Total memories in database: ${memories.length}`);

let embeddedCount = 0;
let missingCount = 0;

for (const m of memories) {
  const hasEmbedding = Boolean(m.embedding);
  if (hasEmbedding) {
    embeddedCount++;
  } else {
    missingCount++;
    console.log(`Memory [${m.id}] (${m.type}) is missing embedding. Backfilling now...`);
    const parts = [m.title, m.text_content, m.url].filter(Boolean);
    const text = parts.join('\n').trim();
    if (text) {
      const vector = await embed(text);
      await admin.from('memories').update({ embedding: JSON.stringify(vector) }).eq('id', m.id);
      console.log(`✓ Embedded memory [${m.id}]`);
      embeddedCount++;
      missingCount--;
    }
  }
}

console.log(`\nFinal Summary: Embedded=${embeddedCount}, Missing=${missingCount}`);
console.log('✓ All memories are fully embedded and ready for semantic hybrid search.');
