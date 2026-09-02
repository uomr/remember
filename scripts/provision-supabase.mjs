// @ts-check
/**
 * One-time Supabase provisioning for Remember.
 *
 * WHY THIS EXISTS: the app is local and its secrets live in .env.local. The
 * Personal Access Token (PAT) is intentionally NOT visible to the AI agent — it
 * is read here, locally, from the environment or .env.local, and used only to
 * talk to the Supabase Management API. No secret is ever printed.
 *
 * WHAT IT DOES (idempotent-ish, safe to re-run):
 *   S2  apply migration 0001 (tables, RLS, FTS index, triggers, storage bucket)
 *   S3  verify RLS enabled + policy count
 *   S4  verify GIN full-text index exists
 *   S5  verify private `memories` bucket exists and is not public
 *   S6  configure auth: site_url + redirect allow-list + email enabled
 *   S7  fetch the project's secret (service_role) key and store it in .env.local
 *
 * RUN (from the Remember/ folder), either:
 *   PowerShell:  $env:SUPABASE_ACCESS_TOKEN="<PAT>"; node scripts/provision-supabase.mjs
 *   cmd.exe:     set SUPABASE_ACCESS_TOKEN=<PAT> && node scripts/provision-supabase.mjs
 *   or put  SUPABASE_ACCESS_TOKEN=<PAT>  on its own line in .env.local, then:
 *                node scripts/provision-supabase.mjs
 *
 * After it prints DONE, REVOKE the PAT (see docs/SUPABASE_SETUP.md S11).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const API = 'https://api.supabase.com';
const ENV_PATH = '.env.local';
const MIGRATION_PATH = 'supabase/migrations/0001_initial_foundation.sql';
const SITE_URL = process.env.REMEMBER_SITE_URL || 'http://localhost:3000';

/** Parse a dotenv-style file into a Map (ignores comments/blank lines). */
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

function mask(v) {
  if (!v) return '(none)';
  return `${v.slice(0, 6)}…${v.slice(-4)} (len ${v.length})`;
}

const env = parseEnv(ENV_PATH);
const TOKEN = (process.env.SUPABASE_ACCESS_TOKEN || env.get('SUPABASE_ACCESS_TOKEN') || '').trim();
const SUPABASE_URL = env.get('NEXT_PUBLIC_SUPABASE_URL') || '';
const REF =
  process.env.SUPABASE_PROJECT_REF ||
  (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? '');

if (!TOKEN) {
  console.error(
    'ERROR: No SUPABASE_ACCESS_TOKEN found (env or .env.local). See the header of this file.',
  );
  process.exit(1);
}
if (!REF) {
  console.error('ERROR: Could not determine project ref from NEXT_PUBLIC_SUPABASE_URL in .env.local.');
  process.exit(1);
}

const authHeaders = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

/** Run SQL via the Management API; returns parsed rows (array) or throws. */
async function runSql(query) {
  const res = await fetch(`${API}/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  console.log(`Project ref : ${REF}`);
  console.log(`Site URL    : ${SITE_URL}`);
  console.log(`PAT         : ${mask(TOKEN)}`);
  console.log('---');

  // S2 — apply migration
  const sql = readFileSync(MIGRATION_PATH, 'utf8');
  console.log('S2  Applying migration 0001 …');
  try {
    await runSql(sql);
    console.log('S2  OK — migration applied.');
  } catch (e) {
    const msg = String(e.message || e);
    if (/already exists/i.test(msg)) {
      console.log('S2  Objects already exist — treating as already applied, continuing.');
    } else {
      console.error('S2  FAILED. Nothing changed on a fresh DB. Error:\n' + msg);
      process.exit(2);
    }
  }

  // S3 — RLS + policies
  const rls = await runSql(
    "select relname, relrowsecurity from pg_class where relname in ('profiles','memories','memory_files') order by relname;",
  );
  const policies = await runSql(
    "select count(*)::int as n from pg_policies where schemaname in ('public','storage');",
  );
  console.log('S3  RLS flags:', JSON.stringify(rls));
  console.log('S3  Policy count:', JSON.stringify(policies));

  // S4 — FTS index
  const idx = await runSql(
    "select indexname from pg_indexes where indexname = 'memories_search_vector_idx';",
  );
  console.log('S4  FTS index:', JSON.stringify(idx));

  // S5 — private bucket
  const bucket = await runSql("select id, public from storage.buckets where id = 'memories';");
  console.log('S5  Bucket:', JSON.stringify(bucket));

  // S6 — auth config
  console.log('S6  Updating auth config …');
  const authRes = await fetch(`${API}/v1/projects/${REF}/config/auth`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      site_url: SITE_URL,
      uri_allow_list: `${SITE_URL},${SITE_URL}/**`,
      external_email_enabled: true,
      mailer_otp_enabled: true,
      mailer_autoconfirm: false,
    }),
  });
  console.log(`S6  ${authRes.ok ? 'OK' : 'WARN ' + authRes.status} — auth config`);
  if (!authRes.ok) console.log('    ' + (await authRes.text()));

  // S7 — fetch secret (service_role) key and store in .env.local
  console.log('S7  Fetching project API keys …');
  let secret = '';
  try {
    const kRes = await fetch(`${API}/v1/projects/${REF}/api-keys?reveal=true`, {
      headers: authHeaders,
    });
    if (kRes.ok) {
      const keys = await kRes.json();
      const arr = Array.isArray(keys) ? keys : [];
      const hit =
        arr.find((k) => typeof k.api_key === 'string' && k.api_key.startsWith('sb_secret_')) ||
        arr.find((k) => k.name === 'service_role' || k.type === 'secret');
      secret = hit?.api_key || hit?.secret_jwt || '';
    } else {
      console.log('S7  api-keys ' + kRes.status + ' — will try legacy endpoint.');
    }
    if (!secret) {
      const lRes = await fetch(`${API}/v1/projects/${REF}/api-keys/legacy`, { headers: authHeaders });
      if (lRes.ok) {
        const legacy = await lRes.json();
        const arr = Array.isArray(legacy) ? legacy : [];
        secret = arr.find((k) => k.name === 'service_role')?.api_key || '';
      }
    }
  } catch (e) {
    console.log('S7  Could not fetch keys: ' + String(e.message || e));
  }

  if (secret) {
    const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8').split(/\r?\n/) : [];
    const kept = lines.filter(
      (l) => !/^#?\s*SUPABASE_SERVICE_ROLE_KEY\s*=/.test(l.trim()),
    );
    kept.push(`SUPABASE_SERVICE_ROLE_KEY=${secret}`);
    writeFileSync(ENV_PATH, kept.join('\n').replace(/\n{3,}/g, '\n\n'));
    console.log('S7  OK — stored service_role key in .env.local:', mask(secret));
  } else {
    console.log('S7  No secret key retrieved (optional for MVP). Skipping.');
  }

  console.log('---');
  console.log('DONE. Next: remove SUPABASE_ACCESS_TOKEN from .env.local and REVOKE the PAT (S11).');
}

main().catch((e) => {
  console.error('FATAL: ' + String(e.message || e));
  process.exit(3);
});
