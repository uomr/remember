import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/** Shape of each cookie @supabase/ssr asks us to persist. */
type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Reads/writes the session via cookies (@supabase/ssr).
 *
 * Uses the PUBLIC anon key + RLS for user-scoped access. The SERVICE ROLE key
 * is intentionally NOT used here — see createServiceRoleClient below for the
 * rare privileged case, and never import that into client code.
 *
 * TODO (Phase 1): pass the generated `Database` generic once types are wired.
 */
export function createClient() {
  const cookieStore = cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. See .env.example.',
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component where cookies are read-only.
          // Safe to ignore when middleware refreshes the session.
        }
      },
    },
  });
}

/**
 * Privileged client using the SERVICE ROLE key. SERVER ONLY.
 * Bypasses RLS — use sparingly and never expose to the browser.
 *
 * TODO (Phase 1+): use only for narrowly-scoped admin tasks; prefer the
 * RLS-guarded client above for all user-scoped operations.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (server only).');
  }

  return createServerClient(url, serviceRoleKey, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // No session cookies for the service-role client.
      },
    },
  });
}
