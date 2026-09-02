/**
 * Backend verification harness — proves the security model and the critical
 * user journey actually work against the live Supabase project.
 *
 * Why this exists: RLS and Storage policies cannot be verified by typechecking
 * or by reading the migration. They must be exercised by two *real* users so we
 * can confirm user B genuinely cannot reach user A's rows or files.
 *
 * Run:  npm run verify:backend
 * Safe: creates two throwaway users, then deletes them and everything they made.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// supabase-js >= 2.11x constructs a RealtimeClient eagerly and throws on any
// runtime without a global WebSocket (Node < 22). This script never uses
// realtime, so a inert stand-in is enough to let createClient() through.
// Next.js supplies its own WebSocket, so the app itself is unaffected.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {
    constructor() {
      throw new Error('Realtime is not used by this verification script.');
    }
  };
}

const { createClient } = await import('@supabase/supabase-js');

// --- env ---------------------------------------------------------------
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
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL_ || !ANON || !SERVICE) {
  console.error('Missing Supabase env vars in .env.local (url / anon / service role).');
  process.exit(1);
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const BUCKET = 'memories';

// --- tiny assertion runner --------------------------------------------
let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * Mirror of the hybrid predicate built by `searchMemories` in
 * src/lib/memories/queries.ts. Kept byte-for-byte equivalent on purpose: if the
 * app's logic drifts, these assertions must drift with it or they prove nothing.
 *
 * Pass 1 = prefix tsquery over the generated `search_vector`.
 * Pass 2 = substring ilike over title/url/text_content, which is the only thing
 *          that can see words *inside* a URL or a file name, and the only thing
 *          that works for scripts the 'english' dictionary does not stem.
 */
const SUBSTRING_FIELDS = ['title', 'url', 'text_content'];

function tokenize(query) {
  return query.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function buildSearchFilter(query) {
  const terms = tokenize(query);
  if (terms.length === 0) return null;

  const tsQuery = terms.map((term) => `${term}:*`).join(' & ');
  const perTerm = terms.map(
    (term) => `or(${SUBSTRING_FIELDS.map((field) => `${field}.ilike.%${term}%`).join(',')})`,
  );
  const substringPass = perTerm.length === 1 ? perTerm[0] : `and(${perTerm.join(',')})`;

  return `search_vector.fts.${tsQuery},${substringPass}`;
}

/** Run a query through the app's real search predicate and return matched ids. */
async function appSearch(client, query) {
  const filter = buildSearchFilter(query);
  if (!filter) return { ids: [], error: null, empty: true };
  const { data, error } = await client.from('memories').select('id').or(filter);
  return { ids: (data ?? []).map((r) => r.id), error: error?.message };
}

async function makeUser(label) {
  const email = `verify-${label}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`;
  const password = `Vf-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser(${label}): ${error.message}`);

  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn(${label}): ${signInError.message}`);

  return { id: data.user.id, email, client };
}

async function main() {
  console.log(`\nRemember — backend verification against ${URL_}\n`);

  const a = await makeUser('a');
  const b = await makeUser('b');
  console.log(`  users: A=${a.id.slice(0, 8)}  B=${b.id.slice(0, 8)}\n`);

  const cleanup = [];

  try {
    // --- 1. profile auto-created by the auth trigger --------------------
    {
      const { data } = await a.client.from('profiles').select('id').eq('id', a.id).maybeSingle();
      check('auth trigger creates a profile row', data?.id === a.id);
    }

    // --- 2. note memory --------------------------------------------------
    const noteText = 'washing machine receipt from Ahmed electronics';
    let noteId;
    {
      const { data, error } = await a.client
        .from('memories')
        .insert({ user_id: a.id, type: 'note', text_content: noteText, title: 'washing machine' })
        .select('id')
        .single();
      check('create note memory', !error && !!data, error?.message);
      noteId = data?.id;
    }

    // --- 3. link + document-ish rows for search breadth ------------------
    // The link's searchable words live INSIDE the URL path. Postgres tokenizes
    // "example.com/black-shoes" as a single `url` token, so full-text alone can
    // never match "black shoes" here — this row exists to prove pass 2 works.
    let linkId;
    {
      const { data, error } = await a.client
        .from('memories')
        .insert({
          user_id: a.id,
          type: 'link',
          url: 'https://example.com/black-shoes',
          title: 'example.com',
        })
        .select('id')
        .single();
      check('create link memory', !error && !!data, error?.message);
      linkId = data?.id;
    }

    // A document whose only searchable word is in the file name.
    let docId;
    {
      const { data, error } = await a.client
        .from('memories')
        .insert({ user_id: a.id, type: 'document', title: 'Ahmed-invoice-2024.pdf' })
        .select('id')
        .single();
      check('create document memory', !error && !!data, error?.message);
      docId = data?.id;
    }

    // Arabic content: the 'english' text-search dictionary does not stem Arabic,
    // and the old query builder stripped every Arabic character, so any Arabic
    // query silently returned zero rows.
    let arabicId;
    {
      const { data, error } = await a.client
        .from('memories')
        .insert({
          user_id: a.id,
          type: 'note',
          title: 'حذاء أسود',
          text_content: 'الحذاء الأسود الذي أردت شراءه من المتجر',
        })
        .select('id')
        .single();
      check('create Arabic note memory', !error && !!data, error?.message);
      arabicId = data?.id;
    }

    // --- 4. file upload to the private bucket ----------------------------
    const memoryId = randomUUID();
    const path = `${a.id}/${memoryId}/receipt.png`;
    // 1x1 PNG — real magic bytes, matches what signatures.ts expects.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    {
      const { error } = await a.client.storage
        .from(BUCKET)
        .upload(path, png, { contentType: 'image/png', upsert: false });
      check('upload file to private bucket (own prefix)', !error, error?.message);
      if (!error) cleanup.push(() => admin.storage.from(BUCKET).remove([path]));
    }

    {
      const { error } = await a.client
        .from('memories')
        .insert({ id: memoryId, user_id: a.id, type: 'image', title: 'receipt.png' });
      check('create image memory row', !error, error?.message);
    }
    {
      const { error } = await a.client.from('memory_files').insert({
        memory_id: memoryId,
        user_id: a.id,
        storage_path: path,
        file_name: 'receipt.png',
        file_type: 'image/png',
        file_size: png.length,
      });
      check('create memory_files row', !error, error?.message);
    }

    // --- 5. signed URL actually serves the bytes -------------------------
    {
      const { data } = await a.client.storage.from(BUCKET).createSignedUrl(path, 60);
      const res = data?.signedUrl ? await fetch(data.signedUrl) : null;
      const bytes = res?.ok ? Buffer.from(await res.arrayBuffer()) : null;
      check('signed URL downloads the exact bytes', bytes?.length === png.length);
    }

    // --- 6. public (unsigned) URL must NOT work --------------------------
    {
      const res = await fetch(`${URL_}/storage/v1/object/public/${BUCKET}/${path}`);
      check('bucket is private (public URL rejected)', !res.ok, `status ${res.status}`);
    }

    // --- 7. search: runs the app's REAL predicate, not a hand-written one -
    {
      const { data, error } = await a.client
        .from('memories')
        .select('id')
        .textSearch('search_vector', 'washing & mach:*');
      check(
        'full-text prefix search finds the note',
        !error && data?.some((r) => r.id === noteId),
        error?.message,
      );
    }
    {
      const { ids, error } = await appSearch(a.client, 'washing machine');
      check('app search: plain full-text phrase', !error && ids.includes(noteId), error);
    }
    // REGRESSION: full-text alone returns 0 here — the words are inside the URL.
    {
      const { ids, error } = await appSearch(a.client, 'black shoes');
      check('app search: words inside a URL path ("black shoes")', !error && ids.includes(linkId), error);
    }
    // REGRESSION: file-name substring ("invoice" inside Ahmed-invoice-2024.pdf).
    {
      const { ids, error } = await appSearch(a.client, 'invoice');
      check('app search: word inside a file name ("invoice")', !error && ids.includes(docId), error);
    }
    // REGRESSION: the old builder stripped Arabic to an empty string -> 0 rows.
    {
      const { ids, error } = await appSearch(a.client, 'أسود');
      check('app search: Arabic query returns the Arabic memory', !error && ids.includes(arabicId), error);
    }
    {
      const { ids, error } = await appSearch(a.client, 'الحذاء الأسود');
      check('app search: multi-word Arabic phrase', !error && ids.includes(arabicId), error);
    }
    // Precision guard: search must not degrade into "return everything".
    {
      const { ids, error } = await appSearch(a.client, 'zzzznonexistentterm');
      check('app search: nonsense query returns nothing', !error && ids.length === 0, error);
    }
    // Injection guard: PostgREST-structural characters are stripped, so the
    // real words still match and the punctuation contributes nothing.
    {
      const { ids, error } = await appSearch(a.client, 'black, shoes!');
      check(
        'app search: punctuation between terms is ignored',
        !error && ids.includes(linkId),
        error,
      );
    }
    // A crafted `or(...)` payload must not error out or widen the result set.
    // ("or" tokenizes as an ordinary term, so all-terms-required yields none.)
    {
      const { ids, error } = await appSearch(a.client, 'black) or(user_id.not.is.null');
      check(
        'app search: injected PostgREST operators are inert',
        !error && ids.length === 0,
        error,
      );
    }
    {
      const { ids, error } = await appSearch(a.client, "'; drop table memories; --");
      check('app search: SQL-ish input is inert', !error && ids.length === 0, error);
    }
    // Punctuation-only input must return empty, not silently list everything.
    {
      const { ids, empty } = await appSearch(a.client, '!!!');
      check('app search: punctuation-only query returns empty', empty === true && ids.length === 0);
    }
    // Case-insensitivity and word order must not matter to human recall.
    {
      const { ids } = await appSearch(a.client, 'SHOES Black');
      check('app search: case- and order-insensitive', ids.includes(linkId));
    }
    // Precision: every term must match, so an extra unrelated word excludes.
    {
      const { ids } = await appSearch(a.client, 'black zzzznonexistentterm');
      check('app search: all terms required (no false positives)', ids.length === 0);
    }

    // --- 7b. drift guard: harness mirror vs. real app source --------------
    // These assertions are only meaningful while buildSearchFilter here matches
    // src/lib/memories/queries.ts. Fail loudly if the app's logic moves.
    {
      const source = readFileSync(
        new URL('../src/lib/memories/queries.ts', import.meta.url),
        'utf8',
      );
      check(
        'harness mirrors the app tokenizer',
        source.includes('query.match(/[\\p{L}\\p{N}]+/gu)'),
        'queries.ts tokenizer changed — update buildSearchFilter in this script',
      );
      check(
        'harness mirrors the app substring fields',
        source.includes("['title', 'url', 'text_content']"),
        'queries.ts SUBSTRING_FIELDS changed — update this script',
      );
      check(
        'harness mirrors the app AND-of-ORs shape',
        source.includes('and(${perTerm.join(\',\')})'),
        'queries.ts filter shape changed — update this script',
      );
    }

    // --- 8. RLS isolation: B must see nothing of A's ---------------------
    {
      const { data } = await b.client.from('memories').select('id');
      check('RLS: user B sees zero of user A\'s memories', (data?.length ?? 0) === 0);
    }
    {
      const { data } = await b.client.from('memory_files').select('id');
      check('RLS: user B sees zero of user A\'s memory_files', (data?.length ?? 0) === 0);
    }
    {
      const { data } = await b.client.from('memories').select('id').eq('id', noteId).maybeSingle();
      check('RLS: user B cannot fetch A\'s memory by direct id', !data);
    }
    // Search is a second read path; RLS must hold there too, not just on list.
    {
      const { ids } = await appSearch(b.client, 'black shoes');
      check('RLS: search does not leak A\'s memories to user B', ids.length === 0);
    }
    {
      const { data } = await b.client.from('profiles').select('id').eq('id', a.id).maybeSingle();
      check('RLS: user B cannot read A\'s profile', !data);
    }

    // --- 9. RLS: spoofed user_id insert must be rejected ------------------
    {
      const { error } = await b.client
        .from('memories')
        .insert({ user_id: a.id, type: 'note', text_content: 'spoofed' });
      check('RLS: insert with a spoofed user_id is rejected', !!error, error ? '' : 'insert succeeded!');
    }

    // --- 10. Storage RLS: B cannot read or write A's prefix ---------------
    {
      const { data, error } = await b.client.storage.from(BUCKET).download(path);
      check('Storage RLS: user B cannot download A\'s file', !!error || !data);
    }
    {
      const { error } = await b.client.storage
        .from(BUCKET)
        .upload(`${a.id}/${randomUUID()}/intruder.png`, png, { contentType: 'image/png' });
      check('Storage RLS: user B cannot write into A\'s prefix', !!error, error ? '' : 'upload succeeded!');
    }
    {
      const { data } = await b.client.storage.from(BUCKET).createSignedUrl(path, 60);
      const res = data?.signedUrl ? await fetch(data.signedUrl) : null;
      check('Storage RLS: user B cannot mint a working signed URL for A\'s file', !res || !res.ok);
    }

    // --- 11. B cannot delete A's memory ----------------------------------
    {
      await b.client.from('memories').delete().eq('id', noteId);
      const { data } = await a.client.from('memories').select('id').eq('id', noteId).maybeSingle();
      check('RLS: user B cannot delete A\'s memory', data?.id === noteId);
    }

    // --- 12. delete cascade + storage cleanup ----------------------------
    {
      const { error } = await a.client.from('memories').delete().eq('id', memoryId);
      check('owner can delete their memory', !error, error?.message);
    }
    {
      const { data } = await a.client.from('memory_files').select('id').eq('memory_id', memoryId);
      check('delete cascades to memory_files', (data?.length ?? 0) === 0);
    }
    {
      const { error } = await a.client.storage.from(BUCKET).remove([path]);
      check('owner can remove their storage object', !error, error?.message);
      const { data } = await admin.storage.from(BUCKET).list(`${a.id}/${memoryId}`);
      check('no orphaned file remains in storage', (data?.length ?? 0) === 0);
    }
  } finally {
    for (const fn of cleanup) await fn().catch(() => {});
    await admin.auth.admin.deleteUser(a.id).catch(() => {});
    await admin.auth.admin.deleteUser(b.id).catch(() => {});
    console.log('\n  cleanup: test users and their data removed.');
  }

  console.log(`\n${passed} passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nVerification crashed:', err.message);
  process.exit(1);
});
