import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { normalizeArabicForSearch } from '@/lib/documents/extract';
import { parseQueryIntent } from '@/lib/memories/queryUnderstanding';

/**
 * Event types for user retrieval behavior tracking.
 */
export type RetrievalEventType = 'search_result_open' | 'confirmed_recovery' | 'correction';

export interface RetrievalEventInput {
  memoryId: string;
  rawQuery: string;
  eventType: RetrievalEventType;
  position?: number;
  sessionId?: string;
  isReformulation?: boolean;
}

export interface PersonalMatch {
  memoryId: string;
  cue: string;
  normalizedCue: string;
  weight: number;
  effectiveWeight: number;
  reinforcementCount: number;
  lastUsedAt: string;
}

/**
 * Conversational and filler terms stripped to isolate substantive retrieval cues.
 */
const RETRIEVAL_FILLERS = new Set([
  'اللي', 'اللى', 'فيها', 'فيه', 'عن', 'حق', 'حقة', 'حقه', 'مع', 'من', 'الى', 'إلى',
  'حقته', 'هذا', 'هذي', 'هذه', 'ذاك', 'تلك', 'وين', 'كيف', 'ابي', 'أبي', 'ابغى', 'أبغى',
  'ورقة', 'ورقه', 'الورقة', 'الورقه', 'مستند', 'المستند', 'ملف', 'الملف', 'صورة', 'صوره',
  'الصورة', 'الصوره', 'الشيء', 'الشي', 'شيء', 'شي', 'قبل', 'امس', 'أمس', 'الماضي',
  'the', 'a', 'an', 'that', 'this', 'from', 'with', 'for', 'about', 'where', 'my',
]);

/**
 * Extract clean, reusable retrieval cues from a user's query.
 *
 * Distinguishes general linguistic fillers from substantive personal retrieval cues.
 * Returns both the complete substantive phrase and focused core terms.
 */
export function extractRetrievalCues(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const rawNorm = normalizeArabicForSearch(trimmed).toLowerCase();
  const tokens = rawNorm.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return [];

  const substantiveTokens = tokens.filter((t) => !RETRIEVAL_FILLERS.has(t));
  const cues = new Set<string>();

  // 1. Full normalized query
  cues.add(rawNorm);

  // 2. Substantive phrase without conversational fillers
  if (substantiveTokens.length > 0 && substantiveTokens.length < tokens.length) {
    cues.add(substantiveTokens.join(' '));
  }

  // 3. Core intent terms (from intent parser)
  const intent = parseQueryIntent(trimmed);
  for (const term of intent.coreTerms) {
    const termNorm = normalizeArabicForSearch(term).toLowerCase();
    if (termNorm.length >= 2 && !RETRIEVAL_FILLERS.has(termNorm)) {
      cues.add(termNorm);
    }
  }

  // 4. Individual substantive keywords (min length 3)
  for (const t of substantiveTokens) {
    if (t.length >= 3) {
      cues.add(t);
    }
  }

  return Array.from(cues);
}

/**
 * Calculate conservative confidence for an event based on behavioral evidence.
 *
 * CONFIDENCE HIERARCHY:
 * - Explicit correction / manual selection: 1.00
 * - Confirmed recovery (full document / detail interaction): 0.95
 * - Post-reformulation recovery (found after previous attempt): 0.85
 * - Position > 1 (user actively scrolled past result #1): 0.75
 * - Position 1 without reformulation (subject to position bias): 0.40
 */
export function calculateEventConfidence(
  eventType: RetrievalEventType,
  position?: number,
  isReformulation?: boolean,
): number {
  if (eventType === 'correction') return 1.0;
  if (eventType === 'confirmed_recovery') return 0.95;

  // Search result open:
  if (isReformulation) return 0.85;
  if (position && position > 1) return 0.75;
  return 0.4;
}

/**
 * Calculate temporal decay multiplier for an association.
 *
 * Uses a 45-day half-life decay function:
 * decay = 1 / (1 + daysElapsed / 45)
 *
 * Fresh associations (~0-3 days) retain 95-100% strength.
 * Associations unused for 45 days retain 50% strength.
 * Repeated reinforcements continually refresh `last_used_at`.
 */
export function calculateTemporalDecay(lastUsedAt: string | Date, now: Date = new Date()): number {
  const last = typeof lastUsedAt === 'string' ? new Date(lastUsedAt) : lastUsedAt;
  const elapsedMs = Math.max(0, now.getTime() - last.getTime());
  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
  return 1.0 / (1.0 + elapsedDays / 45.0);
}

/**
 * Record a retrieval event and update persistent personal associations.
 *
 * Strictly scoped to the authenticated caller via Supabase server client and RLS.
 * Executes quietly in the background; failure never disrupts the user.
 */
export async function recordRetrievalEvent(
  input: RetrievalEventInput,
): Promise<{ ok: boolean; confidence: number }> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { ok: false, confidence: 0 };

    const rawQuery = input.rawQuery.trim();
    if (!rawQuery) return { ok: false, confidence: 0 };

    const normQuery = normalizeArabicForSearch(rawQuery).toLowerCase();
    const confidence = calculateEventConfidence(input.eventType, input.position, input.isReformulation);
    const hasArabic = /[\u0600-\u06FF]/.test(rawQuery);
    const language = hasArabic ? 'ar' : 'en';

    // 1. Insert retrieval event
    const { error: eventError } = await supabase.from('retrieval_events').insert({
      user_id: user.id,
      memory_id: input.memoryId,
      raw_query: rawQuery,
      normalized_query: normQuery,
      language,
      event_type: input.eventType,
      confidence,
      position: input.position ?? null,
      session_id: input.sessionId ?? null,
    });

    if (eventError) {
      console.warn('[personalRetrieval:eventError]', eventError.message);
    }

    // 2. Extract cues and update personal associations
    const cues = extractRetrievalCues(rawQuery);
    if (cues.length === 0) return { ok: true, confidence };

    const nowIso = new Date().toISOString();

    for (const cue of cues) {
      // Check existing association
      const { data: existing } = await supabase
        .from('personal_retrieval_associations')
        .select('id, weight, reinforcement_count')
        .eq('user_id', user.id)
        .eq('memory_id', input.memoryId)
        .eq('normalized_cue', cue)
        .maybeSingle();

      if (existing) {
        // Reinforce existing association
        const newWeight = Math.min(3.0, Number(existing.weight) + confidence * 0.5);
        const newCount = Number(existing.reinforcement_count) + 1;

        await supabase
          .from('personal_retrieval_associations')
          .update({
            weight: newWeight,
            reinforcement_count: newCount,
            last_used_at: nowIso,
            source: input.eventType,
          })
          .eq('id', existing.id);
      } else {
        // Create new association
        const initialWeight = Math.min(2.0, 1.0 + confidence * 0.5);
        await supabase.from('personal_retrieval_associations').insert({
          user_id: user.id,
          memory_id: input.memoryId,
          cue: rawQuery.slice(0, 100),
          normalized_cue: cue,
          weight: initialWeight,
          reinforcement_count: 1,
          last_used_at: nowIso,
          source: input.eventType,
        });
      }
    }

    return { ok: true, confidence };
  } catch (err) {
    console.error('[personalRetrieval:recordError]', err instanceof Error ? err.message : String(err));
    return { ok: false, confidence: 0 };
  }
}

/**
 * Fetch personal retrieval matches for a query.
 *
 * Runs a single indexed SQL query against `personal_retrieval_associations` (< 2ms).
 * Applies temporal half-life decay to return effective association weights.
 * Gracefully returns an empty map if tables are absent or on error.
 */
export async function getPersonalRetrievalMatches(
  supabase: ReturnType<typeof createClient>,
  query: string,
): Promise<{
  matches: Map<string, PersonalMatch>;
  candidateIds: string[];
}> {
  const cues = extractRetrievalCues(query);
  if (cues.length === 0) {
    return { matches: new Map(), candidateIds: [] };
  }

  try {
    const { data, error } = await supabase
      .from('personal_retrieval_associations')
      .select('memory_id, cue, normalized_cue, weight, reinforcement_count, last_used_at')
      .in('normalized_cue', cues)
      .order('weight', { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) {
      return { matches: new Map(), candidateIds: [] };
    }

    const matches = new Map<string, PersonalMatch>();
    const now = new Date();

    for (const row of data as {
      memory_id: string;
      cue: string;
      normalized_cue: string;
      weight: number;
      reinforcement_count: number;
      last_used_at: string;
    }[]) {
      const decay = calculateTemporalDecay(row.last_used_at, now);
      const effectiveWeight = row.weight * decay;

      const existing = matches.get(row.memory_id);
      if (!existing || effectiveWeight > existing.effectiveWeight) {
        matches.set(row.memory_id, {
          memoryId: row.memory_id,
          cue: row.cue,
          normalizedCue: row.normalized_cue,
          weight: row.weight,
          effectiveWeight,
          reinforcementCount: row.reinforcement_count,
          lastUsedAt: row.last_used_at,
        });
      }
    }

    // Sort candidate IDs by effective weight descending
    const sortedCandidateIds = Array.from(matches.values())
      .sort((a, b) => b.effectiveWeight - a.effectiveWeight)
      .map((m) => m.memoryId);

    return { matches, candidateIds: sortedCandidateIds };
  } catch {
    return { matches: new Map(), candidateIds: [] };
  }
}
