/**
 * Verify the app's search actually returns rows for a given query — mirrors the
 * hybrid predicate in src/lib/memories/queries.ts (full-text OR per-term ilike,
 * Unicode \p{L}\p{N} tokenizer). Read-only. Uses service role to bypass RLS so
 * it can check regardless of which user owns the rows.
 *
 * Run:  node scripts/search-check.mjs "شعار"  "logo"  "auto parts"
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
const supaUrl = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaSecret =
  env.SUPABASE_SECRET_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(supaUrl, supaSecret, {
  auth: { persistSession: false },
});

const SUBSTRING_FIELDS = ['title', 'url', 'text_content'];
const tokenize = (q) => q.match(/[\p{L}\p{N}]+/gu) ?? [];
function buildSearchFilter(query) {
  const terms = tokenize(query);
  if (terms.length === 0) return null;
  const tsQuery = terms.map((t) => `${t}:*`).join(' & ');
  const perTerm = terms.map(
    (t) => `or(${SUBSTRING_FIELDS.map((f) => `${f}.ilike.%${t}%`).join(',')})`,
  );
  const substringPass = perTerm.length === 1 ? perTerm[0] : `and(${perTerm.join(',')})`;
  return `search_vector.fts.${tsQuery},${substringPass}`;
}

const queries = process.argv.slice(2);
if (queries.length === 0) queries.push('شعار');

for (const q of queries) {
  const filter = buildSearchFilter(q);
  if (!filter) {
    console.log(`Query "${q}" -> no searchable characters`);
    continue;
  }
  const { data, error } = await admin
    .from('memories')
    .select('id, type, title')
    .or(filter);
  if (error) {
    console.log(`Query "${q}" -> ERROR: ${error.message}`);
    continue;
  }
  console.log(`Query "${q}" -> ${data.length} result(s): ` + data.map((r) => r.type).join(', '));
}
