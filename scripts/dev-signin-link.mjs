/**
 * DEV-ONLY: generate a one-click sign-in link WITHOUT sending an email, so you
 * can test the app even when Supabase's built-in email is rate-limited (429
 * over_email_send_rate_limit). Uses the service-role key + Admin API
 * `generateLink`, then builds a URL that hits the app's /auth/callback with a
 * `token_hash` (verifyOtp) — which does NOT need email delivery.
 *
 * The printed link signs you in as that email. Treat it like a password:
 * it is for local testing on your own machine only; do not share it.
 *
 * Run:  node scripts/dev-signin-link.mjs your-email@example.com
 */
import { readFileSync } from 'node:fs';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {
    constructor() {
      throw new Error('Realtime not used.');
    }
  };
}
const { createClient } = await import('@supabase/supabase-js');

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE =
  env.SUPABASE_SECRET_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:3000';
const email = process.argv[2];

if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEV_SIGNIN) {
  console.error('dev-signin-link is disabled in production environments without ALLOW_DEV_SIGNIN=1.');
  process.exit(1);
}

if (!email) {
  console.error('Usage: node scripts/dev-signin-link.mjs your-email@example.com');
  process.exit(1);
}
if (!SUPA_URL || !SERVICE) {
  console.error('Missing Supabase url / secret key in .env.local.');
  process.exit(1);
}

const admin = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });

const { data, error } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email,
  options: { redirectTo: `${APP_ORIGIN}/auth/callback` },
});

if (error) {
  console.error('generateLink failed:', error.message);
  console.error('(If the user does not exist yet, sign up once via email first, or create it in the dashboard.)');
  process.exit(2);
}

const props = data?.properties;
if (!props?.hashed_token) {
  console.error('No hashed_token returned; cannot build a local sign-in link.');
  process.exit(3);
}

const type = props.verification_type || 'magiclink';
const localUrl =
  `${APP_ORIGIN}/auth/callback?token_hash=${encodeURIComponent(props.hashed_token)}` +
  `&type=${encodeURIComponent(type)}`;

console.log('\n=== One-click sign-in (no email) ===');
console.log('Signing in as:', email);
console.log('\nOpen THIS url in the same browser where the app is running:\n');
console.log(localUrl);
console.log('\nIt sets your session and drops you on the home page, signed in.');
console.log('This link is single-use and expires; treat it like a password.\n');
