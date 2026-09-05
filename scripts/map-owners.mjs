/**
 * Read-only + link helper: map every memory to the email that owns it, and
 * generate a no-email sign-in link for the account that owns the most IMAGES
 * (so you can actually see/search your enriched pictures). Prints no private
 * memory content.
 *
 * Run: node scripts/map-owners.mjs
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
const APP_ORIGIN = 'http://localhost:3000';
const supaUrl = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaSecret =
  env.SUPABASE_SECRET_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(supaUrl, supaSecret, {
  auth: { persistSession: false },
});

const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
const idToEmail = new Map(list.users.map((u) => [u.id, u.email || '(no email)']));

const { data: mems } = await admin
  .from('memories')
  .select('user_id, type, created_at')
  .order('created_at', { ascending: true });

console.log('=== Memories by owner ===');
const imageCountByOwner = {};
for (const m of mems || []) {
  if (m.type === 'image') imageCountByOwner[m.user_id] = (imageCountByOwner[m.user_id] || 0) + 1;
  console.log(`- ${m.type.padEnd(8)} | ${m.created_at} | owner: ${idToEmail.get(m.user_id)}`);
}

const topOwnerId = Object.entries(imageCountByOwner).sort((a, b) => b[1] - a[1])[0]?.[0];
if (!topOwnerId) {
  console.log('\nNo image memories found.');
  process.exit(0);
}
const topEmail = idToEmail.get(topOwnerId);
console.log(`\nAccount that owns the images: ${topEmail} (${imageCountByOwner[topOwnerId]} images)`);

const { data, error } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email: topEmail,
  options: { redirectTo: `${APP_ORIGIN}/auth/callback` },
});
if (error) {
  console.error('generateLink failed:', error.message);
  process.exit(2);
}
const p = data.properties;
const type = p.verification_type || 'magiclink';
console.log('\n=== One-click sign-in link for the IMAGE account (no email) ===');
console.log(`${APP_ORIGIN}/auth/callback?token_hash=${encodeURIComponent(p.hashed_token)}&type=${encodeURIComponent(type)}`);
console.log('\nOpen it in the browser where the app runs. Then search "شعار" — the 3 images appear.');
