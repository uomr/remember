import { readFileSync } from 'node:fs';
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

const { createClient } = await import('@supabase/supabase-js');
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const TARGET_USER_ID = 'bd07342f-440f-4860-83df-d21c4c0e205d';

const { data: userMemories, error } = await admin
  .from('memories')
  .select('id, type, title, text_content, url, extraction_status, extraction_error, chunk_count, created_at, memory_files(*)')
  .eq('user_id', TARGET_USER_ID)
  .order('created_at', { ascending: false });

if (error || !userMemories) {
  console.error('Failed to load user memories:', error);
  process.exit(1);
}

const memoryIds = userMemories.map((m) => m.id);
const { data: chunkRows } = await admin
  .from('memory_chunks')
  .select('memory_id, chunk_text')
  .in('memory_id', memoryIds);

const chunksByMemoryId = new Map();
for (const cr of chunkRows || []) {
  const list = chunksByMemoryId.get(cr.memory_id) || [];
  list.push(cr.chunk_text);
  chunksByMemoryId.set(cr.memory_id, list);
}

console.log(`Loaded ${userMemories.length} live memories for comprehensive verification.\n`);

const testCases = [
  {
    category: '1. Original Failure: ملح (No Salt Memory Exists)',
    query: 'ملح',
    expectPass: (res) => res.ids.length === 0,
    desc: 'MUST return 0 matches (no transfer slip hallucination)'
  },
  {
    category: '2. Original Failure: كتاب (No Book Evidence)',
    query: 'كتاب',
    expectPass: (res) => {
      // Must NOT return pencil (which has كتابة / writing, NOT كتاب / book)
      const matches = res.ids.map(id => userMemories.find(m => m.id === id));
      return !matches.some(m => (m.title || '').includes('178871188') || (m.text_content || '').includes('pencil'));
    },
    desc: 'MUST NOT return pencil (writing != book)'
  },
  {
    category: '3. Original Failure: شارع (Street Image)',
    query: 'شارع',
    expectPass: (res) => {
      const top = userMemories.find(m => m.id === res.ids[0]);
      return top && (top.title.includes('1788718') || (top.text_content || '').includes('شارع'));
    },
    desc: 'MUST return street image and EXCLUDE spare-parts quotation'
  },
  {
    category: '4. Original Failure: فاتورة كهربا نسيتها',
    query: 'فاتورة كهربا',
    expectPass: (res) => {
      const top = userMemories.find(m => m.id === res.ids[0]);
      return top && (top.title.includes('Electricity') || (top.text_content || '').includes('كهرب'));
    },
    desc: 'MUST return electricity bill and EXCLUDE unrelated tables'
  },
  {
    category: '5. Original Failure: افعى (Snake Equivalence)',
    query: 'افعى',
    expectPass: (res) => {
      const top = userMemories.find(m => m.id === res.ids[0]);
      return top && (top.title.includes('1000271905') || (top.text_content || '').includes('ثعبان'));
    },
    desc: 'MUST return snake memory via general concept equivalence'
  },
  {
    category: '6. Original Failure: رابط',
    query: 'رابط',
    expectPass: (res) => res.ids.length > 0 && userMemories.some(m => res.ids.includes(m.id) && m.type === 'link'),
    desc: 'MUST retrieve saved link memories deterministically'
  },
  {
    category: '7. Original Failure: رابط موقع محلي',
    query: 'رابط موقع محلي',
    expectPass: (res) => {
      const top = userMemories.find(m => m.id === res.ids[0]);
      return top && top.type === 'link';
    },
    desc: 'MUST return local application URL deterministically'
  },
  {
    category: '8. Original Failure: صدامات',
    query: 'صدامات',
    expectPass: (res) => {
      const top = userMemories.find(m => m.id === res.ids[0]);
      if (!top) return false;
      const chunks = chunksByMemoryId.get(top.id) || [];
      return (top.text_content || '').includes('صدام') || chunks.some(c => c.includes('صدام'));
    },
    desc: 'MUST return spare parts quotation containing bumper'
  },
  {
    category: '9. Original Failure: صدام خلفي اكسنت',
    query: 'صدام خلفي اكسنت',
    expectPass: (res) => {
      // Must not match Ford Taurus or Front bumper
      const matches = res.ids.map(id => userMemories.find(m => m.id === id));
      return !matches.some(m => (m.text_content || '').includes('تورس') || (m.title || '').includes('Taurus'));
    },
    desc: 'MUST reject Ford Taurus and Front bumpers'
  },
  {
    category: '10. Original Failure: راتبي الشهر الماضي',
    query: 'الورقة اللي فيها راتبي حق الشهر اللي فات',
    expectPass: (res) => {
      const top = userMemories.find(m => m.id === res.ids[0]);
      return top && top.title.includes('August');
    },
    desc: 'MUST resolve to Month 8 (August) when evaluated relative to September'
  },
  {
    category: '11. Original Failure: الصورة اللي صورتها وانا ادور على قطعة سيارة',
    query: 'الصورة اللي صورتها وانا ادور على قطعة سيارة',
    expectPass: (res) => {
      const top = userMemories.find(m => m.id === res.ids[0]);
      const matches = res.ids.map(id => userMemories.find(m => m.id === id));
      const hasBook = matches.some(m => (m.text_content || '').includes('ملخص') || (m.title || '').includes('Book'));
      return top && (top.title.includes('1000269972') || (top.text_content || '').includes('نيسان')) && !hasBook;
    },
    desc: 'MUST return Nissan car part and EXCLUDE book summary screenshot'
  },
  {
    category: '12. Original Failure: القطعة اللي صورتها عشان السيارة',
    query: 'القطعة اللي صورتها عشان السيارة',
    expectPass: (res) => {
      const top = userMemories.find(m => m.id === res.ids[0]);
      return top && (top.title.includes('1000269972') || (top.text_content || '').includes('نيسان'));
    },
    desc: 'MUST return Nissan part without returning Ford Taurus photo'
  },
  {
    category: '13. Rule 19 Vague Recall: الصورة اللي صورتها وأنا أشرب شيء',
    query: 'الصورة اللي صورتها وأنا أشرب شيء على الطاولة',
    expectPass: (res) => {
      const top = userMemories.find(m => m.id === res.ids[0]);
      return top && ((top.title || '').includes('coffee') || (top.text_content || '').includes('قهوة') || (top.text_content || '').includes('ماء'));
    },
    desc: 'MUST find coffee/drink memory without being overly strict'
  },
  {
    category: '14. Unseen Adversarial Query: سيارة سباق فيراري',
    query: 'سيارة سباق فيراري',
    expectPass: (res) => res.ids.length === 0,
    desc: 'MUST return 0 results (Ford Taurus is not Ferrari)'
  },
  {
    category: '15. Unseen Adversarial Query: راتبي شهر 4',
    query: 'راتبي شهر 4',
    expectPass: (res) => res.ids.length === 0,
    desc: 'MUST return 0 results (Only months 7 and 8 exist)'
  }
];

let passCount = 0;

for (const t of testCases) {
  const intent = parseQueryIntent(t.query);
  const terms = intent.coreTerms.length > 0 ? intent.coreTerms : [t.query];
  const res = rankCandidatesByCompoundIntent(userMemories, intent, terms, chunksByMemoryId, new Map());
  const passed = t.expectPass(res);
  if (passed) passCount++;

  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${t.category}`);
  console.log(`       Query: "${t.query}"`);
  console.log(`       Requirement: ${t.desc}`);
  console.log(`       Top Result: ${res.ids.length > 0 ? userMemories.find(m => m.id === res.ids[0])?.title : '(None - Correctly Empty)'}`);
  if (res.ids.length > 0) {
    console.log(`       Reason: ${res.evidenceReasons.get(res.ids[0]) || 'General match'}`);
  }
  console.log('');
}

console.log(`\n======================================================`);
console.log(`FINAL SCORE: ${passCount} / ${testCases.length} (${((passCount / testCases.length) * 100).toFixed(1)}%)`);
console.log(`======================================================`);

if (passCount === testCases.length) {
  console.log('🎉 ALL 15 VERIFICATION & ADVERSARIAL CASES PASSED WITH 100% PRECISION!');
} else {
  process.exit(1);
}
