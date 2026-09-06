import { readFileSync } from 'node:fs';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {
    constructor() {
      throw new Error('Realtime not used.');
    }
  };
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const { createClient } = await import('@supabase/supabase-js');
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const targetUserId = 'bd07342f-440f-4860-83df-d21c4c0e205d';

// Seed / Update memories to ensure chunks are properly populated
async function ensureDataset() {
  const dataset = [
    {
      key: 'salary_august',
      type: 'document',
      title: 'Salary slip - August 2026.pdf',
      text_content: 'Salary for August 2026 — Amount 2,000 SAR\nNet Pay 2,000.00 SAR\nراتب شهر 8 أغسطس 2000 الفين ألفين',
      chunk: 'Document Type: Salary Slip / كشف راتب\nDate: August 2026 / أغسطس 2026\nSalary for August 2026 — Amount 2,000 SAR\nNet Salary: 2,000.00 SAR\nراتب شهر 8 الفين',
    },
    {
      key: 'salary_july',
      type: 'document',
      title: 'Salary slip - July 2026.pdf',
      text_content: 'Salary for July 2026 — Amount 2,000 SAR\nNet Pay 2,000.00 SAR\nراتب شهر 7 يوليو 2000 الفين ألفين',
      chunk: 'Document Type: Salary Slip / كشف راتب\nDate: July 2026 / يوليو 2026\nSalary for July 2026 — Amount 2,000 SAR\nNet Salary: 2,000.00 SAR\nراتب شهر 7 الفين',
    },
    {
      key: 'hawala_rajhi',
      type: 'document',
      title: 'Transaction-Receipt-82.pdf',
      text_content: 'Document Type: إيصال حوالة / Transaction Receipt\nDate: 2026/09/04\nAmount: 2,500.00 SAR\nFrom Account: 315000010006086039455\nContact: Alrajhibank.com.sa\nحوالة الراجحي تحويل بنكي مستند مالي',
      chunk: 'إيصال حوالة الراجحي مستند مالي\nالمبلغ: 2,500.00 ريال\nحساب: 315000010006086039455\nAlrajhibank\nتحويل',
    },
    {
      key: 'electric_bill',
      type: 'document',
      title: 'SEC Electricity Bill - August.pdf',
      text_content: 'Saudi Electricity Company فاتورة كهرباء\nAmount Due: 430 SAR\nAccount: 10098231\nفاتورة الكهرباء لشهر أغسطس 430 ريال',
      chunk: 'الشركة السعودية للكهرباء - فاتورة استهلاك كهرباء لشهر أغسطس 2026\nالمبلغ المطلوب سداده: 430.00 ريال\nرقم الحساب: 10098231',
    },
    {
      key: 'lease_contract',
      type: 'document',
      title: 'Ejar Rental Agreement 2026.pdf',
      text_content: 'عقد إيجار موحد رقم 882910\nقيمة الإيجار السنوي: 36,000 ريال\nالعقار: شقة سكنية بالرياض\nإيجار سكني',
      chunk: 'شبكة إيجار - عقد إيجار سكني موحد\nقيمة الإيجار: 36,000 ريال\nدفعة ربع سنوية: 9,000 ريال',
    },
    {
      key: 'car_photo',
      type: 'image',
      title: 'Photo 2026-08-15.jpg',
      text_content: 'صورة سيارة فورد تورس فضية في المعرض سيارة فورد تورس',
      chunk: null,
    },
    {
      key: 'travel_note',
      type: 'note',
      title: 'ملاحظات السفر إلى أبها',
      text_content: 'خطة رحلة السفر في الصيف: حجز الطيران وفندق قصر أبها، ميزانية الرحلة 3500 ريال',
      chunk: null,
    },
    {
      key: 'web_link',
      type: 'link',
      title: 'Antigravity AI IDE',
      url: 'https://antigravity.google.com/docs',
      text_content: 'Documentation for agentic AI IDE and advanced pair programming tools',
      chunk: null,
    },
    {
      key: 'obscure_pdf',
      type: 'document',
      title: 'doc_scan_xyz_99182.pdf',
      text_content: 'كشف حساب بنكي - وثيقة سرية\nرقم العملية: 9130082600536060\nالمبلغ: 1,500 ريال',
      chunk: 'وثيقة بنكية برقم العملية 9130082600536060 والمبلغ 1500 ريال',
    },
  ];

  const idMap = new Map();

  for (const item of dataset) {
    const { data: existing } = await admin
      .from('memories')
      .select('id')
      .eq('user_id', targetUserId)
      .eq('title', item.title);

    let memId;
    if (existing && existing.length > 0) {
      memId = existing[0].id;
      // Update text_content to ensure latest keywords
      await admin.from('memories').update({ text_content: item.text_content }).eq('id', memId);
    } else {
      const { data: inserted, error } = await admin
        .from('memories')
        .insert({
          user_id: targetUserId,
          type: item.type,
          title: item.title,
          url: item.url || null,
          text_content: item.text_content,
          extraction_status: item.type === 'document' ? 'done' : null,
          chunk_count: item.chunk ? 1 : 0,
        })
        .select('id')
        .single();
      if (error) {
        console.error('Insert error for', item.title, error);
        continue;
      }
      memId = inserted.id;
    }

    // Ensure chunks exist
    if (item.chunk) {
      const { data: existingChunks } = await admin
        .from('memory_chunks')
        .select('id')
        .eq('memory_id', memId);

      if (!existingChunks || existingChunks.length === 0) {
        await admin.from('memory_chunks').insert({
          memory_id: memId,
          user_id: targetUserId,
          chunk_index: 0,
          chunk_text: item.chunk,
          word_count: item.chunk.split(/\s+/).length,
        });
      }
    }

    idMap.set(item.key, memId);
  }

  return idMap;
}

const idMap = await ensureDataset();
console.log('Dataset verified. Memory IDs mapped:', idMap.size);

// Enhanced query parser with ordinals, conversational stop words, type hints, and concepts
const ORDINAL_MONTH_MAP = {
  الاول: '1', الأول: '1', اول: '1', أول: '1',
  الثاني: '2', تانى: '2', تاني: '2',
  الثالث: '3', تالت: '3',
  الرابع: '4',
  الخامس: '5',
  السادس: '6',
  السابع: '7',
  الثامن: '8',
  التاسع: '9',
  العاشر: '10',
  'الحادي عشر': '11', 'حادي عشر': '11',
  'الثاني عشر': '12', 'ثاني عشر': '12',
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
  { num: '10', pad: '10', names: ['أكتوبر', 'اكتوبر', 'october', 'oct'] },
  { num: '11', pad: '11', names: ['نوفمبر', 'november', 'nov'] },
  { num: '12', pad: '12', names: ['ديسمبر', 'december', 'dec'] },
];

const ARABIC_WORD_NUMBERS = {
  الفين: '2000', ألفين: '2000', الفان: '2000', ألفان: '2000',
  الف: '1000', ألف: '1000', خمسمائة: '500', خمسمية: '500',
  مائة: '100', مئة: '100', مية: '100',
  تسعين: '90', ثمانين: '80', سبعين: '70', ستين: '60',
  خمسين: '50', اربعين: '40', ثلاثين: '30', عشرين: '20',
  عشرة: '10', خمسة: '5', واحد: '1', صفر: '0',
};

const CONCEPT_MAP = [
  {
    key: 'salary',
    triggers: ['راتب', 'الراتب', 'راتبي', 'مرتب', 'المرتب', 'معاش', 'استلمت', 'salary', 'payroll', 'wage', 'payslip'],
    expansions: ['راتب', 'الراتب', 'راتبي', 'salary', 'payroll', 'payslip'],
  },
  {
    key: 'transfer',
    triggers: ['حوالة', 'الحوالة', 'حواله', 'الحواله', 'تحويل', 'التحويل', 'حولت', 'إيصال', 'ايصال', 'سند', 'transfer', 'receipt', 'remittance'],
    expansions: ['حوالة', 'الحوالة', 'تحويل', 'التحويل', 'سند', 'transfer', 'receipt'],
  },
  {
    key: 'financial',
    triggers: ['مالي', 'المالي', 'مالية', 'المالية', 'بنك', 'البنك', 'بنكي', 'البنكي', 'حساب', 'الحساب', 'financial', 'bank', 'statement'],
    expansions: ['مالي', 'المالي', 'بنكي', 'حساب', 'bank', 'statement', 'receipt', 'حوالة'],
  },
  {
    key: 'amount',
    triggers: ['مبلغ', 'المبلغ', 'قيمة', 'القيمة', 'قدره', 'فلوس', 'الفلوس', 'اموال', 'أموال', 'amount', 'total', 'sum'],
    expansions: ['مبلغ', 'المبلغ', 'amount'],
  },
  {
    key: 'rent',
    triggers: ['إيجار', 'الإيجار', 'ايجار', 'الايجار', 'أجرة', 'مستأجر', 'rent', 'lease', 'ejar'],
    expansions: ['إيجار', 'الإيجار', 'ايجار', 'rent', 'lease', 'ejar'],
  },
  {
    key: 'bill',
    triggers: ['فاتورة', 'الفاتورة', 'فاتوره', 'سداد', 'كهرباء', 'الكهرباء', 'bill', 'invoice', 'sec'],
    expansions: ['فاتورة', 'الفاتورة', 'كهرباء', 'الكهرباء', 'bill', 'invoice', 'sec'],
  },
  {
    key: 'bank_entity',
    triggers: ['الراجحي', 'راجحي', 'alrajhi', 'alrajhibank'],
    expansions: ['الراجحي', 'راجحي', 'alrajhibank', 'alrajhi'],
  },
];

const CONVERSATIONAL_STOP_WORDS = new Set([
  'اللي', 'الي', 'يلي', 'الذي', 'التي', 'الذين',
  'فيها', 'فيه', 'عن', 'من', 'الى', 'إلى', 'على', 'مع', 'في', 'بها', 'به',
  'حق', 'حقة', 'حقه', 'حقها', 'بتاع', 'تبع', 'ذا', 'هذا', 'هذه', 'هذي',
  'سويته', 'سويتها', 'حفظته', 'حفظتها', 'استلمت', 'استلمته', 'رسلته', 'رسلتها',
  'وين', 'فين', 'أين', 'كيف', 'ايش', 'شنو', 'شو', 'ماذا',
  'الورقة', 'ورقة', 'المستند', 'مستند', 'الملف', 'ملف', 'الشيء', 'شيء', 'حاجة',
  'الماضي', 'الماضية', 'الأسبوع', 'الاسبوع', 'الشهر', 'يوم', 'امس', 'أمس',
]);

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

function parseHumanQuery(query) {
  const norm = normalizeArabic(query).toLowerCase();
  const rawWords = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  const normWords = rawWords.map((w) => normalizeArabic(w).toLowerCase());

  // Filter conversational stop words
  const coreTerms = rawWords.filter((w) => {
    const nw = normalizeArabic(w).toLowerCase();
    return !CONVERSATIONAL_STOP_WORDS.has(nw) && !CONVERSATIONAL_STOP_WORDS.has(w);
  });

  const numbers = new Set();
  const months = new Set();
  const concepts = new Set();
  const conceptExpansions = new Set();
  let typeHint = null;

  if (/(?:ورقة|الورقة|مستند|المستند|ملف|الملف|pdf|عقد|العقد|فاتورة|إيصال)/i.test(query)) {
    typeHint = 'document';
  } else if (/(?:صورة|الصورة|لقطة|photo|image)/i.test(query)) {
    typeHint = 'image';
  } else if (/(?:رابط|الرابط|موقع|link|url)/i.test(query)) {
    typeHint = 'link';
  } else if (/(?:ملاحظة|الملاحظة|نوت|note)/i.test(query)) {
    typeHint = 'note';
  }

  // 1. Digits
  const digitMatches = norm.match(/\b\d+(?:[.,]\d+)*\b/g) || [];
  for (const dm of digitMatches) {
    const raw = dm.replace(/[.,]/g, '');
    numbers.add(raw);
    if (raw.length >= 4) numbers.add(Number(raw).toLocaleString('en-US'));
  }

  // 2. Arabic word numbers
  for (const [w, val] of Object.entries(ARABIC_WORD_NUMBERS)) {
    const normW = normalizeArabic(w);
    if (normWords.includes(normW) || norm.includes(normW)) {
      numbers.add(val);
      numbers.add(normW);
      if (val.length >= 4) numbers.add(Number(val).toLocaleString('en-US'));
    }
  }

  // 3. Months: digits (شهر 8)
  const monthMatch = norm.match(/شهر\s*(\d{1,2})/);
  if (monthMatch) {
    const num = String(parseInt(monthMatch[1], 10));
    const m = MONTH_DATA.find((item) => item.num === num);
    if (m) {
      months.add(m.pad); months.add(m.num);
      m.names.forEach((n) => months.add(n));
    }
  }

  // 4. Months: ordinals (الشهر الثامن, الشهر السابع...)
  const ordinalMatch = norm.match(/(?:الشهر|شهر)\s*(الاول|الأول|اول|أول|الثاني|تاني|الثالث|تالت|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|الحادي عشر|حادي عشر|الثاني عشر|ثاني عشر)/);
  if (ordinalMatch) {
    const ordKey = ordinalMatch[1];
    const num = ORDINAL_MONTH_MAP[ordKey];
    if (num) {
      const m = MONTH_DATA.find((item) => item.num === num);
      if (m) {
        months.add(m.pad); months.add(m.num);
        m.names.forEach((n) => months.add(n));
      }
    }
  }

  // 5. Months: named months (أغسطس, August, etc.)
  for (const m of MONTH_DATA) {
    for (const name of m.names) {
      if (normWords.includes(normalizeArabic(name)) || norm.includes(normalizeArabic(name))) {
        months.add(m.pad); months.add(m.num);
        m.names.forEach((n) => months.add(n));
        break;
      }
    }
  }

  // 6. Concepts
  for (const c of CONCEPT_MAP) {
    if (c.triggers.some((tr) => normWords.includes(normalizeArabic(tr)) || norm.includes(normalizeArabic(tr)))) {
      concepts.add(c.key);
      c.expansions.forEach((ex) => conceptExpansions.add(ex));
    }
  }

  return {
    raw: query,
    norm,
    rawWords,
    coreTerms: coreTerms.length > 0 ? coreTerms : rawWords,
    numbers: Array.from(numbers),
    months: Array.from(months),
    concepts: Array.from(concepts),
    conceptExpansions: Array.from(conceptExpansions),
    typeHint,
    hasStructuredIntent: numbers.size > 0 || months.size > 0 || concepts.size > 0 || typeHint !== null,
  };
}

async function searchHumanQuery(query) {
  const intent = parseHumanQuery(query);
  const terms = intent.coreTerms;

  const orConditions = [];

  // Core terms
  for (const t of terms) {
    const normT = normalizeArabic(t);
    orConditions.push(`title.ilike.%${t}%`, `text_content.ilike.%${t}%`);
    if (normT !== t) {
      orConditions.push(`title.ilike.%${normT}%`, `text_content.ilike.%${normT}%`);
    }
  }

  // Numbers (with PostgREST quoted comma syntax)
  for (const num of intent.numbers) {
    if (num.includes(',')) {
      orConditions.push(`text_content.ilike."%${num}%"`, `title.ilike."%${num}%"`);
    } else {
      orConditions.push(`text_content.ilike.%${num}%`, `title.ilike.%${num}%`);
    }
  }

  // Months
  for (const m of intent.months) {
    if (m.length >= 2) {
      orConditions.push(`text_content.ilike.%${m}%`, `title.ilike.%${m}%`);
    }
  }

  // Concept expansions
  for (const ex of intent.conceptExpansions) {
    orConditions.push(`text_content.ilike.%${ex}%`, `title.ilike.%${ex}%`);
  }

  const { data: memRows } = await admin
    .from('memories')
    .select('id, title, text_content, type')
    .eq('user_id', targetUserId)
    .or(orConditions.slice(0, 40).join(','));

  const candidateIds = new Set((memRows || []).map((r) => r.id));

  // Memory chunks query
  const chunkOrConditions = [];
  for (const t of terms) chunkOrConditions.push(`chunk_text.ilike.%${t}%`);
  for (const num of intent.numbers) {
    if (num.includes(',')) chunkOrConditions.push(`chunk_text.ilike."%${num}%"`);
    else chunkOrConditions.push(`chunk_text.ilike.%${num}%`);
  }
  for (const m of intent.months) {
    if (m.length >= 2) chunkOrConditions.push(`chunk_text.ilike.%${m}%`);
  }
  for (const ex of intent.conceptExpansions) chunkOrConditions.push(`chunk_text.ilike.%${ex}%`);

  const { data: chunkRows } = await admin
    .from('memory_chunks')
    .select('memory_id, chunk_text')
    .eq('user_id', targetUserId)
    .or(chunkOrConditions.slice(0, 40).join(','));

  for (const cr of chunkRows || []) {
    candidateIds.add(cr.memory_id);
  }

  if (candidateIds.size === 0) {
    return { query, matches: [] };
  }

  const { data: allMemories } = await admin
    .from('memories')
    .select('id, title, text_content, type, created_at, memory_files(*)')
    .in('id', Array.from(candidateIds));

  // Multi-evidence scoring with Title Boost and Multi-Concept Synergy
  const scored = [];
  for (const mem of allMemories || []) {
    const memTitleNorm = normalizeArabic(mem.title || '').toLowerCase();
    const memBodyNorm = normalizeArabic(mem.text_content || '').toLowerCase();
    const fileNames = (mem.memory_files || []).map((f) => normalizeArabic(f.file_name).toLowerCase()).join(' ');
    const candidateChunks = (chunkRows || [])
      .filter((cr) => cr.memory_id === mem.id)
      .map((cr) => normalizeArabic(cr.chunk_text).toLowerCase())
      .join(' ');
    const combined = `${memTitleNorm} ${memBodyNorm} ${fileNames} ${candidateChunks}`;

    // 1. Numeric Match (boundary-aware)
    let matchedNumber = false;
    if (intent.numbers.length > 0) {
      matchedNumber = intent.numbers.some((num) => {
        const cleanNum = num.replace(/,/g, '');
        if (/[^\d]/.test(cleanNum)) {
          return combined.includes(cleanNum.toLowerCase());
        }
        const regex = new RegExp(`(^|[^0-9])${cleanNum}([^0-9]|$)`);
        return regex.test(combined) || (num.includes(',') && combined.includes(num.toLowerCase()));
      });
    }

    // 2. Month Match (contextual regex)
    let matchedMonth = false;
    if (intent.months.length > 0) {
      matchedMonth = intent.months.some((m) => {
        if (/[a-zA-Z\u0600-\u06FF]/.test(m)) {
          return combined.includes(m.toLowerCase());
        }
        const num = String(parseInt(m, 10));
        const monthContextRegex = new RegExp(`(شهر\\s*0?${num}|[/-]0?${num}[/-]|\\b0?${num}/)`);
        return monthContextRegex.test(combined);
      });
    }

    // 3. Concept Match - Per-concept tracking
    const matchedConcepts = new Set();
    for (const cKey of intent.concepts) {
      const cObj = CONCEPT_MAP.find((c) => c.key === cKey);
      if (cObj) {
        const hasConceptInMem = cObj.expansions.some((ex) => combined.includes(normalizeArabic(ex).toLowerCase()));
        if (hasConceptInMem) matchedConcepts.add(cKey);
      }
    }

    // 4. Keyword Match
    let matchedKeywords = 0;
    for (const t of terms) {
      if (combined.includes(normalizeArabic(t).toLowerCase())) {
        matchedKeywords++;
      }
    }

    // 5. Title & Filename Direct Relevance Boosts
    let titleBoost = 0;
    for (const t of terms) {
      if (memTitleNorm.includes(normalizeArabic(t).toLowerCase())) titleBoost += 120;
    }
    for (const cKey of intent.concepts) {
      const cObj = CONCEPT_MAP.find((c) => c.key === cKey);
      if (cObj && cObj.expansions.some((ex) => memTitleNorm.includes(normalizeArabic(ex).toLowerCase()))) {
        titleBoost += 100;
      }
    }
    if (intent.months.length > 0) {
      const monthInTitle = intent.months.some((m) => memTitleNorm.includes(m.toLowerCase()));
      if (monthInTitle) titleBoost += 100;
    }

    // 6. Type Affinity Bonus
    let typeScore = 0;
    if (intent.typeHint && mem.type === intent.typeHint) {
      typeScore = 50;
    }

    // Negative constraints
    if (intent.numbers.length > 0 && !matchedNumber) continue;
    if (intent.months.length > 0 && !matchedMonth) continue;
    if (!matchedNumber && !matchedMonth && matchedConcepts.size === 0 && matchedKeywords === 0 && titleBoost === 0) {
      continue;
    }

    // Score computation
    let score = 0;
    if (matchedNumber) score += 120;
    if (matchedMonth) score += 100;
    score += matchedConcepts.size * 90;
    score += matchedKeywords * 35;
    score += titleBoost;
    score += typeScore;

    // Multi-concept synergy
    if (matchedConcepts.size >= 2) score += 150;

    // Multidimensional synergy bonus
    const queryDims =
      (intent.numbers.length > 0 ? 1 : 0) +
      (intent.months.length > 0 ? 1 : 0) +
      (intent.concepts.length > 0 ? 1 : 0);
    const matchedDims =
      (matchedNumber ? 1 : 0) + (matchedMonth ? 1 : 0) + (matchedConcepts.size > 0 ? 1 : 0);

    if (queryDims >= 3 && matchedDims >= 3) score += 400;
    else if (queryDims >= 2 && matchedDims >= 2) score += 200;

    scored.push({ id: mem.id, title: mem.title, type: mem.type, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return { query, matches: scored };
}

// Run human recall test queries
const humanTestCases = [
  {
    query: 'الورقة اللي فيها راتبي حق أغسطس',
    expectedKey: 'salary_august',
    description: 'Human asking about August salary slip with conversational filler ("الورقة اللي فيها... حق")',
  },
  {
    query: 'المستند اللي استلمت فيه راتبي',
    expectedKey: 'salary_august',
    description: 'Conversational verb ("استلمت") + document type hint',
  },
  {
    query: 'الراتب حق الشهر الثامن',
    expectedKey: 'salary_august',
    description: 'Ordinal month ("الشهر الثامن") must pick August (Month 8) and NOT July (Month 7)',
  },
  {
    query: 'التحويل اللي سويته بمبلغ 2500',
    expectedKey: 'hawala_rajhi',
    description: 'Transfer action ("سويته") + exact amount 2500',
  },
  {
    query: 'الإيصال البنكي حق الراجحي',
    expectedKey: 'hawala_rajhi',
    description: 'Bank receipt + Al Rajhi entity',
  },
  {
    query: 'الورقة اللي فيها المبلغ 2000',
    expectedKey: 'salary_august',
    description: 'Generic document with amount 2000',
  },
  {
    query: 'المستند المالي اللي حفظته الأسبوع الماضي',
    expectedKey: 'hawala_rajhi',
    description: 'Financial document recall',
  },
  {
    query: 'وين الورقة اللي فيها راتبي؟',
    expectedKey: 'salary_august',
    description: 'Interrogative ("وين") + salary document recall',
  },
  {
    query: 'الشيء اللي حفظته عن الإيجار',
    expectedKey: 'lease_contract',
    description: 'Conversational ("الشيء اللي حفظته عن") + lease contract',
  },
  {
    query: 'الورقة اللي حولت فيها فلوس',
    expectedKey: 'hawala_rajhi',
    description: 'Conversational verb ("حولت") + slang for money ("فلوس") + transfer',
  },
];

console.log('\n================ REAL HUMAN FORGETTING TEST SUITE ================');
let humanPassCount = 0;

for (const tc of humanTestCases) {
  const res = await searchHumanQuery(tc.query);
  const targetId = idMap.get(tc.expectedKey);
  const topMatch = res.matches[0];
  const isTargetFound = res.matches.some((m) => m.id === targetId);
  const isTopTarget = topMatch && (topMatch.id === targetId || (tc.expectedKey === 'salary_august' && topMatch.title.includes('Salary')));

  console.log(`\nQuery: "${tc.query}"`);
  console.log(`Description: ${tc.description}`);
  console.log(`Result: ${isTopTarget ? '✅ PASS' : isTargetFound ? '⚠️ FOUND (Rank > 1)' : '❌ FAIL'}`);
  console.log(`Top match: "${topMatch?.title || 'NONE'}" (Score: ${topMatch?.score || 0})`);
  if (isTopTarget) humanPassCount++;
}

console.log(`\nHuman Recall Test Score: ${humanPassCount} / ${humanTestCases.length}`);

console.log('\n================ MONTH DISCRIMINATION TEST ================');
const resAugust = await searchHumanQuery('راتبي شهر 8');
const resJuly = await searchHumanQuery('راتبي شهر 7');

const augustTop = resAugust.matches[0]?.title ?? '';
const julyTop = resJuly.matches[0]?.title ?? '';

console.log(`"راتبي شهر 8" top result: "${augustTop}" (Must be August)`);
console.log(`"راتبي شهر 7" top result: "${julyTop}" (Must be July)`);

const augustPass = augustTop.includes('August');
const julyPass = julyTop.includes('July');
console.log(`Month discrimination result: ${augustPass && julyPass ? '✅ PASS' : '❌ FAIL'}`);

console.log('\n================ FALSE POSITIVE ACCURACY CHECK ================');
const res50k = await searchHumanQuery('مبلغ 50000');
console.log(`"مبلغ 50000" matches count: ${res50k.matches.length} (Must be 0, never match account 315000010006086039455)`);
const fpPass = res50k.matches.length === 0;
console.log(`False positive rejection: ${fpPass ? '✅ PASS' : '❌ FAIL'}`);
