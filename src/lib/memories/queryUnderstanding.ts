/**
 * Zero-Cost Local Query Understanding & Intent Parser.
 *
 * Runs 100% locally with 0 AI API calls (< 1ms).
 *
 * Normalizes and extracts:
 *   1. Numbers in Arabic words (الفين -> 2000, 2,000).
 *   2. Eastern / Persian numerals (٢٠٠٠ -> 2000).
 *   3. Formatted digits with thousands separators (2,000 <-> 2000).
 *   4. Months across Arabic / English / numbers (شهر 8 <-> August <-> أغسطس <-> 08).
 *   5. High-frequency conceptual synonyms (راتبي <-> salary, حوالة <-> transfer).
 */

import { normalizeArabicForSearch } from '@/lib/documents/extract';

export interface ParsedQuery {
  rawQuery: string;
  normalizedQuery: string;
  /** Extracted numbers in all canonical forms (e.g. ["2000", "2,000", "الفين"]) */
  numbers: string[];
  /** Extracted month names and numbers (e.g. ["August", "أغسطس", "08", "8"]) */
  months: string[];
  /** Identified concept categories (e.g. ["salary", "amount"]) */
  concepts: string[];
  /** Broad search tokens covering cross-lingual terms, numbers, and month variations */
  expandedTokens: string[];
  /** True if structured numeric, month, or conceptual entities were found */
  hasStructuredIntent: boolean;
}

const ARABIC_WORD_NUMBERS: Record<string, string> = {
  // Ordered by length descending so multi-word or longer words match first
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

const MONTH_DATA = [
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

const CONCEPT_MAP = [
  {
    key: 'salary',
    triggers: ['راتب', 'راتبي', 'مرتب', 'مرتبي', 'معاش', 'معاشي', 'مسير', 'مسيرات', 'salary', 'payroll', 'wage', 'wages', 'income'],
    expansions: ['راتب', 'راتبي', 'salary', 'payroll'],
  },
  {
    key: 'transfer',
    triggers: ['حوالة', 'حواله', 'تحويل', 'إيصال', 'ايصال', 'سند', 'transfer', 'remittance', 'receipt', 'wire'],
    expansions: ['حوالة', 'تحويل', 'سند', 'transfer', 'receipt'],
  },
  {
    key: 'amount',
    triggers: ['مبلغ', 'قيمة', 'قدره', 'فلوس', 'اموال', 'أموال', 'amount', 'total', 'sum', 'price', 'sar', 'ريال'],
    expansions: ['مبلغ', 'amount', 'sar', 'ريال'],
  },
  {
    key: 'invoice',
    triggers: ['فاتورة', 'فاتوره', 'فواتير', 'سداد', 'مطالبة', 'invoice', 'bill', 'billing'],
    expansions: ['فاتورة', 'invoice', 'bill'],
  },
  {
    key: 'contract',
    triggers: ['عقد', 'اتفاقية', 'عقود', 'شروط', 'contract', 'agreement', 'terms'],
    expansions: ['عقد', 'contract', 'agreement'],
  },
  {
    key: 'rent',
    triggers: ['إيجار', 'ايجار', 'أجرة', 'اجرة', 'مستأجر', 'rent', 'lease'],
    expansions: ['إيجار', 'ايجار', 'rent', 'lease'],
  },
];

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
  const rawWords = trimmed.split(/[\s,،/\\-]+/).filter(Boolean);
  const normalizedWords = normalizedQuery.split(/[\s,،/\\-]+/).filter(Boolean);

  const numbers = new Set<string>();
  const months = new Set<string>();
  const concepts = new Set<string>();
  const expandedTokens = new Set<string>();

  // 1. Detect standard digits (with optional thousands separators e.g. 2,000 or 2000)
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
      numbers.add(word);
      expandedTokens.add(digitVal);
      expandedTokens.add(word);
      if (digitVal.length >= 4) {
        const withComma = Number(digitVal).toLocaleString('en-US');
        numbers.add(withComma);
        expandedTokens.add(withComma);
      }
    }
  }

  // 3. Detect Months (e.g. "شهر 8", "أغسطس", "August", "2026-08")
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

  // 4. Detect Intent Concepts
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
      c.expansions.forEach((ex) => expandedTokens.add(ex));
    }
  }

  // Add original normalized tokens
  for (const w of normalizedWords) {
    if (w.length > 1) expandedTokens.add(w);
  }

  return {
    rawQuery: trimmed,
    normalizedQuery,
    numbers: Array.from(numbers),
    months: Array.from(months),
    concepts: Array.from(concepts),
    expandedTokens: Array.from(expandedTokens),
    hasStructuredIntent: numbers.size > 0 || months.size > 0 || concepts.size > 0,
  };
}
