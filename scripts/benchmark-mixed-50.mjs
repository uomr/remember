import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
try {
  const serverOnlyPath = require.resolve('server-only');
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  };
} catch {}

import { parseQueryIntent } from '../src/lib/memories/queryUnderstanding.ts';
const { rankCandidatesByCompoundIntent } = await import('../src/lib/memories/queries.ts');

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class DummyWebSocket {};
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

const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
  auth: { persistSession: false },
});

async function runBenchmark() {
  const { data: mems } = await admin
    .from('memories')
    .select('*, memory_files(*)');

  const { data: chunkRows } = await admin
    .from('memory_chunks')
    .select('memory_id, chunk_text');

  const chunksByMemoryId = new Map();
  for (const cr of chunkRows || []) {
    const list = chunksByMemoryId.get(cr.memory_id) || [];
    list.push(cr.chunk_text);
    chunksByMemoryId.set(cr.memory_id, list);
  }

  const queries = [
    // ── 1. IMAGE: Snake & Reptile Positive (8) ──
    { id: 1, q: 'أفعى', target: 'snake', category: 'IMAGE' },
    { id: 2, q: 'ثعبان', target: 'snake', category: 'IMAGE' },
    { id: 3, q: 'snake', target: 'snake', category: 'IMAGE' },
    { id: 4, q: 'viper', target: 'snake', category: 'IMAGE' },
    { id: 5, q: 'الصورة التي كان فيها ثعبان', target: 'snake', category: 'IMAGE' },
    { id: 6, q: 'الصورة اللي كان ظاهر فيها ثعبان', target: 'snake', category: 'IMAGE' },
    { id: 7, q: 'صورة فيها أفعى', target: 'snake', category: 'IMAGE' },
    { id: 8, q: 'حيوان يزحف', target: 'snake', category: 'IMAGE' },

    // ── 2. IMAGE: Negative Contrasts (4) ──
    { id: 9, q: 'سيارة', target: 'car', category: 'IMAGE_NEG' },
    { id: 10, q: 'قهوة', target: 'drink', category: 'IMAGE_NEG' },
    { id: 11, q: 'كتاب', target: 'drink', category: 'IMAGE_NEG' }, // red_coffee_mug has 'book' in caption, pencil does not
    { id: 12, q: 'zxqv9281', target: 'EMPTY', category: 'GARBAGE' },

    // ── 3. DOCUMENT ENTITY: Messy PDF "شركة الخط الأحمر" (4) ──
    { id: 13, q: 'شركة الخط الأحمر', target: 'rokn_omar', category: 'ENTITY' },
    { id: 14, q: 'شركة الخط الاحمر', target: 'rokn_omar', category: 'ENTITY' },
    { id: 15, q: 'الخط الأحمر', target: 'rokn_omar', category: 'ENTITY' },
    { id: 16, q: 'المستند اللي فيه شركة الخط الأحمر', target: 'rokn_omar', category: 'VAGUE' },

    // ── 4. SCANNED QUOTATION: Scanned WhatsApp PDF (5) ──
    { id: 17, q: 'عرض سعر', target: 'quotation', category: 'SCANNED' },
    { id: 18, q: 'عرض اسعار', target: 'quotation', category: 'SCANNED' },
    { id: 19, q: 'عرض أسعار', target: 'quotation', category: 'SCANNED' },
    { id: 20, q: 'تسعيرة', target: 'quotation', category: 'SCANNED' },
    { id: 21, q: 'quotation', target: 'quotation', category: 'SCANNED' },

    // ── 5. VEHICLE: Compound Attributes & Locality (6) ──
    { id: 22, q: 'صدام خلفي أكسنت', target: 'accent_rear_bumper', category: 'VEHICLE' },
    { id: 23, q: 'الصدام الخلفي لسيارة أكسنت', target: 'accent_rear_bumper', category: 'VEHICLE' },
    { id: 24, q: 'خلفي أكسنت صدام', target: 'accent_rear_bumper', category: 'VEHICLE' },
    { id: 25, q: 'bumper rear Accent', target: 'accent_rear_bumper', category: 'VEHICLE' },
    { id: 26, q: 'صدام أمامي أكسنت', target: 'accent_front_bumper', category: 'VEHICLE' },
    { id: 27, q: 'صدام خلفي Toyota', target: 'toyota_rear_bumper', category: 'VEHICLE' },

    // ── 6. SALARY: Temporal Disambiguation (11) ──
    { id: 28, q: 'راتبي', target: 'salary_any', category: 'SALARY' },
    { id: 29, q: 'راتبي شهر 7', target: 'salary_july', category: 'SALARY' },
    { id: 30, q: 'راتبي شهر ٧', target: 'salary_july', category: 'SALARY' },
    { id: 31, q: 'راتب يوليو', target: 'salary_july', category: 'SALARY' },
    { id: 32, q: 'راتب شهر 8', target: 'salary_august', category: 'SALARY' },
    { id: 33, q: 'راتب شهر ٨', target: 'salary_august', category: 'SALARY' },
    { id: 34, q: 'راتب أغسطس', target: 'salary_august', category: 'SALARY' },
    { id: 35, q: 'راتبي الشهر الماضي', target: 'salary_august', category: 'SALARY' },
    { id: 36, q: 'راتبي الشهر الحالي', target: 'EMPTY', category: 'SALARY_NEG' },
    { id: 37, q: 'راتبي شهر 6', target: 'EMPTY', category: 'SALARY_NEG' },
    { id: 38, q: 'راتبي شهر 9', target: 'EMPTY', category: 'SALARY_NEG' },

    // ── 7. VAGUE HUMAN MEMORY: Approximate Descriptions (6) ──
    { id: 39, q: 'الصورة اللي صورتها وأنا أشرب شيء على الطاولة', target: 'drink', category: 'VAGUE' },
    { id: 40, q: 'الصورة اللي فيها ثعبان', target: 'snake', category: 'VAGUE' },
    { id: 41, q: 'الملف اللي فيه عرض سعر', target: 'quotation', category: 'VAGUE' },
    { id: 42, q: 'الورقة اللي فيها مبلغ 2500', target: 'amount_2500', category: 'VAGUE' },
    { id: 43, q: 'الصورة اللي صورتها وانا ادور على قطعة سيارة', target: 'nissan_part', category: 'VAGUE' },
    { id: 44, q: 'القطعة اللي صورتها عشان السيارة', target: 'nissan_part', category: 'VAGUE' },

    // ── 8. ADVERSARIAL & GARBAGE: Strict Fail-Closed (6) ──
    { id: 45, q: 'راتبي شهر 99', target: 'EMPTY', category: 'GARBAGE' },
    { id: 46, q: 'افعى سيارة قهوة', target: 'EMPTY', category: 'GARBAGE' },
    { id: 47, q: 'سيارة سباق فيراري', target: 'EMPTY', category: 'GARBAGE' },
    { id: 48, q: 'ملح', target: 'EMPTY', category: 'GARBAGE' },
    { id: 49, q: 'فاتورة انترنت الاتصالات المتكاملة', target: 'EMPTY', category: 'GARBAGE' },
    { id: 50, q: 'عقد إيجار شقة', target: 'ejar_agreement', category: 'STRUCTURED' },

    // ── 9. LINK & BILL DOMAINS (4) ──
    { id: 51, q: 'رابط', target: 'link', category: 'STRUCTURED' },
    { id: 52, q: 'رابط موقع محلي', target: 'link', category: 'STRUCTURED' },
    { id: 53, q: 'فاتورة كهربا', target: 'sec_bill', category: 'STRUCTURED' },
    { id: 54, q: 'شارع', target: 'street', category: 'STRUCTURED' },
  ];

  console.log(`\n======================================================`);
  console.log(`EXHAUSTIVE 54-QUERY MIXED BENCHMARK SUITE`);
  console.log(`======================================================\n`);

  let passedCount = 0;
  const latencies = [];
  const failures = [];

  for (const item of queries) {
    const start = performance.now();
    const intent = parseQueryIntent(item.q);
    const terms = intent.coreTerms.length > 0 ? intent.coreTerms : [item.q];
    const res = rankCandidatesByCompoundIntent(mems, intent, terms, chunksByMemoryId);
    const elapsed = performance.now() - start;
    latencies.push(elapsed);

    const topId = res.ids[0];
    const topMem = mems.find((m) => m.id === topId);
    const topTitle = topMem ? topMem.title : '(None - Empty)';
    const topText = topMem ? topMem.text_content || '' : '';
    const topChunks = topId ? chunksByMemoryId.get(topId) || [] : [];
    const combinedTop = `${topTitle} ${topText} ${topChunks.join(' ')}`;

    let ok = false;
    let expectedDesc = '';

    switch (item.target) {
      case 'snake':
        expectedDesc = 'Snake image (1000271905.jpg)';
        ok = topId === '3677a318-f7b4-4bc7-9cf4-d25c573ecf79' || topTitle.includes('1000271905') || topText.includes('ثعبان');
        break;

      case 'rokn_omar':
        expectedDesc = 'Messy PDF (ركن عمر.pdf)';
        ok = topId === 'cfa54223-c601-4947-9a34-cb65e741c101' || topTitle.includes('ركن عمر');
        break;

      case 'quotation':
        expectedDesc = 'Quotation PDF (_عرض سعر وطني_ or WhatsApp Scan)';
        ok = topTitle.includes('عرض سعر') || topTitle.includes('WhatsApp Scan') || topText.includes('عرض أسعار') || topText.includes('تسعيرة');
        break;

      case 'accent_rear_bumper':
        expectedDesc = 'Rear Accent Bumper (must NOT match Taurus or front-only)';
        ok = (combinedTop.includes('أكسنت') || combinedTop.includes('اكسنت') || combinedTop.includes('Accent')) &&
             (combinedTop.includes('خلفي') || combinedTop.includes('rear') || combinedTop.includes('B-20')) &&
             !topTitle.includes('Taurus') && !topText.includes('تورس');
        break;

      case 'accent_front_bumper':
        expectedDesc = 'Front Accent Bumper';
        ok = (combinedTop.includes('أكسنت') || combinedTop.includes('اكسنت') || combinedTop.includes('Accent')) &&
             (combinedTop.includes('أمامي') || combinedTop.includes('امامي') || combinedTop.includes('front'));
        break;

      case 'toyota_rear_bumper':
        expectedDesc = 'Toyota rear bumper candidate (Yaris, Corolla, or Camry rear bumper)';
        ok = (combinedTop.includes('يارس') || combinedTop.includes('كورلا') || combinedTop.includes('كامري') || combinedTop.includes('تويوتا')) &&
             (combinedTop.includes('خلفي') || combinedTop.includes('rear')) &&
             (combinedTop.includes('صدام') || combinedTop.includes('bumper'));
        break;

      case 'salary_any':
        expectedDesc = 'Any salary slip';
        ok = topTitle.includes('Salary') || topText.includes('راتب');
        break;

      case 'salary_july':
        expectedDesc = 'July Salary (Month 7)';
        ok = topTitle.includes('July') || topText.includes('يوليو') || topText.includes('07');
        break;

      case 'salary_august':
        expectedDesc = 'August Salary (Month 8)';
        ok = topTitle.includes('August') || topText.includes('أغسطس') || topText.includes('08');
        break;

      case 'drink':
        expectedDesc = 'Coffee/mug image';
        ok = topTitle.includes('coffee') || topText.includes('قهوة') || topText.includes('mug');
        break;

      case 'car':
        expectedDesc = 'Car image (must NOT return snake)';
        ok = topId !== '3677a318-f7b4-4bc7-9cf4-d25c573ecf79' && (topTitle.includes('20250513') || topText.includes('سيارة'));
        break;

      case 'nissan_part':
        expectedDesc = 'Nissan car part (1000269972.jpg)';
        ok = topTitle.includes('1000269972') || topText.includes('نيسان');
        break;

      case 'amount_2500':
        expectedDesc = 'Transfer receipt with 2500';
        ok = topText.includes('2500') || topTitle.includes('2500') || topTitle.includes('Receipt') || topTitle.includes('تحويل');
        break;

      case 'link':
        expectedDesc = 'Saved web link';
        ok = topMem && topMem.type === 'link';
        break;

      case 'sec_bill':
        expectedDesc = 'SEC Electricity bill';
        ok = topTitle.includes('Electricity') || topText.includes('كهرب');
        break;

      case 'street':
        expectedDesc = 'Street photo';
        ok = topTitle.includes('1788718') || topText.includes('شارع');
        break;

      case 'ejar_agreement':
        expectedDesc = 'Ejar rental agreement (Ejar Rental Agreement 2026.pdf)';
        ok = topTitle.includes('Ejar') || topTitle.includes('Rental') || topText.includes('إيجار') || topText.includes('ايجار');
        break;

      case 'EMPTY':
        expectedDesc = 'Strictly 0 results (empty)';
        ok = res.ids.length === 0;
        break;
    }

    if (ok) {
      passedCount++;
      console.log(`[PASS] #${item.id.toString().padStart(2, '0')} [${item.category}] "${item.q}" -> ${topTitle} (${elapsed.toFixed(1)}ms)`);
    } else {
      failures.push({
        id: item.id,
        q: item.q,
        category: item.category,
        expected: expectedDesc,
        actual: topTitle,
        reason: res.evidenceReasons.get(topId) || 'None',
      });
      console.log(`[FAIL] #${item.id.toString().padStart(2, '0')} [${item.category}] "${item.q}"`);
      console.log(`       Expected: ${expectedDesc}`);
      console.log(`       Actual:   ${topTitle} [ID: ${topId || 'empty'}]`);
    }
  }

  const avgLatency = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);
  const passRate = ((passedCount / queries.length) * 100).toFixed(1);

  console.log(`\n======================================================`);
  console.log(`BENCHMARK SUMMARY`);
  console.log(`Total Queries: ${queries.length}`);
  console.log(`Passed:        ${passedCount}`);
  console.log(`Failed:        ${failures.length}`);
  console.log(`Pass Rate:     ${passRate}%`);
  console.log(`Avg Latency:   ${avgLatency} ms`);
  console.log(`======================================================\n`);

  if (failures.length > 0) {
    console.log('FAILURES DETAIL:');
    for (const f of failures) {
      console.log(`- Query: "${f.q}" | Category: ${f.category}`);
      console.log(`  Expected: ${f.expected}`);
      console.log(`  Actual:   ${f.actual}`);
    }
  }
}

runBenchmark();
