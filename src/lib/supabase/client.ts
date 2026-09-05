'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client for use in Client Components (browser).
 * Uses only PUBLIC env vars — never the service role key.
 *
 * TODO (Phase 1): pass the generated `Database` generic once types are wired.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY). See .env.example.',
    );
  }

  return createBrowserClient(url, publishableKey);
}
