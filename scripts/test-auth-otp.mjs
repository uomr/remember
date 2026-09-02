/**
 * Diagnose the magic-link ("We couldn't send your link") failure by calling the
 * SAME Supabase auth endpoint the app uses, and printing the exact HTTP status
 * and error body. Reads .env.local; never prints the keys.
 *
 * Run:  node scripts/test-auth-otp.mjs your-email@example.com
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.argv[2] || 'test@example.com';

if (!URL_ || !ANON) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.');
  process.exit(1);
}

console.log('Project URL host:', new URL(URL_).host);
console.log('Requesting magic link (OTP) for:', email, '\n');

try {
  const res = await fetch(`${URL_}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      create_user: true,
      // Mirror the app: it sends users back through /auth/callback.
      options: { emailRedirectTo: 'http://localhost:3000/auth/callback' },
    }),
  });

  const retryAfter = res.headers.get('retry-after');
  const body = await res.text();
  console.log('HTTP status:', res.status, res.statusText);
  if (retryAfter) console.log('Retry-After (seconds):', retryAfter);
  console.log('Body:', body.slice(0, 600));

  if (res.status === 429) {
    console.log('\n=> RATE LIMITED: Supabase is throttling email sends. Wait, or configure a real SMTP provider.');
  } else if (res.ok) {
    console.log('\n=> OK: Supabase accepted the request and should have sent the email.');
  } else {
    console.log('\n=> Non-OK response — see body above for the exact reason.');
  }
} catch (err) {
  console.error('Request error:', err?.message || String(err));
  process.exit(2);
}
