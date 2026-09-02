/**
 * Explain why certain searches return nothing: dump the searchable text of the
 * image memories, then run the app's exact predicate for a battery of terms.
 * Read-only. This is the user's own logo test data.
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
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --- dump image text ---
const { data: imgs } = await admin
  .from('memories')
  .select('id, type, text_content')
  .eq('type', 'image')
  .order('created_at', { ascending: true });

console.log('=== Stored searchable text of your images ===');
for (const m of imgs || []) {
  console.log(`\n[image ${m.id.slice(0, 8)}]`);
  console.log((m.text_content || '(empty)').trim());
}

// --- run the app's predicate for a battery of terms ---
const SUBSTRING_FIELDS = ['title', 'url', 'text_content'];
const tokenize = (q) => q.match(/[\p{L}\p{N}]+/gu) ?? [];
function buildSearchFilter(query) {
  const terms = tokenize(query);
  if (terms.length === 0) return null;
  const tsQuery = terms.map((t) => `${t}:*`).join(' & ');
  const perTerm = terms.map((t) => `or(${SUBSTRING_FIELDS.map((f) => `${f}.ilike.%${t}%`).join(',')})`);
  const substringPass = perTerm.length === 1 ? perTerm[0] : `and(${perTerm.join(',')})`;
  return `search_vector.fts.${tsQuery},${substringPass}`;
}

const terms = [
  'اسود', 'أسود', 'احمر', 'أحمر', 'حذاء', 'جزمة', 'ابيض',
  'شعار', 'سيارات', 'قطع', 'قطع غيار', 'ترس', 'ركن',
  'logo', 'black', 'red', 'gear', 'auto', 'shoe',
];
console.log('\n\n=== Search predicate results (across all memories, RLS bypassed) ===');
for (const q of terms) {
  const filter = buildSearchFilter(q);
  const { data } = await admin.from('memories').select('id, type').or(filter);
  console.log(`"${q}"  ->  ${data ? data.length : 0}`);
}
