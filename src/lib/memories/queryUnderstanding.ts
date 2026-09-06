/**
 * Zero-Cost Local Query Understanding & Intent Parser.
 *
 * Runs 100% locally with 0 AI API calls (< 0.5ms).
 *
 * Normalizes and extracts:
 *   1. Numbers in Arabic words (الفين -> 2000, 2,000).
 *   2. Eastern / Persian numerals (٢٠٠٠ -> 2000).
 *   3. Formatted digits with thousands separators (2,000 <-> 2000).
 *   4. Contextual Months across Arabic / English / numbers (شهر 8 <-> August <-> أغسطس <-> 08).
 *   5. Ordinal months (الشهر الثامن -> 8 / August).
 *   6. Conversational stop words stripped for core term extraction ("الورقة اللي فيها راتبي" -> "راتبي").
 *   7. Document / Artifact type hints ("ورقة/مستند" -> document, "صورة" -> image).
 *   8. Concept synonyms (راتب <-> salary, حوالة <-> transfer, فاتورة <-> bill).
 */

import { normalizeArabicForSearch } from '@/lib/documents/extract';

export interface ParsedQuery {
  rawQuery: string;
  normalizedQuery: string;
  /** Substantive search terms stripped of conversational fillers (e.g. ["راتبي", "أغسطس"]) */
  coreTerms: string[];
  /** Extracted numbers in canonical forms (e.g. ["2000", "2,000", "الفين"]) */
  numbers: string[];
  /** Extracted month names and numbers (e.g. ["August", "أغسطس", "08", "8"]) */
  months: string[];
  /** Identified concept categories (e.g. ["salary", "transfer", "financial"]) */
  concepts: string[];
  /** Domain expansions for identified concepts */
  conceptExpansions: string[];
  /** Inferred artifact type hint if user mentioned 'ورقة/مستند/صورة/رابط' */
  typeHint: 'document' | 'image' | 'link' | 'note' | null;
  /** Broad search tokens covering cross-lingual terms, numbers, and month variations */
  expandedTokens: string[];
  /** True if structured numeric, month, conceptual, or type entities were found */
  hasStructuredIntent: boolean;
}

export const ARABIC_WORD_NUMBERS: Record<string, string> = {
  مليونين: '2000000',
  مليون: '1000000',
  ألفين: '2000',
  الفين: '2000',
  ألفان: '2000',
  الفان: '2000',
  ألف: '1000',
  الف: '1000',
  خمسمائة: '500',
  خمسمية: '500',
  ثلاثمائة: '300',
  ثلاثمية: '300',
  مائتين: '200',
  مئتين: '200',
  ميتين: '200',
  مائة: '100',
  مئة: '100',
  مية: '100',
  ميه: '100',
  تسعين: '90',
  تسعون: '90',
  ثمانين: '80',
  ثمانون: '80',
  سبعين: '70',
  سبعون: '70',
  ستين: '60',
  ستون: '60',
  خمسين: '50',
  خمسون: '50',
  أربعين: '40',
  اربعين: '40',
  أربعون: '40',
  اربعون: '40',
  ثلاثين: '30',
  ثلاثون: '30',
  عشرين: '20',
  عشرون: '20',
  عشرة: '10',
  عشره: '10',
  عشر: '10',
  تسعة: '9',
  تسعه: '9',
  تسع: '9',
  ثمانية: '8',
  ثمانيه: '8',
  ثماني: '8',
  ثمان: '8',
  سبعة: '7',
  سبعه: '7',
  سبع: '7',
  ستة: '6',
  سته: '6',
  ست: '6',
  خمسة: '5',
  خمسه: '5',
  خمس: '5',
  أربعة: '4',
  اربعة: '4',
  أربع: '4',
  اربع: '4',
  ثلاثة: '3',
  ثلاثه: '3',
  ثلاث: '3',
  اثنين: '2',
  اثنان: '2',
  واحد: '1',
  صفر: '0',
};

export const ORDINAL_MONTH_MAP: Record<string, string> = {
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

export const MONTH_DATA = [
  { num: '1',  pad: '01', names: ['يناير', 'كانون الثاني', 'january', 'jan'] },
  { num: '2',  pad: '02', names: ['فبراير', 'شباط', 'february', 'feb'] },
  { num: '3',  pad: '03', names: ['مارس', 'آذار', 'ازار', 'march', 'mar'] },
  { num: '4',  pad: '04', names: ['أبريل', 'ابريل', 'نيسان', 'april', 'apr'] },
  { num: '5',  pad: '05', names: ['مايو', 'أيار', 'ايار', 'may'] },
  { num: '6',  pad: '06', names: ['يونيو', 'حزيران', 'june', 'jun'] },
  { num: '7',  pad: '07', names: ['يوليو', 'تموز', 'july', 'jul'] },
  { num: '8',  pad: '08', names: ['أغسطس', 'اغسطس', 'آب', 'اب', 'august', 'aug'] },
  { num: '9',  pad: '09', names: ['سبتمبر', 'أيلول', 'ايلول', 'september', 'sep'] },
  { num: '10', pad: '10', names: ['أكتوبر', 'اكتوبر', 'تشرين الأول', 'تشرين الاول', 'october', 'oct'] },
  { num: '11', pad: '11', names: ['نوفمبر', 'تشرين الثاني', 'november', 'nov'] },
  { num: '12', pad: '12', names: ['ديسمبر', 'كانون الأول', 'كانون الاول', 'december', 'dec'] },
];

export const CONCEPT_MAP = [
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
  {
    key: 'car',
    triggers: ['سيارة', 'السيارة', 'فورد', 'تورس', 'car', 'vehicle'],
    expansions: ['سيارة', 'السيارة', 'car', 'vehicle'],
  },
  {
    key: 'travel',
    triggers: ['سفر', 'السفر', 'رحلة', 'الرحلة', 'طيران', 'فندق', 'travel', 'flight', 'trip'],
    expansions: ['سفر', 'السفر', 'رحلة', 'الرحلة', 'travel'],
  },
];

export const CONVERSATIONAL_STOP_WORDS = new Set([
  'اللي', 'الي', 'يلي', 'الذي', 'التي', 'الذين',
  'فيها', 'فيه', 'عن', 'من', 'الى', 'إلى', 'على', 'مع', 'في', 'بها', 'به',
  'حق', 'حقة', 'حقه', 'حقها', 'بتاع', 'تبع', 'ذا', 'هذا', 'هذه', 'هذي',
  'سويته', 'سويتها', 'حفظته', 'حفظتها', 'استلمت', 'استلمته', 'رسلته', 'رسلتها',
  'وين', 'فين', 'أين', 'كيف', 'ايش', 'شنو', 'شو', 'ماذا',
  'الورقة', 'ورقة', 'المستند', 'مستند', 'الملف', 'ملف', 'الشيء', 'شيء', 'حاجة',
  'الماضي', 'الماضية', 'الأسبوع', 'الاسبوع', 'الشهر', 'يوم', 'امس', 'أمس',
]);

/**
 * Normalizes Eastern Arabic / Persian digits to Western digits 0-9.
 */
export function normalizeDigits(str: string): string {
  return str
    .replace(/[٠۰]/g, '0').replace(/[١۱]/g, '1').replace(/[٢۲]/g, '2')
    .replace(/[٣۳]/g, '3').replace(/[٤۴]/g, '4').replace(/[٥۵]/g, '5')
    .replace(/[٦۶]/g, '6').replace(/[٧۷]/g, '7').replace(/[٨۸]/g, '8')
    .replace(/[٩۹]/g, '9');
}

/**
 * Fast, deterministic query parser for natural language searches.
 */
export function parseQueryIntent(rawQuery: string): ParsedQuery {
  const trimmed = rawQuery.trim();
  const normalizedQuery = normalizeArabicForSearch(normalizeDigits(trimmed)).toLowerCase();
  const rawWords = trimmed.match(/[\p{L}\p{N}]+/gu) ?? [];
  const normalizedWords = rawWords.map((w) => normalizeArabicForSearch(normalizeDigits(w)).toLowerCase());

  // Filter conversational stop words to isolate substantive query terms
  const coreTerms = rawWords.filter((w) => {
    const nw = normalizeArabicForSearch(w).toLowerCase();
    return !CONVERSATIONAL_STOP_WORDS.has(nw) && !CONVERSATIONAL_STOP_WORDS.has(w);
  });

  const numbers = new Set<string>();
  const months = new Set<string>();
  const concepts = new Set<string>();
  const conceptExpansions = new Set<string>();
  const expandedTokens = new Set<string>();
  let typeHint: 'document' | 'image' | 'link' | 'note' | null = null;

  // Artifact Type Hint Detection
  if (/(?:ورقة|الورقة|مستند|المستند|ملف|الملف|pdf|عقد|العقد|فاتورة|إيصال)/i.test(trimmed)) {
    typeHint = 'document';
  } else if (/(?:صورة|الصورة|لقطة|photo|image)/i.test(trimmed)) {
    typeHint = 'image';
  } else if (/(?:رابط|الرابط|موقع|link|url)/i.test(trimmed)) {
    typeHint = 'link';
  } else if (/(?:ملاحظة|الملاحظة|نوت|note)/i.test(trimmed)) {
    typeHint = 'note';
  }

  // 1. Detect standard digits (with boundary check e.g. 2,000 or 2000)
  const digitMatches = normalizeDigits(trimmed).match(/\b\d+(?:[.,]\d+)*\b/g) || [];
  for (const dm of digitMatches) {
    const rawDigits = dm.replace(/[.,]/g, '');
    if (rawDigits) {
      numbers.add(rawDigits);
      expandedTokens.add(rawDigits);
      if (rawDigits.length >= 4) {
        const withComma = Number(rawDigits).toLocaleString('en-US');
        numbers.add(withComma);
        expandedTokens.add(withComma);
      }
    }
  }

  // 2. Detect Arabic number words by whole-word matching
  for (const [word, digitVal] of Object.entries(ARABIC_WORD_NUMBERS)) {
    const normWord = normalizeArabicForSearch(word).toLowerCase();
    const hasWord =
      normalizedWords.includes(normWord) ||
      rawWords.some((w) => w.toLowerCase() === word.toLowerCase());

    if (hasWord) {
      numbers.add(digitVal);
      numbers.add(normWord);
      expandedTokens.add(digitVal);
      expandedTokens.add(word);
      if (digitVal.length >= 4) {
        const withComma = Number(digitVal).toLocaleString('en-US');
        numbers.add(withComma);
        expandedTokens.add(withComma);
      }
    }
  }

  // 3. Detect Months via Digits (e.g. "شهر 8", "شهر 08")
  const monthPattern = /(?:شهر|month)\s*(\d{1,2})/i;
  const monthMatch = normalizeDigits(trimmed).match(monthPattern);
  if (monthMatch && monthMatch[1]) {
    const num = String(parseInt(monthMatch[1], 10));
    const mData = MONTH_DATA.find((m) => m.num === num);
    if (mData) {
      months.add(mData.pad);
      months.add(mData.num);
      mData.names.forEach((n) => {
        months.add(n);
        expandedTokens.add(n);
      });
      expandedTokens.add(mData.pad);
      expandedTokens.add(mData.num);
    }
  }

  // 4. Detect Months via Ordinals (e.g. "الشهر الثامن", "الشهر السابع")
  const ordinalPattern = /(?:الشهر|شهر)\s*(الاول|الأول|اول|أول|الثاني|تانى|تاني|الثالث|تالت|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|الحادي عشر|حادي عشر|الثاني عشر|ثاني عشر)/;
  const ordinalMatch = normalizedQuery.match(ordinalPattern);
  if (ordinalMatch && ordinalMatch[1]) {
    const ordKey = ordinalMatch[1];
    const num = ORDINAL_MONTH_MAP[ordKey];
    if (num) {
      const mData = MONTH_DATA.find((m) => m.num === num);
      if (mData) {
        months.add(mData.pad);
        months.add(mData.num);
        mData.names.forEach((n) => {
          months.add(n);
          expandedTokens.add(n);
        });
        expandedTokens.add(mData.pad);
        expandedTokens.add(mData.num);
      }
    }
  }

  // 5. Detect Months via Named Months (e.g. "أغسطس", "August")
  for (const mData of MONTH_DATA) {
    const matched = mData.names.some((name) => {
      const normName = normalizeArabicForSearch(name).toLowerCase();
      return (
        normalizedWords.includes(normName) ||
        rawWords.some((w) => w.toLowerCase() === name.toLowerCase())
      );
    });
    if (matched) {
      months.add(mData.pad);
      months.add(mData.num);
      mData.names.forEach((n) => {
        months.add(n);
        expandedTokens.add(n);
      });
      expandedTokens.add(mData.pad);
      expandedTokens.add(mData.num);
    }
  }

  // 6. Detect Intent Concepts
  for (const c of CONCEPT_MAP) {
    const matched = c.triggers.some((tr) => {
      const normTr = normalizeArabicForSearch(tr).toLowerCase();
      return (
        normalizedWords.includes(normTr) ||
        rawWords.some((w) => w.toLowerCase() === tr.toLowerCase())
      );
    });
    if (matched) {
      concepts.add(c.key);
      c.expansions.forEach((ex) => {
        conceptExpansions.add(ex);
        expandedTokens.add(ex);
      });
    }
  }

  // Add original normalized tokens
  for (const w of normalizedWords) {
    if (w.length > 1) expandedTokens.add(w);
  }

  return {
    rawQuery: trimmed,
    normalizedQuery,
    coreTerms: coreTerms.length > 0 ? coreTerms : rawWords,
    numbers: Array.from(numbers),
    months: Array.from(months),
    concepts: Array.from(concepts),
    conceptExpansions: Array.from(conceptExpansions),
    typeHint,
    expandedTokens: Array.from(expandedTokens),
    hasStructuredIntent: numbers.size > 0 || months.size > 0 || concepts.size > 0 || typeHint !== null,
  };
}
