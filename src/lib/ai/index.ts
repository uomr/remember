import type { AIService } from './types';
import { AI_CONFIG, isAIConfigured } from '@/lib/config';
import { openRouterProvider } from './providers/openrouter';

/**
 * AI abstraction layer — provider resolution.
 *
 * Nothing in the UI or features should import a provider directly. Everything
 * goes through getAIService(), which returns the disabled no-op provider by
 * default (AI_PROVIDER=disabled). Real providers plug in HERE later.
 *
 * Providers are keyed by AI_PROVIDER (see getAIService below). They must never
 * be called from the client and must never block capture.
 */

/** Raised when a feature calls AI while it is disabled. */
export class AIDisabledError extends Error {
  constructor(method: string) {
    super(`AI is disabled (AI_PROVIDER=disabled). Attempted to call "${method}".`);
    this.name = 'AIDisabledError';
  }
}

/** Default provider: does nothing. Safe, cost-free, privacy-preserving. */
const disabledProvider: AIService = {
  enabled: false,
  ocr() {
    return Promise.reject(new AIDisabledError('ocr'));
  },
  describeImage() {
    return Promise.reject(new AIDisabledError('describeImage'));
  },
  extractText() {
    return Promise.reject(new AIDisabledError('extractText'));
  },
  embed() {
    return Promise.reject(new AIDisabledError('embed'));
  },
  rankSearch() {
    return Promise.reject(new AIDisabledError('rankSearch'));
  },
};

/**
 * Resolve the active AI service. Returns the disabled no-op provider in the MVP.
 * Callers should check `.enabled` (or catch AIDisabledError) and degrade gracefully.
 */
export function getAIService(): AIService {
  // Not enabled, or enabled but missing its key → stay a safe no-op.
  if (!isAIConfigured()) {
    return disabledProvider;
  }

  switch (AI_CONFIG.provider) {
    case 'openrouter':
      return openRouterProvider;
    default:
      return disabledProvider;
  }
}

export type { AIService } from './types';
