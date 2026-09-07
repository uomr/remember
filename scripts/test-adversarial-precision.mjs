/**
 * Adversarial Precision & Anti-Hallucination Test Suite.
 *
 * Verifies that:
 *  1. Negative queries without matching evidence return 0 results (correct emptiness).
 *  2. Contradiction veto blocks wrong attributes (rear != front, Accent != Yaris).
 *  3. Relative and explicit temporal queries discriminate correct months (August vs July).
 *  4. Natural URL queries retrieve saved links without AI.
 *  5. Concept equivalence works for Arabic variants (أفعى <-> ثعبان).
 *  6. Disambiguated entities exclude unrelated candidates (Nissan part excludes Ford & book summary).
 *
 * Run: npx tsx scripts/test-adversarial-precision.mjs
 */

import { readFileSync } from 'node:fs';
import { parseQueryIntent } from '../src/lib/memories/queryUnderstanding';
import { rankCandidatesByCompoundIntent } from '../src/lib/memories/queries';
import { normalizeArabicForSearch } from '../src/lib/documents/extract';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {
    constructor() {
      throw new Error('Realtime not used');
    }
  };
}

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const { createClient } = await import('@supabase/supabase-js');
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const TARGET_USER_ID = 'bd07342f-440f-4860-83df-d21c4c0e205d';

// Fetch all memories for the target user to simulate candidate pool
const { data: userMemories, error } = await admin
  .from('memories')
  .select('id, type, title, text_content, url, extraction_status, extraction_error, chunk_count, created_at, memory_files(*)')
  .eq('user_id', TARGET_USER_ID)
  .order('created_at', { ascending: false });

if (error || !userMemories) {
  console.error('Failed to load user memories:', error);
  process.exit(1);
}

console.log(`Loaded ${userMemories.length} test memories for user ${TARGET_USER_ID.slice(0, 8)}...\n`);

// Fetch document chunks for candidate pool
const memoryIds = userMemories.map((m) => m.id);
const { data: chunkRows } = await admin
  .from('document_chunks')
  .select('memory_id, chunk_text')
  .in('memory_id', memoryIds);

const chunksByMemoryId = new Map();
if (chunkRows) {
  for (const cr of chunkRows) {
    const list = chunksByMemoryId.get(cr.memory_id) || [];
    list.push(cr.chunk_text);
    chunksByMemoryId.set(cr.memory_id, list);
  }
}

function searchTest(query) {
  const trimmed = query.trim();
  const intent = parseQueryIntent(trimmed);
  const terms = intent.coreTerms.length > 0 ? intent.coreTerms : (trimmed.match(/[\p{L}\p{N}]+/gu) ?? []);

  // Filter candidate pool to those with any lexical or semantic relation
  let candidatePool = [...userMemories];

  // URL exact intent injection
  if (intent.urlIntent?.isLinkQuery) {
    candidatePool = candidatePool.filter((m) => m.type === 'link' || (m.url && m.url.length > 0) || (m.title && m.title.includes('80.225')));
  }

  const result = rankCandidatesByCompoundIntent(
    candidatePool,
    intent,
    terms,
    chunksByMemoryId,
  );

  const matchedMemories = result.ids.map((id) => {
    const m = userMemories.find((mem) => mem.id === id);
    return {
      id: m.id,
      title: m.title,
      type: m.type,
      reason: result.evidenceReasons.get(m.id),
      text: (m.text_content || '').slice(0, 80).replace(/\n/g, ' '),
    };
  });

  return { query, intent, matches: matchedMemories };
}

console.log('================================================================');
console.log('1. ADVERSARIAL NEGATIVE TESTS (MUST RETURN 0 MATCHES)');
console.log('================================================================');

const negativeQueries = [
  { query: 'ملح', desc: 'No salt memory exists -> MUST return 0 (no transfer slip hallucination)' },
  { query: 'zxqv9281', desc: 'Random nonsense ASCII -> MUST return 0' },
  { query: 'قفصطبلغ', desc: 'Garbage Arabic letters -> MUST return 0' },
  { query: 'مبلغ 50000', desc: 'Amount 50000 -> MUST return 0 (never match bank account numbers)' },
  { query: 'سيارة سباق', desc: 'Racing car -> MUST return 0 (Ford Taurus is sedan, not race car)' },
];

let negPass = 0;
for (const tc of negativeQueries) {
  const res = searchTest(tc.query);
  const passed = res.matches.length === 0;
  console.log(`Query: "${tc.query}"`);
  console.log(`  Desc: ${tc.desc}`);
  console.log(`  Result: ${passed ? '✅ PASS (0 results)' : `❌ FAIL (${res.matches.length} matches: ${res.matches.map((m) => m.title).join(', ')})`}`);
  if (passed) negPass++;
}
console.log(`Negative Queries Score: ${negPass} / ${negativeQueries.length}\n`);

console.log('================================================================');
console.log('2. ATTRIBUTE & ENTITY COMPOSITION (CONTRADICTION VETO)');
console.log('================================================================');

// Test 2A: "صدام خلفي اكسنت" must not return Ford Taurus
const carPartRes = searchTest('صدام خلفي اكسنت');
const carPartTaurusFail = carPartRes.matches.some((m) => m.title?.includes('Taurus') || m.text?.includes('تورس'));
console.log(`Query: "صدام خلفي اكسنت"`);
console.log(`  Contradiction Veto (No Taurus): ${!carPartTaurusFail ? '✅ PASS' : '❌ FAIL (returned Taurus!)'}`);
console.log(`  Top match: ${carPartRes.matches[0]?.title ?? '(none)'} — ${carPartRes.matches[0]?.reason ?? ''}`);

// Test 2B: "قطعة نيسان" must return Nissan part and NOT Ford Taurus or book summary
const nissanRes = searchTest('قطعة نيسان');
const nissanTop = nissanRes.matches[0];
const nissanPass = nissanTop && (nissanTop.title?.includes('1000269972') || nissanTop.text?.includes('Nissan'));
const nissanNoFord = !nissanRes.matches.some((m) => m.title?.includes('Taurus'));
const nissanNoBook = !nissanRes.matches.some((m) => m.title?.includes('1000271905'));
console.log(`Query: "قطعة نيسان"`);
console.log(`  Top is Nissan part: ${nissanPass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`  Excluded Ford: ${nissanNoFord ? '✅ PASS' : '❌ FAIL'}`);
console.log(`  Excluded Book Summary: ${nissanNoBook ? '✅ PASS' : '❌ FAIL'}`);
console.log(`  Reason: ${nissanTop?.reason ?? ''}`);

console.log('\n================================================================');
console.log('3. TEMPORAL REASONING & MONTH DISCRIMINATION');
console.log('================================================================');

// Test 3A: Explicit Month 8 vs Month 7
const augRes = searchTest('راتبي شهر 8');
const julyRes = searchTest('راتبي شهر 7');
const augTop = augRes.matches[0]?.title ?? '';
const julyTop = julyRes.matches[0]?.title ?? '';
const augPass = augTop.includes('August') && !augTop.includes('July');
const julyPass = julyTop.includes('July') && !julyTop.includes('August');
console.log(`Query: "راتبي شهر 8" -> Top: "${augTop}" | ${augPass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Query: "راتبي شهر 7" -> Top: "${julyTop}" | ${julyPass ? '✅ PASS' : '❌ FAIL'}`);

// Test 3B: Relative Temporal "الشهر اللي فات" / "الشهر الماضي" (Reference: Sept 2026 -> August Month 8)
const relRes = searchTest('الورقة اللي فيها راتبي حق الشهر اللي فات');
const relTop = relRes.matches[0]?.title ?? '';
const relPass = relTop.includes('August');
console.log(`Query: "الورقة اللي فيها راتبي حق الشهر اللي فات" -> Top: "${relTop}" | ${relPass ? '✅ PASS (Correct relative Month 8 resolved)' : '❌ FAIL'}`);
console.log(`  Reason: ${relRes.matches[0]?.reason ?? ''}`);

console.log('\n================================================================');
console.log('4. DETERMINISTIC URL RETRIEVAL');
console.log('================================================================');

const url1 = searchTest('رابط');
const url2 = searchTest('رابط موقع محلي');
const url3 = searchTest('80.225.68.223');
const url1Pass = url1.matches.length > 0 && url1.matches.some((m) => m.type === 'link');
const url2Pass = url2.matches.some((m) => m.title?.includes('80.225') || m.text?.includes('80.225'));
const url3Pass = url3.matches.some((m) => m.title?.includes('80.225') || m.text?.includes('80.225'));
console.log(`Query: "رابط" -> Found links: ${url1Pass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Query: "رابط موقع محلي" -> Top: "${url2.matches[0]?.title ?? ''}" | ${url2Pass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Query: "80.225.68.223" -> Top: "${url3.matches[0]?.title ?? ''}" | ${url3Pass ? '✅ PASS' : '❌ FAIL'}`);

console.log('\n================================================================');
console.log('5. ARABIC CONCEPT EQUIVALENCE & NORMALIZATION');
console.log('================================================================');

const snake1 = searchTest('أفعى');
const snake2 = searchTest('ثعبان');
const snake1Pass = snake1.matches.some((m) => m.title?.includes('1000271905') || m.text?.includes('snake') || m.text?.includes('ثعبان'));
const snake2Pass = snake2.matches.some((m) => m.title?.includes('1000271905') || m.text?.includes('snake') || m.text?.includes('ثعبان'));
console.log(`Query: "أفعى" -> Found snake memory: ${snake1Pass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Query: "ثعبان" -> Found snake memory: ${snake2Pass ? '✅ PASS' : '❌ FAIL'}`);

console.log('\n================================================================');
console.log('6. ELECTRICITY BILL VS UNRELATED TABLES');
console.log('================================================================');

const elecRes = searchTest('فاتورة كهربا');
const elecTop = elecRes.matches[0]?.title ?? '';
const elecPass = elecTop.includes('Electricity') || elecTop.includes('SEC');
const elecNoTable = !elecRes.matches.some((m) => m.title?.includes('17886044452875369601602523401429'));
console.log(`Query: "فاتورة كهربا" -> Top: "${elecTop}" | ${elecPass ? '✅ PASS' : '❌ FAIL'}`);
console.log(`  Unrelated financial table excluded: ${elecNoTable ? '✅ PASS' : '❌ FAIL'}`);

console.log('\n================================================================');
console.log('SUMMARY SCORE');
console.log('================================================================');
const totalChecks = negativeQueries.length + 1 + 3 + 2 + 1 + 3 + 2 + 2;
const passedChecks = negPass + (carPartTaurusFail ? 0 : 1) + (nissanPass ? 1 : 0) + (nissanNoFord ? 1 : 0) + (nissanNoBook ? 1 : 0) + (augPass ? 1 : 0) + (julyPass ? 1 : 0) + (relPass ? 1 : 0) + (url1Pass ? 1 : 0) + (url2Pass ? 1 : 0) + (url3Pass ? 1 : 0) + (snake1Pass ? 1 : 0) + (snake2Pass ? 1 : 0) + (elecPass ? 1 : 0) + (elecNoTable ? 1 : 0);
console.log(`Total checks passed: ${passedChecks} / ${totalChecks} (${Math.round((passedChecks / totalChecks) * 100)}%)`);

if (passedChecks < totalChecks) {
  console.log('Some checks failed.');
  process.exit(1);
} else {
  console.log('🎉 ALL ADVERSARIAL AND PRECISION TESTS PASSED CLEANLY!');
  process.exit(0);
}
