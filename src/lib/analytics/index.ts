/**
 * Privacy-conscious analytics — stub.
 *
 * Emits ONLY typed, content-free events. It NEVER receives memory content
 * (no titles, text, URLs, or file bytes). By default it no-ops. A real sink
 * (e.g. a privacy-respecting product-analytics provider) can be wired in later
 * behind this same API.
 *
 * TODO (Phase 3): implement a real, consent-gated sink. Keep the "no content"
 * guarantee — only counts and coarse, non-identifying properties.
 */

/** The closed set of events the app may emit. */
export type AnalyticsEvent =
  | 'memory_created'
  | 'memory_deleted'
  | 'search_started'
  | 'search_result_opened'
  | 'signup_completed';

/**
 * Allowed, content-free properties. Deliberately narrow: no free-form strings
 * that could carry memory content.
 */
export interface AnalyticsProperties {
  /** For memory_created/deleted: which kind of memory (not its content). */
  memoryType?: 'image' | 'document' | 'link' | 'note';
  /** For search: result count only — never the query text. */
  resultCount?: number;
}

/**
 * Track an event. No-op by default. Never pass memory content — the type of
 * `properties` intentionally forbids it.
 */
export function track(_event: AnalyticsEvent, _properties: AnalyticsProperties = {}): void {
  if (process.env.NODE_ENV === 'development') {
    // Local visibility only; still no content is logged.
    // eslint-disable-next-line no-console
    console.debug('[analytics:noop]', _event, _properties);
  }
  // TODO (Phase 3): forward to a real sink here.
}
