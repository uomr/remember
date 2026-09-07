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
 *   6. Dynamic Relative Temporal Reasoning (الشهر الماضي -> Month -1 e.g. August 8 when current is Sept 9).
 *   7. Entity & Attribute Composition (e.g. bumper + rear + Accent vs front + Yaris).
 *   8. Arabic Concept Equivalence & Orthographic Normalization (أفعى <-> ثعبان <-> snake).
 *   9. Dedicated URL / Link Intent (رابط, موقع محلي, IP, domain).
 *  10. Conversational stop words stripped for core term extraction without corrupting temporal anchors.
 */

import { normalizeArabicForSearch } from '@/lib/documents/extract';

export interface TemporalConstraint {
  kind: 'relative_month' | 'exact_month' | 'relative_day' | 'year';
  targetMonth?: string; // e.g. "8", "08"
  targetMonthNum?: number; // e.g. 8
  monthPad?: string; // e.g. "08"
  monthNames?: string[]; // ["أغسطس", "August", ...]
  targetYear?: string; // e.g. "2026"
  description: string;
}

export interface VehicleConstraint {
  brand?: string; // 'nissan', 'ford', 'hyundai', 'toyota'
  model?: string; // 'accent', 'taurus', 'yaris'
  rawMention: string;
}

export type PartPosition = 'front' | 'rear' | 'left' | 'right';

export interface UrlIntent {
  isLinkQuery: boolean;
  pattern?: string;
}

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

  /** Dynamic relative temporal constraint (e.g. "الشهر الماضي" -> Month 8) */
  temporalConstraint?: TemporalConstraint;
  /** Vehicle entity constraint (e.g. { model: 'accent', brand: 'hyundai' }) */
  vehicle?: VehicleConstraint;
  /** Part position attribute (e.g. 'rear' for "خلفي" or 'front' for "أمامي") */
  positionAttribute?: PartPosition;
  /** Part concept (e.g. 'bumper', 'seal', 'stapler') */
  partEntity?: string;
  /** Dedicated URL / Link retrieval intent */
  urlIntent?: UrlIntent;
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
  ستة_: '6',
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
    triggers: ['حوالة', 'الحوالة', 'حواله', 'الحواله', 'تحويل', 'التحويل', 'حولت', 'إيصال', 'ايصال', 'سند', 'سند حوالة', 'transfer', 'receipt', 'remittance'],
    expansions: ['حوالة', 'الحوالة', 'تحويل', 'التحويل', 'سند', 'transfer', 'receipt'],
  },
  {
    key: 'financial',
    triggers: ['مالي', 'المالي', 'مالية', 'المالية', 'بنك', 'البنك', 'بنكي', 'البنكي', 'حساب', 'الحساب', 'كشف حساب', 'financial', 'bank', 'statement'],
    expansions: ['مالي', 'المالي', 'بنكي', 'حساب', 'bank', 'statement', 'receipt', 'حوالة'],
  },
  {
    key: 'amount',
    triggers: ['مبلغ', 'المبلغ', 'قيمة', 'القيمة', 'قدره', 'فلوس', 'الفلوس', 'اموال', 'أموال', 'amount', 'total', 'sum'],
    expansions: ['مبلغ', 'المبلغ', 'قيمة', 'القيمة', 'amount', 'value'],
  },
  {
    key: 'rent',
    triggers: ['إيجار', 'الإيجار', 'ايجار', 'الايجار', 'أجرة', 'مستأجر', 'عقد إيجار', 'rent', 'lease', 'ejar'],
    expansions: ['إيجار', 'الإيجار', 'ايجار', 'rent', 'lease', 'ejar'],
  },
  {
    key: 'bill',
    triggers: ['فاتورة', 'الفاتورة', 'فاتوره', 'سداد', 'فواتير', 'bill', 'invoice'],
    expansions: ['فاتورة', 'الفاتورة', 'فواتير', 'bill', 'invoice'],
  },
  {
    key: 'electricity',
    triggers: ['كهرباء', 'الكهرباء', 'كهربا', 'الكهربا', 'electricity', 'sec'],
    expansions: ['كهرباء', 'الكهرباء', 'كهربا', 'electricity', 'sec'],
  },
  {
    key: 'bank_entity',
    triggers: ['الراجحي', 'راجحي', 'alrajhi', 'alrajhibank'],
    expansions: ['الراجحي', 'راجحي', 'alrajhibank', 'alrajhi'],
  },
  {
    key: 'snake',
    triggers: ['ثعبان', 'الثعبان', 'افعى', 'أفعى', 'الافعى', 'الأفعى', 'حية', 'الحية', 'حيه', 'الحيه', 'snake', 'serpent', 'viper', 'زاحف', 'يزحف', 'حيوان يزحف'],
    expansions: ['ثعبان', 'افعى', 'أفعى', 'snake', 'viper', 'حية'],
  },
  {
    key: 'car',
    triggers: ['سيارة', 'السيارة', 'سياره', 'السياره', 'مركبة', 'المركبة', 'car', 'vehicle', 'auto'],
    expansions: ['سيارة', 'السيارة', 'car', 'vehicle'],
  },
  {
    key: 'travel',
    triggers: ['سفر', 'السفر', 'رحلة', 'الرحلة', 'طيران', 'فندق', 'travel', 'flight', 'trip'],
    expansions: ['سفر', 'السفر', 'رحلة', 'الرحلة', 'travel'],
  },
  {
    key: 'bird',
    triggers: ['طير', 'طائر', 'طيران', 'حمامة', 'حمامه', 'حمامات', 'حمائم', 'قفص', 'صدر', 'dove', 'pigeon', 'bird', 'cage'],
    expansions: ['طير', 'حمامة', 'حمامه', 'dove', 'pigeon', 'bird'],
  },
  {
    key: 'drink',
    triggers: ['قهوة', 'قهوه', 'كوفي', 'كوب', 'ماء', 'مياه', 'موية', 'شرب', 'أشرب', 'اشرب', 'طاولة', 'الطاولة', 'طاوله', 'coffee', 'mug', 'cup', 'water', 'drink'],
    expansions: ['قهوة', 'كوفي', 'ماء', 'مياه', 'coffee', 'water'],
  },
  {
    key: 'desk_objects',
    triggers: ['دباسة', 'دباسه', 'قلم', 'مرسام', 'stapler', 'pencil', 'pen'],
    expansions: ['دباسة', 'قلم', 'مرسام', 'stapler', 'pencil'],
  },
  {
    key: 'street',
    triggers: ['شارع', 'الشارع', 'طريق', 'الطريق', 'street', 'road'],
    expansions: ['شارع', 'الشارع', 'street'],
  },
  {
    key: 'quotation',
    triggers: ['عرض سعر', 'عرض اسعار', 'عرض أسعار', 'تسعيرة', 'تسعيره', 'quotation', 'quote', 'سند تحويل', 'سند'],
    expansions: ['عرض سعر', 'عرض اسعار', 'عرض أسعار', 'تسعيرة', 'quotation'],
  },
  {
    key: 'logo',
    triggers: ['شعار', 'الشعار', 'لوقو', 'اللوقو', 'logo', 'badge', 'emblem'],
    expansions: ['شعار', 'الشعار', 'لوقو', 'logo'],
  },
  {
    key: 'faucet',
    triggers: ['حنفية', 'حنفيه', 'الحنفية', 'صنبور', 'الصنبور', 'الحمام', 'faucet', 'tap'],
    expansions: ['حنفية', 'صنبور', 'الحمام', 'faucet'],
  },
  {
    key: 'night',
    triggers: ['ليل', 'الليل', 'بالليل', 'ليلية', 'ليلي', 'night', 'nighttime'],
    expansions: ['ليلية', 'الليل', 'night', 'nighttime'],
  },
  {
    key: 'freedom',
    triggers: ['يتحرر', 'تحرر', 'محبوس', 'محاصرة', 'محاصر', 'طليق', 'سجين', 'يطير', 'trapped', 'escape', 'free'],
    expansions: ['محاصرة', 'قفص', 'trapped', 'cage'],
  },
];

/**
 * Conversational and grammatical filler words stripped from core query terms.
 * Notice: Temporal tokens (الماضي, الشهر, اليوم, أمس) are intentionally OMITTED
 * so temporal intent is extracted without loss before any term filtering.
 */
export const CONVERSATIONAL_STOP_WORDS = new Set([
  'اللي', 'الي', 'يلي', 'الذي', 'التي', 'الذين', 'اللواتي', 'اللائي',
  'فيها', 'فيه', 'فيهم', 'عن', 'عنها', 'عنه', 'عنهم', 'من', 'منها', 'منه', 'منهم',
  'الى', 'إلى', 'على', 'عليها', 'عليه', 'عليهم', 'مع', 'معها', 'معه', 'معهم',
  'في', 'بها', 'به', 'بهم', 'داخل', 'داخله', 'داخلها', 'جوا', 'جواه', 'جواها',
  'حق', 'حقة', 'حقه', 'حقها', 'حقهم', 'بتاع', 'بتاعة', 'بتاعه', 'بتاعت', 'تبع', 'تبعها', 'تبعه',
  'ذا', 'دي', 'هذا', 'هذه', 'هذي', 'هذول', 'هذولا', 'تلك', 'ذلك', 'ذالك',
  'انا', 'أنا', 'وانا', 'وأنا', 'انت', 'أنت', 'هو', 'هي', 'نحن', 'هم', 'هن',
  'كان', 'كانت', 'كنت', 'تكون', 'يكون', 'صار', 'صارت', 'يصير', 'تصير',
  'ظاهر', 'ظاهرة', 'ظاهره', 'ظاهرين', 'باين', 'باينة', 'باينه', 'باينين', 'مبين', 'مبينة', 'مبينه',
  'طالع', 'طالعة', 'طالعه', 'واضح', 'واضحة', 'واضحه', 'يوضح', 'توضح', 'يبان', 'تبان', 'يظهر', 'تظهر',
  'موجود', 'موجودة', 'موجوده', 'موجودين',
  'سويته', 'سويتها', 'سويت', 'حفظته', 'حفظتها', 'حفظت', 'استلمت', 'استلمته', 'رسلته', 'رسلتها', 'ارسلت',
  'صورت', 'صورتها', 'صورته', 'صورتهم', 'شفت', 'شفتها', 'شفته', 'رفعت', 'رفعتها', 'رفعته', 'حطيت', 'حطيتها', 'حطيته',
  'وين', 'فين', 'أين', 'كيف', 'ايش', 'شنو', 'شو', 'ماذا', 'ليه', 'ليش', 'لماذا', 'هل',
  'الورقة', 'ورقة', 'ورقه', 'الورقه', 'المستند', 'مستند', 'الملف', 'ملف', 'وثيقة', 'الوثيقة', 'وثيقه', 'الوثيقه', 'document', 'file', 'paper',
  'الصورة', 'صورة', 'صوره', 'الصوره', 'صورتها', 'صورت', 'لقطة', 'اللقطة', 'photo', 'image', 'picture',
  'الرابط', 'رابط', 'الموقع', 'موقع', 'لينك', 'اللينك', 'link', 'url', 'website',
  'الملاحظة', 'ملاحظة', 'ملاحظه', 'النوت', 'نوت', 'note',
  'الشيء', 'شيء', 'حاجة', 'حاجه', 'شغلة', 'شغله', 'غرض',
  'ادور', 'أدور', 'ادورله', 'ادورلها', 'ابحث', 'أبحث', 'نبحث', 'تبحث', 'يبحث',
  'يبغى', 'تبغى', 'يريد', 'تريد', 'ودّه', 'وده', 'يحاول', 'تحاول',
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
 * Strips Arabic diacritics, tatweel, and normalizes orthographic variants
 * (alif hamza, taa marbuta, alif maqsura).
 */
export function normalizeArabicOrthography(str: string): string {
  return str
    .replace(/[\u064B-\u065F\u0670]/g, '') // strip harakat / diacritics
    .replace(/\u0640/g, '') // strip tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

/**
 * Resolve relative temporal expressions deterministically against reference date.
 * Default reference date is current system date.
 */
export function resolveRelativeTemporal(
  query: string,
  referenceDate = new Date(),
): TemporalConstraint | null {
  const norm = normalizeArabicForSearch(normalizeDigits(query)).toLowerCase();
  const currentMonth = referenceDate.getMonth() + 1; // 1-12
  const currentYear = referenceDate.getFullYear();

  // "الشهر الماضي" / "الشهر اللي فات" / "الشهر السابق" / "last month" / "previous month"
  if (
    /(?:الشهر\s*(?:الماضي|الماضيه|اللي\s*فات|السابق)|last\s*month|previous\s*month)/i.test(norm)
  ) {
    let prevMonth = currentMonth - 1;
    let targetYear = currentYear;
    if (prevMonth === 0) {
      prevMonth = 12;
      targetYear -= 1;
    }
    const pad = String(prevMonth).padStart(2, '0');
    const num = String(prevMonth);
    const mData = MONTH_DATA.find((m) => m.num === num);
    return {
      kind: 'relative_month',
      targetMonth: num,
      targetMonthNum: prevMonth,
      monthPad: pad,
      monthNames: mData ? mData.names : [],
      targetYear: String(targetYear),
      description: `previous_month_${pad}`,
    };
  }

  // "هذا الشهر" / "الشهر الحالي" / "this month"
  if (/(?:(?:هذا|هال|ذا)\s*الشهر|الشهر\s*الحالي|this\s*month)/i.test(norm)) {
    const pad = String(currentMonth).padStart(2, '0');
    const num = String(currentMonth);
    const mData = MONTH_DATA.find((m) => m.num === num);
    return {
      kind: 'relative_month',
      targetMonth: num,
      targetMonthNum: currentMonth,
      monthPad: pad,
      monthNames: mData ? mData.names : [],
      targetYear: String(currentYear),
      description: `current_month_${pad}`,
    };
  }

  // "الشهر القادم" / "الشهر الجاي" / "next month"
  if (/(?:الشهر\s*(?:القادم|الجاي)|next\s*month)/i.test(norm)) {
    let nextMonth = currentMonth + 1;
    let targetYear = currentYear;
    if (nextMonth > 12) {
      nextMonth = 1;
      targetYear += 1;
    }
    const pad = String(nextMonth).padStart(2, '0');
    const num = String(nextMonth);
    const mData = MONTH_DATA.find((m) => m.num === num);
    return {
      kind: 'relative_month',
      targetMonth: num,
      targetMonthNum: nextMonth,
      monthPad: pad,
      monthNames: mData ? mData.names : [],
      targetYear: String(targetYear),
      description: `next_month_${pad}`,
    };
  }

  return null;
}

/**
 * Parse vehicle brand and model entity constraints.
 */
function parseVehicleConstraint(trimmed: string): VehicleConstraint | null {
  const norm = normalizeArabicOrthography(normalizeArabicForSearch(trimmed)).toLowerCase();

  let brand: string | undefined;
  let model: string | undefined;
  let rawMention = '';

  if (/(?:اكسنت|accent)/i.test(norm)) {
    model = 'accent';
    brand = 'hyundai';
    rawMention = 'accent';
  } else if (/(?:يارس|yaris)/i.test(norm)) {
    model = 'yaris';
    brand = 'toyota';
    rawMention = 'yaris';
  } else if (/(?:تورس|taurus)/i.test(norm)) {
    model = 'taurus';
    brand = 'ford';
    rawMention = 'taurus';
  }

  if (/(?:نيسان|nissan)/i.test(norm)) {
    brand = 'nissan';
    rawMention = rawMention ? `${rawMention}_nissan` : 'nissan';
  } else if (/(?:فورد|ford)/i.test(norm)) {
    brand = 'ford';
    rawMention = rawMention ? `${rawMention}_ford` : 'ford';
  } else if (/(?:تويوتا|toyota)/i.test(norm)) {
    brand = 'toyota';
    rawMention = rawMention ? `${rawMention}_toyota` : 'toyota';
  } else if (/(?:هيونداي|هونداي|hyundai)/i.test(norm)) {
    brand = 'hyundai';
    rawMention = rawMention ? `${rawMention}_hyundai` : 'hyundai';
  }

  if (brand || model) {
    return { brand, model, rawMention };
  }
  return null;
}

/**
 * Parse part position attribute (e.g. front vs rear).
 */
function parsePositionAttribute(trimmed: string): PartPosition | undefined {
  const norm = normalizeArabicOrthography(normalizeArabicForSearch(trimmed)).toLowerCase();
  if (/(?:امامي|قدام|front)/i.test(norm)) return 'front';
  if (/(?:خلفي|ورا|وراء|rear|back)/i.test(norm)) return 'rear';
  if (/(?:يسار|شمال|left)/i.test(norm)) return 'left';
  if (/(?:يمين|right)/i.test(norm)) return 'right';
  return undefined;
}

/**
 * Parse part concept entity.
 */
function parsePartEntity(trimmed: string): string | undefined {
  const norm = normalizeArabicOrthography(normalizeArabicForSearch(trimmed)).toLowerCase();
  if (/(?:صدام|صدامات|صدمات|bumper)/i.test(norm)) return 'bumper';
  if (/(?:سدادة|سدادات|seal)/i.test(norm)) return 'seal';
  if (/(?:شبك|grille)/i.test(norm)) return 'grille';
  if (/(?:دباسة|دباسه|stapler)/i.test(norm)) return 'stapler';
  if (/(?:قلم|مرسام|pencil|pen)/i.test(norm)) return 'pencil';
  if (/(?:قطعة|قطعه|قطع|غيار|spare\s*part)/i.test(norm)) return 'spare_part';
  return undefined;
}

/**
 * Dedicated URL & Link Intent Detection.
 */
function parseUrlIntent(trimmed: string): UrlIntent | undefined {
  // 1. Literal URL or domain structure
  if (/^(https?:\/\/|www\.)/i.test(trimmed)) {
    const cleaned = trimmed.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
    return { isLinkQuery: true, pattern: cleaned };
  }

  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\S*)?$/i.test(trimmed)) {
    return { isLinkQuery: true, pattern: trimmed.replace(/\/+$/, '') };
  }

  // 2. IP address pattern (e.g. 80.225.68.223)
  const ipMatch = trimmed.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/);
  if (ipMatch) {
    return { isLinkQuery: true, pattern: ipMatch[0] };
  }

  // 3. Conversational Link Triggers ("رابط", "رابط موقع محلي", "موقع محلي", "الموقع", "link")
  if (/(?:رابط|الرابط|موقع|الموقع|لينك|اللينك|link|url|website)/i.test(trimmed)) {
    return { isLinkQuery: true };
  }

  return undefined;
}

/**
 * Fast, deterministic query parser for natural language searches.
 */
export function parseQueryIntent(rawQuery: string): ParsedQuery {
  const trimmed = rawQuery.trim();
  const normalizedQuery = normalizeArabicForSearch(normalizeDigits(trimmed)).toLowerCase();
  const rawWords = trimmed.match(/[\p{L}\p{N}]+/gu) ?? [];
  const normalizedWords = rawWords.map((w) => normalizeArabicForSearch(normalizeDigits(w)).toLowerCase());

  // 1. Relative Temporal Constraint
  const temporalConstraint = resolveRelativeTemporal(trimmed) || undefined;

  // 2. Vehicle Constraint
  const vehicle = parseVehicleConstraint(trimmed) || undefined;

  // 3. Position Attribute (Front / Rear)
  const positionAttribute = parsePositionAttribute(trimmed);

  // 4. Part Entity Concept (Bumper / Seal / etc.)
  const partEntity = parsePartEntity(trimmed);

  // 5. URL Intent
  const urlIntent = parseUrlIntent(trimmed);

  // Filter conversational stop words to isolate substantive query terms
  let coreTerms = rawWords.filter((w) => {
    const nw = normalizeArabicForSearch(w).toLowerCase();
    const ortho = normalizeArabicOrthography(nw);
    return (
      !CONVERSATIONAL_STOP_WORDS.has(nw) &&
      !CONVERSATIONAL_STOP_WORDS.has(ortho) &&
      !CONVERSATIONAL_STOP_WORDS.has(w)
    );
  });

  // If a temporal constraint was resolved, strip relative anchor words from coreTerms
  if (temporalConstraint) {
    const temporalTokens = new Set(['الشهر', 'شهر', 'الماضي', 'الماضيه', 'فات', 'السابق', 'last', 'month', 'previous']);
    coreTerms = coreTerms.filter((w) => {
      const nw = normalizeArabicForSearch(w).toLowerCase();
      return !temporalTokens.has(nw) && !temporalTokens.has(w);
    });
  }

  // If a URL intent was resolved with a pattern, strip link meta-tokens from coreTerms
  if (urlIntent?.pattern) {
    const urlMetaTokens = new Set(['رابط', 'موقع', 'محلي', 'الرابط', 'الموقع', 'المحلي', 'link', 'url', 'site', 'website']);
    coreTerms = coreTerms.filter((w) => {
      const nw = normalizeArabicForSearch(w).toLowerCase();
      return !urlMetaTokens.has(nw) && !urlMetaTokens.has(w);
    });
    if (coreTerms.length === 0) {
      coreTerms = [urlIntent.pattern];
    }
  }

  const numbers = new Set<string>();
  const months = new Set<string>();
  const concepts = new Set<string>();
  const conceptExpansions = new Set<string>();
  const expandedTokens = new Set<string>();
  let typeHint: 'document' | 'image' | 'link' | 'note' | null = null;

  // Artifact Type Hint Detection
  if (urlIntent?.isLinkQuery) {
    typeHint = 'link';
  } else if (/(?:ورقة|الورقة|مستند|المستند|ملف|الملف|pdf|عقد|العقد|فاتورة|إيصال|سند)/i.test(trimmed)) {
    typeHint = 'document';
  } else if (/(?:صورة|الصورة|لقطة|photo|image)/i.test(trimmed)) {
    typeHint = 'image';
  } else if (/(?:ملاحظة|الملاحظة|نوت|note)/i.test(trimmed)) {
    typeHint = 'note';
  }

  // 1. Detect standard digits (boundary check e.g. 2,000 or 2000)
  // Exclude IP addresses with multiple dots
  const isIpAddress = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(trimmed);
  if (!isIpAddress) {
    const digitMatches = normalizeDigits(trimmed).match(/\b\d+(?:[.,]\d+)*\b/g) || [];
    for (const dm of digitMatches) {
      if ((dm.match(/\./g) || []).length > 1) continue; // Skip multiple dots
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

  // 3. Detect Months via Relative Temporal Constraint
  if (temporalConstraint && temporalConstraint.targetMonth) {
    months.add(temporalConstraint.targetMonth);
    if (temporalConstraint.monthPad) months.add(temporalConstraint.monthPad);
    if (temporalConstraint.monthNames) {
      temporalConstraint.monthNames.forEach((n) => {
        months.add(n);
        expandedTokens.add(n);
      });
    }
    expandedTokens.add(temporalConstraint.targetMonth);
    if (temporalConstraint.monthPad) expandedTokens.add(temporalConstraint.monthPad);
  }

  // 4. Detect Months via Digits (e.g. "شهر 8", "شهر 08")
  const monthPattern = /(?:شهر|month)\s*(\d{1,2})/i;
  const monthMatch = normalizeDigits(trimmed).match(monthPattern);
  if (monthMatch && monthMatch[1]) {
    const num = String(parseInt(monthMatch[1], 10));
    numbers.delete(num);
    numbers.delete(monthMatch[1]);
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
    } else {
      // Out-of-range or unseen month number (e.g. شهر 99, month 13)
      // Retain as explicit month constraint so non-matching documents are vetoed
      months.add(num);
      expandedTokens.add(num);
    }
  }

  // 5. Detect Months via Ordinals (e.g. "الشهر الثامن", "الشهر السابع")
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

  // 6. Detect Months via Named Months (e.g. "أغسطس", "August")
  for (const mData of MONTH_DATA) {
    const matched = mData.names.some((name) => {
      const normName = normalizeArabicForSearch(name).toLowerCase();
      const orthoName = normalizeArabicOrthography(normName);
      return (
        normalizedWords.includes(normName) ||
        normalizedWords.some((w) => normalizeArabicOrthography(w) === orthoName) ||
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

  // 7. Detect Intent Concepts & Broad Equivalences
  for (const c of CONCEPT_MAP) {
    const matched = c.triggers.some((tr) => {
      const normTr = normalizeArabicForSearch(tr).toLowerCase();
      const orthoTr = normalizeArabicOrthography(normTr);
      return (
        normalizedWords.includes(normTr) ||
        normalizedWords.some((w) => normalizeArabicOrthography(w) === orthoTr) ||
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

  // Add entity tokens to expansions
  if (vehicle?.model) expandedTokens.add(vehicle.model);
  if (vehicle?.brand) expandedTokens.add(vehicle.brand);
  if (partEntity) expandedTokens.add(partEntity);
  if (urlIntent?.pattern) expandedTokens.add(urlIntent.pattern);

  // Add original normalized tokens
  for (const w of normalizedWords) {
    if (w.length > 1) {
      expandedTokens.add(w);
      const ortho = normalizeArabicOrthography(w);
      if (ortho !== w) expandedTokens.add(ortho);
    }
  }

  // If vehicle brand Nissan is present, clear false Levantine April month detection
  if (vehicle?.brand === 'nissan') {
    const aprilTokens = new Set(['04', '4', 'أبريل', 'ابريل', 'نيسان', 'april', 'apr']);
    for (const m of Array.from(months)) {
      if (aprilTokens.has(m)) months.delete(m);
    }
  }

  // If urlIntent pattern is an IP address, clear numbers parsed from IP octets
  if (urlIntent?.pattern && /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(urlIntent.pattern)) {
    numbers.clear();
  }

  const hasStructuredIntent =
    numbers.size > 0 ||
    months.size > 0 ||
    concepts.size > 0 ||
    typeHint !== null ||
    temporalConstraint !== undefined ||
    vehicle !== undefined ||
    positionAttribute !== undefined ||
    partEntity !== undefined ||
    urlIntent !== undefined;

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
    hasStructuredIntent,
    temporalConstraint,
    vehicle,
    positionAttribute,
    partEntity,
    urlIntent,
  };
}
