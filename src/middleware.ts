import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Root middleware: refreshes the Supabase session on every request and gates
 * protected routes. The heavy lifting lives in src/lib/supabase/middleware.ts.
 *
 * NOTE: because this project uses a `src/` directory, this file MUST live at
 * `src/middleware.ts` (a `middleware.ts` at the project root is ignored by
 * Next.js when `src/` is present).
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  /**
   * Run on everything EXCEPT static assets and PWA files. Keeping these out
   * avoids needless session work and lets the manifest / service worker / icons
   * load without an auth redirect.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
