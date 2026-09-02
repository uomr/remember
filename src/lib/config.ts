/**
 * Centralized application config: upload limits, allowed MIME types, and
 * feature flags. Keep all "magic numbers" and policy toggles here so features
 * never hard-code them.
 */

const MB = 1024 * 1024;

export const UPLOAD_LIMITS = {
  /** Max image upload size (bytes). */
  maxImageSize: 10 * MB,
  /** Max document upload size (bytes). */
  maxDocumentSize: 25 * MB,
  /** Allowed image MIME types. */
  allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'],
  /** Allowed document MIME types. */
  allowedDocumentTypes: [
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
} as const;

/**
 * Feature flags. AI is an isolated abstraction layer and is DISABLED by default
 * (see src/lib/ai). Reads AI_PROVIDER (server env); anything other than a real
 * provider name keeps AI off, so the core product never depends on it.
 */
export const FEATURES = {
  /** Master switch for AI. `disabled` (the default) keeps every AI call a no-op. */
  AI_ENABLED: (process.env.AI_PROVIDER ?? 'disabled') !== 'disabled',
} as const;

/**
 * AI provider configuration (Phase 2). SERVER-ONLY — never import into a client
 * component; the key must never reach the browser. All values come from env so
 * the provider/model can change without code edits (see docs/DECISIONS.md).
 *
 * To enable, set in `.env.local`:
 *   AI_PROVIDER=openrouter
 *   OPENROUTER_API_KEY=sk-or-...
 *   OPENROUTER_MODEL=google/gemini-2.5-flash   # optional; this is the default
 */
export const AI_CONFIG = {
  /** Which provider getAIService() should resolve. */
  provider: process.env.AI_PROVIDER ?? 'disabled',
  /** OpenRouter, OpenAI-compatible. */
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    baseUrl: 'https://openrouter.ai/api/v1',
    /** A fast, low-cost, vision-capable default; override via OPENROUTER_MODEL. */
    model: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
    /** Embedding model for semantic search; override via OPENROUTER_EMBEDDING_MODEL. */
    embeddingModel: process.env.OPENROUTER_EMBEDDING_MODEL || 'openai/text-embedding-3-small',
    /** Embedding dimensions — MUST match the DB column vector(N) in migration 0002. */
    embeddingDimensions: 1536,
    /** Optional attribution headers OpenRouter uses for app rankings. */
    referer: process.env.OPENROUTER_SITE_URL || 'http://localhost:3000',
    title: 'Remember',
    /** Hard cap so a slow model can never hang a request. */
    timeoutMs: 30_000,
  },
} as const;

/** True only when AI is enabled AND the active provider is actually configured. */
export function isAIConfigured(): boolean {
  if (!FEATURES.AI_ENABLED) return false;
  if (AI_CONFIG.provider === 'openrouter') return AI_CONFIG.openRouter.apiKey.length > 0;
  return false;
}

/** Private storage bucket that holds all user files. */
export const STORAGE_BUCKET = 'memories' as const;

/**
 * Build the canonical storage path for a file.
 * Pattern: {user-id}/{memory-id}/{file-name}
 */
export function buildStoragePath(userId: string, memoryId: string, fileName: string): string {
  return `${userId}/${memoryId}/${fileName}`;
}
