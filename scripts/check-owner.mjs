/**
 * Read-only: does the given email's user own the existing memories? Prevents a
 * "why is my library empty after sign-in?" surprise when memories were created
 * under a different account. Prints no private content.
 *
 * Run: node scripts/check-owner.mjs your-email@example.com
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
const supaUrl = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supaSecret =
  env.SUPABASE_SECRET_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(supaUrl, supaSecret, {
  auth: { persistSession: false },
});

const email = (process.argv[2] || '').toLowerCase();

const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listErr) {
  console.error('listUsers failed:', listErr.message);
  process.exit(2);
}
const user = list.users.find((u) => (u.email || '').toLowerCase() === email);
console.log('Email:', email);
console.log('User exists:', !!user);
if (user) {
  console.log('User id:', user.id);
  console.log('Email confirmed:', user.email_confirmed_at || user.confirmed_at || 'NO (unconfirmed)');
}
console.log('Total users in project:', list.users.length);

const { data: mems, error: memErr } = await admin.from('memories').select('user_id, type');
if (memErr) {
  console.error('memories query failed:', memErr.message);
  process.exit(3);
}
const owners = [...new Set((mems || []).map((m) => m.user_id))];
console.log('\nTotal memories:', (mems || []).length);
console.log('Distinct owner user_ids:', owners.length);
const mine = user ? (mems || []).filter((m) => m.user_id === user.id).length : 0;
console.log(`Memories owned by ${email}: ${mine} of ${(mems || []).length}`);
if (user && mine === 0 && (mems || []).length > 0) {
  console.log('\n⚠️  The existing memories belong to a DIFFERENT user id — this email will see an empty library.');
} else if (mine > 0) {
  console.log('\n✅ This email owns the existing memories — they will appear after sign-in.');
}
