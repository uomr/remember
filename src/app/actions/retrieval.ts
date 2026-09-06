'use server';

import { recordRetrievalEvent, type RetrievalEventType } from '@/lib/memories/personalRetrieval';

export interface LogRetrievalActionInput {
  memoryId: string;
  rawQuery: string;
  eventType: RetrievalEventType;
  position?: number;
  sessionId?: string;
  isReformulation?: boolean;
}

/**
 * Server Action for client-side retrieval telemetry.
 *
 * Invoked non-blockingly when a user opens a search result, confirms recovery
 * by viewing details/files, or corrects a search selection.
 *
 * Runs strictly under the caller's session via Supabase server client and RLS.
 */
export async function logRetrievalEventAction(
  input: LogRetrievalActionInput,
): Promise<{ ok: boolean; confidence: number }> {
  try {
    return await recordRetrievalEvent(input);
  } catch (err) {
    console.error('[logRetrievalEventAction:error]', err instanceof Error ? err.message : String(err));
    return { ok: false, confidence: 0 };
  }
}
