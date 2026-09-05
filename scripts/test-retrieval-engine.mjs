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

const targetUserId = 'bd07342f-440f-4860-83df-d21c4c0e205d';

async function seedSalaryDocument() {
  const { data: existing } = await admin
    .from('memories')
    .select('id')
    .eq('user_id', targetUserId)
    .ilike('title', '%Salary slip - August 2026%');

  if (existing && existing.length > 0) {
    console.log('Salary document already exists:', existing[0].id);
    return existing[0].id;
  }

  const { data: inserted, error } = await admin
    .from('memories')
    .insert({
      user_id: targetUserId,
      type: 'document',
      title: 'Salary slip - August 2026.pdf',
      text_content: 'Salary for August 2026 — Amount 2,000 SAR\n\nراتب شهر 8 أغسطس 2000 الفين ألفين',
      extraction_status: 'done',
      chunk_count: 1,
    })
    .select('id')
    .single();

  if (error) {
    console.error('Failed to seed salary memory:', error);
    return null;
  }

  const memId = inserted.id;
  await admin.from('memory_chunks').insert({
    memory_id: memId,
    user_id: targetUserId,
    chunk_index: 0,
    chunk_text: 'Document Type: Salary Slip / كشف راتب\nDate: August 2026 / أغسطس 2026\nEmployee: Ahmed\nSalary for August 2026 — Amount 2,000 SAR\nNet Salary: 2,000.00 SAR\nراتب شهر 8 الفين',
    word_count: 30,
  });

  return memId;
}

const salaryId = 'c9721113-cb72-4995-a51a-080cd7ff8ca3';
const hawalaId = '1ba6f5b6-972d-4ed2-a7a1-7a2a2d9eabed';

// Quick inline query parser matching queryUnderstanding.ts
const ARABIC_WORD_NUMBERS = {
  'الفين': '2000', 'ألفين': '2000', 'الفان': '2000', 'ألفان': '2000',
  'الف': '1000', 'ألف': '1000', 'خمسمائة': '500', 'خمسمية': '500',
  'مائة': '100', 'مئة': '100', 'مية': '100',
  'تسعين': '90', 'ثمانين': '80', 'سبعين': '70', 'ستين': '60',
  'خمسين': '50', 'اربعين': '40', 'ثلاثين': '30', 'عشرين': '20',
  'عشرة': '10', 'خمسة': '5', 'واحد': '1', 'صفر': '0',
};

const MONTH_DATA = [
  { num: '1',  pad: '01', names: ['يناير', 'january', 'jan'] },
  { num: '2',  pad: '02', names: ['فبراير', 'february', 'feb'] },
  { num: '3',  pad: '03', names: ['مارس', 'march', 'mar'] },
  { num: '4',  pad: '04', names: ['أبريل', 'ابريل', 'april', 'apr'] },
  { num: '5',  pad: '05', names: ['مايو', 'may'] },
  { num: '6',  pad: '06', names: ['يونيو', 'june', 'jun'] },
  { num: '7',  pad: '07', names: ['يوليو', 'july', 'jul'] },
  { num: '8',  pad: '08', names: ['أغسطس', 'اغسطس', 'august', 'aug'] },
  { num: '9',  pad: '09', names: ['سبتمبر', 'september', 'sep'] },
  { num: '10', pad: '10', names: ['أكتوبر', 'october', 'oct'] },
  { num: '11', pad: '11', names: ['نوفمبر', 'november', 'nov'] },
  { num: '12', pad: '12', names: ['ديسمبر', 'december', 'dec'] },
];

const CONCEPT_MAP = [
  {
    key: 'salary',
    triggers: ['راتب', 'راتبي', 'مرتب', 'معاش', 'salary', 'payroll', 'wage'],
    expansions: ['راتب', 'راتبي', 'salary', 'payroll'],
  },
  {
    key: 'transfer',
    triggers: ['حوالة', 'حواله', 'تحويل', 'إيصال', 'ايصال', 'سند', 'transfer', 'receipt'],
    expansions: ['حوالة', 'تحويل', 'سند', 'transfer', 'receipt'],
  },
  {
    key: 'amount',
    triggers: ['مبلغ', 'المبلغ', 'قيمة', 'قدره', 'amount', 'sar', 'ريال'],
    expansions: ['مبلغ', 'amount', 'sar', 'ريال'],
  },
];

function normalizeArabic(str) {
  if (!str) return '';
  return str
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[٠۰]/g, '0').replace(/[١۱]/g, '1').replace(/[٢۲]/g, '2')
    .replace(/[٣۳]/g, '3').replace(/[٤۴]/g, '4').replace(/[٥۵]/g, '5')
    .replace(/[٦۶]/g, '6').replace(/[٧۷]/g, '7').replace(/[٨۸]/g, '8')
    .replace(/[٩۹]/g, '9');
}

function parseIntent(q) {
  const norm = normalizeArabic(q).toLowerCase();
  const words = norm.split(/\s+/);
  const numbers = new Set();
  const months = new Set();
  const concepts = new Set();
  const conceptExpansions = new Set();

  const digitMatches = norm.match(/\b\d+(?:[.,]\d+)*\b/g) || [];
  for (const dm of digitMatches) {
    const raw = dm.replace(/[.,]/g, '');
    numbers.add(raw);
    if (raw.length >= 4) numbers.add(Number(raw).toLocaleString('en-US'));
  }

  for (const [w, val] of Object.entries(ARABIC_WORD_NUMBERS)) {
    const normW = normalizeArabic(w);
    if (words.includes(normW) || norm.includes(normW)) {
      numbers.add(val);
      numbers.add(normW);
      if (val.length >= 4) numbers.add(Number(val).toLocaleString('en-US'));
    }
  }

  const monthMatch = norm.match(/شهر\s*(\d{1,2})/);
  if (monthMatch) {
    const num = String(parseInt(monthMatch[1], 10));
    const m = MONTH_DATA.find((item) => item.num === num);
    if (m) {
      months.add(m.pad); months.add(m.num);
      m.names.forEach((n) => months.add(n));
    }
  }
  for (const m of MONTH_DATA) {
    for (const name of m.names) {
      if (words.includes(normalizeArabic(name))) {
        months.add(m.pad); months.add(m.num);
        m.names.forEach((n) => months.add(n));
        break;
      }
    }
  }

  for (const c of CONCEPT_MAP) {
    if (c.triggers.some((tr) => words.includes(normalizeArabic(tr)))) {
      concepts.add(c.key);
      c.expansions.forEach((ex) => conceptExpansions.add(ex));
    }
  }

  return {
    raw: q,
    norm,
    words: q.match(/[\p{L}\p{N}]+/gu) ?? [],
    numbers: Array.from(numbers),
    months: Array.from(months),
    concepts: Array.from(concepts),
    conceptExpansions: Array.from(conceptExpansions),
  };
}

async function executeSearch(query) {
  const intent = parseIntent(query);
  const terms = intent.words;
  if (terms.length === 0) return { query, matches: [] };

  // Fetch candidate pool from memories and memory_chunks
  const orConditions = [];

  // 1. Raw terms
  for (const t of terms) {
    const normT = normalizeArabic(t);
    orConditions.push(`title.ilike.%${t}%`, `text_content.ilike.%${t}%`);
    if (normT !== t) {
      orConditions.push(`title.ilike.%${normT}%`, `text_content.ilike.%${normT}%`);
    }
  }

  // 2. Numbers
  for (const num of intent.numbers) {
    if (num.includes(',')) {
      orConditions.push(`text_content.ilike."%${num}%"`, `title.ilike."%${num}%"`);
    } else {
      orConditions.push(`text_content.ilike.%${num}%`, `title.ilike.%${num}%`);
    }
  }

  // 3. Months
  for (const m of intent.months) {
    if (m.length >= 2) {
      orConditions.push(`text_content.ilike.%${m}%`, `title.ilike.%${m}%`);
    }
  }

  // 4. Concept expansions
  for (const ex of intent.conceptExpansions) {
    orConditions.push(`text_content.ilike.%${ex}%`, `title.ilike.%${ex}%`);
  }

  const { data: memRows, error: memErr } = await admin
    .from('memories')
    .select('id, title, text_content, type')
    .eq('user_id', targetUserId)
    .or(orConditions.slice(0, 30).join(','));

  if (memErr) {
    console.error('[memRows:error]', memErr);
  }

  const candidateIds = new Set((memRows || []).map((r) => r.id));

  // Also query memory_chunks
  const chunkOrConditions = [];
  for (const t of terms) {
    chunkOrConditions.push(`chunk_text.ilike.%${t}%`);
  }
  for (const num of intent.numbers) {
    if (num.includes(',')) {
      chunkOrConditions.push(`chunk_text.ilike."%${num}%"`);
    } else {
      chunkOrConditions.push(`chunk_text.ilike.%${num}%`);
    }
  }
  for (const m of intent.months) {
    if (m.length >= 2) chunkOrConditions.push(`chunk_text.ilike.%${m}%`);
  }
  for (const ex of intent.conceptExpansions) {
    chunkOrConditions.push(`chunk_text.ilike.%${ex}%`);
  }

  const { data: chunkRows, error: chunkErr } = await admin
    .from('memory_chunks')
    .select('memory_id, chunk_text')
    .eq('user_id', targetUserId)
    .or(chunkOrConditions.slice(0, 30).join(','));

  if (chunkErr) {
    console.error('[chunkRows:error]', chunkErr);
  }

  for (const cr of chunkRows || []) {
    candidateIds.add(cr.memory_id);
  }

  if (candidateIds.size === 0) {
    return { query, matches: [] };
  }

  // Load all candidates details
  const { data: allMemories } = await admin
    .from('memories')
    .select('id, title, text_content, type')
    .in('id', Array.from(candidateIds));

  // Compound Multi-Dimensional Scoring
  const scored = [];
  for (const mem of allMemories || []) {
    const fullText = normalizeArabic(`${mem.title || ''} ${mem.text_content || ''}`);
    const candidateChunks = (chunkRows || [])
      .filter((cr) => cr.memory_id === mem.id)
      .map((cr) => normalizeArabic(cr.chunk_text))
      .join(' ');
    const combined = `${fullText} ${candidateChunks}`.toLowerCase();

    // 1. Numeric Match: must match as a standalone number, NOT a substring of an account number
    let matchedNumber = false;
    if (intent.numbers.length > 0) {
      matchedNumber = intent.numbers.some((num) => {
        const cleanNum = num.replace(/,/g, '');
        if (/[^\d]/.test(cleanNum)) {
          return combined.includes(cleanNum.toLowerCase());
        }
        // Numeric regex with boundary: cannot be preceded or followed by another digit
        const regex = new RegExp(`(^|[^0-9])${cleanNum}([^0-9]|$)`);
        return regex.test(combined) || (num.includes(',') && combined.includes(num.toLowerCase()));
      });
    }

    // 2. Month Match:
    let matchedMonth = false;
    if (intent.months.length > 0) {
      matchedMonth = intent.months.some((m) => {
        if (/[a-zA-Z\u0600-\u06FF]/.test(m)) {
          return combined.includes(m.toLowerCase());
        }
        // Month digit e.g. "08" or "8": must appear in month context
        const num = String(parseInt(m, 10));
        const monthContextRegex = new RegExp(`(شهر\\s*0?${num}|[/-]0?${num}[/-]|\\b0?${num}/)`);
        return monthContextRegex.test(combined);
      });
    }

    // 3. Concept Match
    let matchedConcept = false;
    if (intent.conceptExpansions.length > 0) {
      matchedConcept = intent.conceptExpansions.some((ex) => combined.includes(normalizeArabic(ex).toLowerCase()));
    }

    // 4. Keyword Match
    let matchedKeywords = 0;
    for (const t of terms) {
      if (combined.includes(normalizeArabic(t).toLowerCase())) {
        matchedKeywords++;
      }
    }

    // Negative constraints
    // If query has explicit number requirement, and candidate does NOT match number:
    if (intent.numbers.length > 0 && !matchedNumber) {
      continue; // Filter out completely
    }

    // If query has explicit month requirement, and candidate does NOT match month:
    if (intent.months.length > 0 && !matchedMonth) {
      continue; // Filter out completely
    }

    // If query has no matches at all:
    if (!matchedNumber && !matchedMonth && !matchedConcept && matchedKeywords === 0) {
      continue;
    }

    // Score computation
    let score = 0;
    if (matchedNumber) score += 120;
    if (matchedMonth) score += 100;
    if (matchedConcept) score += 80;
    score += matchedKeywords * 30;

    const queryDims = (intent.numbers.length > 0 ? 1 : 0) + (intent.months.length > 0 ? 1 : 0) + (intent.concepts.length > 0 ? 1 : 0);
    const matchedDims = (matchedNumber ? 1 : 0) + (matchedMonth ? 1 : 0) + (matchedConcept ? 1 : 0);

    if (queryDims >= 3 && matchedDims >= 3) score += 400;
    else if (queryDims >= 2 && matchedDims >= 2) score += 200;

    scored.push({ id: mem.id, title: mem.title, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return { query, matches: scored };
}

// ── Test Suite ────────────────────────────────────────────────────────────────
const salaryQueries = [
  'راتبي',
  'راتبي شهر 8',
  'راتبي أغسطس',
  'راتب أغسطس',
  'راتبي هذا الشهر',
  'مبلغ الفين',
  'ألفين',
  '2000',
  '٢٠٠٠',
  '2000 مبلغ',
  'المبلغ',
  'راتب 2000',
  'راتب شهر 8 مبلغ 2000',
];

const negativeQueries = [
  'راتبي شهر 7',
  'مبلغ 50000',
  'سيارة',
  'وصفة طبخ',
  'zxqv9281',
];

const hawalaQueries = [
  'حوالة',
  'حواله',
  'تحويل',
  'تحويل بنكي',
  'إيصال تحويل',
  'سند حوالة',
  'تحويل الراجحي',
  'الحوالة اللي حولت فيها 2500',
];

console.log('\n================ SALARY TEST SUITE ================');
let salaryPass = 0;
for (const q of salaryQueries) {
  const res = await executeSearch(q);
  const found = res.matches.some((m) => m.id === salaryId);
  const topScore = res.matches[0]?.score ?? 0;
  console.log(`[${found ? 'PASS' : 'FAIL'}] "${q}" -> found: ${found} (top score: ${topScore})`);
  if (found) salaryPass++;
}

console.log(`\nSalary queries passed: ${salaryPass} / ${salaryQueries.length}`);

console.log('\n================ NEGATIVE TEST SUITE ================');
let negPass = 0;
for (const q of negativeQueries) {
  const res = await executeSearch(q);
  const foundSalary = res.matches.some((m) => m.id === salaryId);
  const foundAny = res.matches.length > 0;
  const pass = !foundSalary && !foundAny;
  console.log(`[${pass ? 'PASS' : 'FAIL'}] "${q}" -> matches count: ${res.matches.length}`);
  if (pass) negPass++;
}
console.log(`Negative queries passed: ${negPass} / ${negativeQueries.length}`);

console.log('\n================ HAWALA TEST SUITE ================');
let hawalaPass = 0;
for (const q of hawalaQueries) {
  const res = await executeSearch(q);
  const found = res.matches.some((m) => m.id === hawalaId);
  const topScore = res.matches[0]?.score ?? 0;
  console.log(`[${found ? 'PASS' : 'FAIL'}] "${q}" -> found: ${found} (top score: ${topScore})`);
  if (found) hawalaPass++;
}
console.log(`Hawala queries passed: ${hawalaPass} / ${hawalaQueries.length}`);

