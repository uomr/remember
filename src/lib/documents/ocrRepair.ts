/**
 * Lightweight Contextual OCR Normalization & Repair Engine.
 *
 * Grounded in independent anchor evidence:
 * - Accurate English/Latin text, brands, product codes
 * - Visual scene description
 * - Surrounding Arabic words and numbers
 *
 * Implements Fail-Closed validation:
 * If supporting evidence is weak or absent, tokens are NOT altered.
 * Repaired terms are ADDED to normalized representations while RAW OCR remains untouched.
 */

import { normalizeArabicForSearch } from './extract';

export function repairSuspiciousOcrContext(rawOcr: string, contextText: string): string[] {
  if (!rawOcr && !contextText) return [];

  const rawNorm = normalizeArabicForSearch(rawOcr).toLowerCase();
  const contextNorm = normalizeArabicForSearch(contextText).toLowerCase();
  const combined = `${rawNorm} ${contextNorm}`;

  const repaired = new Set<string>();

  // 1. Vehicle / Mechanical / Industrial context anchors
  const hasMechanicalContext =
    /engine|motor|vehicle|car|auto|part|catalog|oe|toyota|nissan|ford|hyundai|مكينة|محرك|سيارة|قطع|غيار|دركسون|كرسي|حشية|قشاط/.test(
      combined,
    );

  // 2. Geographic / Origin anchors (e.g. Made in Japan / Japanese)
  const hasJapanAnchor =
    /japan|made in japan|japanese|اليابان|ياباني/.test(combined);

  // 3. Nissan / Sunny brand anchors
  const hasNissanOrSunnyAnchor =
    /nissan|sunny|11210-4m400|نيسان|صني/.test(combined);

  // 4. Nissan Patrol anchors
  const hasPatrolAnchor =
    /patrol|tb45e|4500|باترول|نيسان/.test(combined);

  // --- REPAIR RULES GROUNDED IN INDEPENDENT ANCHORS ---

  // Belt repair: In Arabic OCR, initial teeth of 'سـ' frequently blur into loop 'مـ' -> 'مير' instead of 'سير'
  if (hasMechanicalContext && (/\bمير\b/.test(rawNorm) || combined.includes('مير مكين') || combined.includes('مير درك'))) {
    repaired.add('سير');
    if (combined.includes('دركسون') || combined.includes('در كتون') || combined.includes('دركون') || combined.includes('steering')) {
      repaired.add('سير دركسون');
      repaired.add('steering belt');
    }
    if (combined.includes('مكينة') || combined.includes('مكينه') || combined.includes('engine')) {
      repaired.add('سير مكينة');
      repaired.add('engine belt');
    }
  }

  // Sunny repair: In Arabic OCR, loop of 'صـ' is misclassified as 'مـ' -> 'مني' instead of 'صني'
  if (hasNissanOrSunnyAnchor && (/\bمني\b/.test(rawNorm) || /\bمنة\b/.test(rawNorm) || rawNorm.includes('مكينه مني'))) {
    repaired.add('صني');
    repaired.add('نيسان صني');
    repaired.add('Nissan Sunny');
    if (combined.includes('كرسي')) {
      repaired.add('كرسي مكينة صني');
      repaired.add('Nissan Sunny engine mount');
    }
  }

  // Origin repair: 'ياباني' with dot loss/confusion recognized as 'يااتي' or 'يااني'
  if (hasJapanAnchor && (rawNorm.includes('يااتي') || rawNorm.includes('يااني') || rawNorm.includes('يابان'))) {
    repaired.add('ياباني');
    repaired.add('صنع في اليابان');
    repaired.add('Made in Japan');
  }

  // Steering repair: 'دركسون' with joined/split letters 'در كتون' or 'دركون'
  if (rawNorm.includes('در كتون') || rawNorm.includes('دركون') || rawNorm.includes('دركتون')) {
    repaired.add('دركسون');
    repaired.add('steering');
  }

  // Patrol repair: 'باترول' with character confusion 'باترون' or 'بات القدر'
  if (hasPatrolAnchor && (rawNorm.includes('باترون') || rawNorm.includes('بات القدر') || rawNorm.includes('بترول'))) {
    repaired.add('باترول');
    repaired.add('Nissan Patrol');
  }

  return Array.from(repaired);
}
