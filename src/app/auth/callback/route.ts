import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * Auth callback. Supabase sends the user here after they open a sign-in link.
 * We accept BOTH shapes so ordinary magic links keep working and admin/OTP
 * links work too:
 *   - `?code=...`                → PKCE exchange (the normal emailed magic link).
 *   - `?token_hash=...&type=...` → verifyOtp (admin-generated links / OTP confirm).
 * Either way a session cookie is set, then we send the user to `next` (same-site
 * only). On any failure we bounce to /sign-in with a friendly, code-free error.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next');

  // Derive the canonical request origin from the client-facing Host headers,
  // falling back to request.nextUrl.origin or request.url only if missing.
  // This guarantees that the user is redirected to the real public domain/IP
  // and NEVER to internal localhost.
  const forwardedHost = request.headers.get('x-forwarded-host');
  const host = forwardedHost || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || (request.url.startsWith('https') ? 'https' : 'http');
  const origin = host ? `${proto}://${host}` : (request.nextUrl.origin || new URL(request.url).origin);

  // Only allow same-site relative redirects to avoid open-redirect abuse.
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';

  const supabase = createClient();

  // Normal emailed magic link (PKCE): exchange the code for a session.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(`${origin}/sign-in?error=auth`);
    return NextResponse.redirect(`${origin}${safeNext}`);
  }

  // token_hash link (admin-generated, or a token_hash email template): verify it.
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return NextResponse.redirect(`${origin}/sign-in?error=auth`);
    return NextResponse.redirect(`${origin}${safeNext}`);
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth`);
}
