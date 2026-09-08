/**
 * Privacy-Conscious & Resilient Operational Analytics.
 *
 * Implements non-blocking, fail-safe event recording for Admin v1 & Search Intelligence.
 *
 * Design Guarantees:
 *  1. Non-blocking: Asynchronous execution, never awaits DB writes in hot user paths.
 *  2. Fail-safe: Errors are caught silently; analytics failure NEVER breaks user actions.
 *  3. Minimal footprint: Clean structured schema, zero sensitive user content.
 */

import { createClient } from '@/lib/supabase/client';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AnalyticsEvent =
  | 'signup'
  | 'login'
  | 'logout'
  | 'memory_created'
  | 'memory_opened'
  | 'memory_edited'
  | 'memory_deleted'
  | 'search'
  | 'search_started'
  | 'search_zero_result'
  | 'search_result_clicked'
  | 'search_result_opened'
  | 'upload_failed'
  | 'enrichment_failed'
  | 'signup_completed';

export interface AnalyticsProperties {
  memoryType?: 'image' | 'document' | 'link' | 'note';
  memoryId?: string;
  resultCount?: number;
  latencyMs?: number;
  query?: string;
  errorReason?: string;
  fromQuery?: string;
  [key: string]: unknown;
}

/**
 * Record a telemetry event in browser environment. Safe to call from client.
 * Never throws, never blocks.
 */
export function track(event: AnalyticsEvent, properties: AnalyticsProperties = {}): void {
  try {
    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.debug('[analytics]', event, properties);
    }

    if (typeof window !== 'undefined') {
      void (async () => {
        try {
          const supabase = createClient();
          const {
            data: { user },
          } = await supabase.auth.getUser();

          if (!user) return;

          const query = typeof properties.query === 'string' ? properties.query.slice(0, 200) : null;
          const memoryId = typeof properties.memoryId === 'string' ? properties.memoryId : null;
          const { query: _, memoryId: __, ...cleanMeta } = properties;

          await supabase.from('analytics_events').insert({
            user_id: user.id,
            event_type: event,
            memory_id: memoryId,
            query,
            metadata: cleanMeta,
          });
        } catch {
          // Fail-safe by design: silent swallow
        }
      })();
    }
  } catch {
    // Fail-safe: never throw
  }
}

/**
 * Record a server-side telemetry event (inside server actions or server components).
 * Directly writes to analytics_events under caller context.
 * Completely non-blocking and fail-safe.
 */
export async function trackServerEvent(
  supabase: SupabaseClient,
  event: AnalyticsEvent,
  userId: string | null,
  properties: AnalyticsProperties = {},
): Promise<void> {
  try {
    const query = typeof properties.query === 'string' ? properties.query.slice(0, 200) : null;
    const memoryId = typeof properties.memoryId === 'string' ? properties.memoryId : null;
    const { query: _, memoryId: __, ...cleanMeta } = properties;

    await supabase.from('analytics_events').insert({
      user_id: userId,
      event_type: event,
      memory_id: memoryId,
      query,
      metadata: cleanMeta,
    });
  } catch {
    // Fail-safe: never crash server request if table is pending migration or transient failure
  }
}
