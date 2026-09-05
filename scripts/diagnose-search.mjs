/**
 * Read-only diagnostic: inspects existing memories to explain why an image may
 * not be found by a text description.
 *
 * It NEVER prints private memory content. For each memory it reports only:
 *   type · title present? · text_content length · file name · created_at
 * plus a per-image verdict on whether it currently has any searchable text.
 *
 * Uses the service-role key (bypasses RLS) purely to read the whole table on
 * the user's own machine. Nothing is written or deleted.
 *
 * Run: node scripts/diagnose-search.mjs
 */
import { readFileSync } from 'node:fs';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {
    constructor() {
      throw new Error('Realtime is not used by this diagnostic.');
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

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE =
  env.SUPABASE_SECRET_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) {
  console.error('Missing Supabase url / secret key in .env.local.');
  process.exit(1);
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const { data, error } = await admin
  .from('memories')
  .select('id, type, title, text_content, url, created_at, memory_files ( file_name )')
  .order('created_at', { ascending: false });

if (error) {
  console.error('Query failed:', error.message);
  process.exit(2);
}

const rows = data ?? [];
console.log(`Total memories: ${rows.length}\n`);

const byType = {};
for (const r of rows) byType[r.type] = (byType[r.type] ?? 0) + 1;
console.log('By type:', JSON.stringify(byType), '\n');

let imagesWithText = 0;
let imagesWithoutText = 0;

for (const r of rows) {
  const textLen = (r.text_content ?? '').trim().length;
  const fileName = r.memory_files?.[0]?.file_name ?? '(none)';
  const flags = [];
  if (r.type === 'image') {
    if (textLen > 0) {
      imagesWithText += 1;
      flags.push('SEARCHABLE-TEXT: yes');
    } else {
      imagesWithoutText += 1;
      flags.push('SEARCHABLE-TEXT: NONE (only findable by file name)');
    }
  }
  console.log(
    `- ${r.type.padEnd(8)} | title:${r.title ? 'yes' : 'no '} | textLen:${String(textLen).padStart(4)} | file:${fileName} | ${r.created_at}` +
      (flags.length ? `\n    ${flags.join(' | ')}` : ''),
  );
}

console.log('\n--- Image summary ---');
console.log(`Images WITH searchable text (note/AI description/OCR): ${imagesWithText}`);
console.log(`Images WITHOUT any searchable text:                    ${imagesWithoutText}`);
console.log(
  '\nNote: search is LEXICAL (word match), not semantic. Even an image WITH text\n' +
    'is only found when your search words literally overlap that stored text.',
);
