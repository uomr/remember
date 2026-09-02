/**
 * Apply a SQL migration to the LIVE Supabase project via the Management API.
 *
 * The app itself NEVER uses a Personal Access Token (PAT). Applying DDL is a
 * one-off admin action that needs a PAT in SUPABASE_ACCESS_TOKEN (env or a line
 * in .env.local). Create one at https://supabase.com/dashboard/account/tokens,
 * run this, then REVOKE it. If you'd rather not use a PAT, paste the migration
 * file into the Supabase Dashboard → SQL Editor and run it there instead.
 *
 * Run: node scripts/apply-migration.mjs supabase/migrations/0002_semantic_search.sql
 */
import { readFileSync, existsSync } from 'node:fs';

const API = 'https://api.supabase.com';
const ENV_PATH = '.env.local';
const migrationPath = process.argv[2] || 'supabase/migrations/0002_semantic_search.sql';

function parseEnv(path) {
  const map = new Map();
  if (!existsSync(path)) return map;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    map.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return map;
}

const env = parseEnv(ENV_PATH);
const TOKEN = (process.env.SUPABASE_ACCESS_TOKEN || env.get('SUPABASE_ACCESS_TOKEN') || '').trim();
const SUPABASE_URL = env.get('NEXT_PUBLIC_SUPABASE_URL') || '';
const REF =
  process.env.SUPABASE_PROJECT_REF ||
  (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? '');

if (!TOKEN) {
  console.error(
    'No SUPABASE_ACCESS_TOKEN found.\n' +
      '  Option 1 (fastest, no token): open Supabase Dashboard → SQL Editor,\n' +
      `             paste ${migrationPath} and click Run.\n` +
      '  Option 2: create a PAT at https://supabase.com/dashboard/account/tokens,\n' +
      '             add SUPABASE_ACCESS_TOKEN=<pat> to .env.local, re-run this, then revoke it.',
  );
  process.exit(1);
}
if (!REF) {
  console.error('Could not determine project ref from NEXT_PUBLIC_SUPABASE_URL.');
  process.exit(1);
}

const sql = readFileSync(migrationPath, 'utf8');
console.log(`Applying ${migrationPath} to project ${REF} …`);

const res = await fetch(`${API}/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();

if (res.ok) {
  console.log('OK — migration applied.');
  console.log('Result:', text.slice(0, 300));
  console.log('\nReminder: remove SUPABASE_ACCESS_TOKEN from .env.local and REVOKE the PAT.');
} else if (/already exists/i.test(text)) {
  console.log('Objects already exist — treated as already applied.');
} else {
  console.error(`FAILED (${res.status}):`, text.slice(0, 600));
  process.exit(2);
}
