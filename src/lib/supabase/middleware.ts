import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

/** Shape of each cookie @supabase/ssr asks us to persist. */
type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Session refresh + route protection for the App Router, run from the root
 * `middleware.ts`. Follows the official @supabase/ssr pattern: create a server
 * client wired to read cookies from the request and write refreshed cookies
 * onto BOTH the request and the outgoing response, then call getUser() so the
 * session is revalidated on every navigation.
 *
 * Security note: authorization is ultimately enforced by Postgres RLS. This
 * middleware is a UX gate (send signed-out users to /sign-in) and a session
 * refresher — never the only line of defense.
 */

/**
 * Paths that are reachable without a session.
 *
 * `/offline` is the service worker's cached navigation fallback. It holds no
 * user data, and gating it broke the PWA: `cache.add('/offline')` followed the
 * auth redirect and failed, so offline navigations fell through to a network
 * error instead of the fallback page.
 */
const PUBLIC_PATHS = ['/sign-in', '/auth', '/offline'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without config we cannot check the session. Fail open to the sign-in page
  // rather than crashing every request; the app is unusable without env vars
  // anyway (see .env.example).
  if (!url || !publishableKey) {
    return response;
  }

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Safely attempt to fetch user; if the cookie is corrupted, tampered, or expired,
  // fail closed gracefully (user = null) rather than crashing with an unhandled exception.
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data?.user ?? null;
  } catch {
    user = null;
  }

  const { pathname } = request.nextUrl;

  // Signed-out users may only see public paths.
  if (!user && !isPublicPath(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/sign-in';
    redirectUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Signed-in users have no reason to see the sign-in screen.
  if (user && pathname === '/sign-in') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/';
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
