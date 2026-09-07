import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { parseQueryIntent } from '../src/lib/memories/queryUnderstanding.ts';
import { rankCandidatesByCompoundIntent } from '../src/lib/memories/queries.ts';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class DummyWebSocket {};
}

const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
  auth: { persistSession: false },
});

async function run() {
  const { data: mems } = await admin.from('memories').select('*, memory_files(*)');
  const { data: chunkRows } = await admin.from('memory_chunks').select('memory_id, chunk_text');
  const chunksByMemoryId = new Map();
  for (const cr of chunkRows || []) {
    const list = chunksByMemoryId.get(cr.memory_id) || [];
    list.push(cr.chunk_text);
    chunksByMemoryId.set(cr.memory_id, list);
  }

  const queries = [
    { q: 'أفعى', target: 'snake', desc: 'Direct keyword: snake' },
    { q: 'ثعبان', target: 'snake', desc: 'Direct keyword: serpent' },
    { q: 'snake', target: 'snake', desc: 'English keyword: snake' },
    { q: 'viper', target: 'snake', desc: 'English keyword: viper' },
    { q: 'الصورة التي كان فيها ثعبان', target: 'snake', desc: 'Descriptive with auxiliary: كان فيها' },
    { q: 'الصورة اللي كان ظاهر فيها ثعبان', target: 'snake', desc: 'Descriptive with visibility: كان ظاهر فيها' },
    { q: 'صورة فيها أفعى', target: 'snake', desc: 'Descriptive with equivalence: أفعى' },
    { q: 'حيوان يزحف', target: 'snake', desc: 'Vague concept: creeping animal' },
    { q: 'شركة الخط الأحمر', target: 'cfa54223', desc: 'Messy PDF company entity' },
    { q: 'شركة الخط الاحمر', target: 'cfa54223', desc: 'Messy PDF company entity without hamza' },
    { q: 'الخط الأحمر', target: 'cfa54223', desc: 'Entity core: Red Line' },
    { q: 'المستند اللي فيه شركة الخط الأحمر', target: 'cfa54223', desc: 'Vague document description' },
    { q: 'راتبي', target: 'salary', desc: 'Direct salary concept' },
    { q: 'راتبي شهر 7', target: 'July', desc: 'Exact month 7' },
    { q: 'راتبي شهر ٧', target: 'July', desc: 'Persian numeral month 7' },
    { q: 'راتب يوليو', target: 'July', desc: 'Named month July' },
    { q: 'راتب شهر 8', target: 'August', desc: 'Exact month 8' },
    { q: 'راتب شهر ٨', target: 'August', desc: 'Persian numeral month 8' },
    { q: 'راتب أغسطس', target: 'August', desc: 'Named month August' },
    { q: 'راتبي الشهر الماضي', target: 'August', desc: 'Relative month (August from Sept)' },
    { q: 'راتبي الشهر الحالي', target: 'EMPTY', desc: 'Current month (Sept - no memory exists)' },
    { q: 'راتبي شهر 6', target: 'EMPTY', desc: 'Adversarial negative month 6' },
    { q: 'راتبي شهر 9', target: 'EMPTY', desc: 'Adversarial negative month 9' },
    { q: 'سيارة', target: 'NOT_SNAKE', desc: 'Negative contrast test' },
    { q: 'قهوة', target: 'NOT_SNAKE', desc: 'Negative contrast test' },
    { q: 'كتاب', target: 'NOT_SNAKE', desc: 'Negative contrast test' },
    { q: 'zxqv9281', target: 'EMPTY', desc: 'Nonsense garbage query' },
  ];

  console.log('Running Critical Requirements Suite against live production memories...\n');
  let pass = 0;

  for (const item of queries) {
    const intent = parseQueryIntent(item.q);
    const terms = intent.coreTerms.length > 0 ? intent.coreTerms : [item.q];
    const res = rankCandidatesByCompoundIntent(mems, intent, terms, chunksByMemoryId);
    const topId = res.ids[0];
    const topMem = mems.find(m => m.id === topId);
    const topTitle = topMem ? topMem.title : '(None - Empty)';
    const topText = topMem ? (topMem.text_content || '') : '';

    let ok = false;
    if (item.target === 'snake') {
      ok = topId === '3677a318-f7b4-4bc7-9cf4-d25c573ecf79' || topTitle.includes('1000271905') || topText.includes('ثعبان');
    } else if (item.target === 'cfa54223') {
      ok = topId === 'cfa54223-c601-4947-9a34-cb65e741c101' || topTitle.includes('ركن عمر');
    } else if (item.target === 'July') {
      ok = topTitle.includes('July') || topText.includes('يوليو') || topText.includes('شهر 7');
    } else if (item.target === 'August') {
      ok = topTitle.includes('August') || topText.includes('أغسطس') || topText.includes('شهر 8');
    } else if (item.target === 'salary') {
      ok = topTitle.includes('Salary') || topText.includes('راتب');
    } else if (item.target === 'EMPTY') {
      ok = res.ids.length === 0;
    } else if (item.target === 'NOT_SNAKE') {
      ok = topId !== '3677a318-f7b4-4bc7-9cf4-d25c573ecf79';
    }

    if (ok) pass++;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] "${item.q}" (${item.desc})`);
    console.log(`       Top: ${topTitle} [ID: ${topId || 'none'}]`);
    if (topId) console.log(`       Evidence: ${res.evidenceReasons.get(topId)}`);
  }

  console.log('\n======================================================');
  console.log(`CRITICAL SUITE SCORE: ${pass} / ${queries.length} (${((pass / queries.length) * 100).toFixed(1)}%)`);
  console.log('======================================================');
}

run();
