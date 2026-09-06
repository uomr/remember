import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function check() {
  const [e, a] = await Promise.all([
    admin.from('retrieval_events').select('id').limit(1),
    admin.from('personal_retrieval_associations').select('id').limit(1),
  ]);

  console.log('retrieval_events:', e.error ? e.error.message : 'READY');
  console.log('personal_retrieval_associations:', a.error ? a.error.message : 'READY');

  if (!e.error && !a.error) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

check();
