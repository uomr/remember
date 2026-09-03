/**
 * Production Database Verification Suite for Document Intelligence (M2A).
 *
 * Verifies live Supabase PostgreSQL schema, RLS, FTS, Page 47 deep retrieval,
 * cascade deletion, and idempotency using real authenticated users A and B.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {
    constructor() {
      throw new Error('Realtime not needed for verification');
    }
  };
}

const { createClient } = await import('@supabase/supabase-js');

// Read .env.local
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
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
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
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

console.log(`\nM2A Production Database Verification against ${URL_}\n`);

let userA = null;
let userB = null;

try {
  // 1. Schema check: verify table and columns exist
  const { data: chunkTableCheck, error: tableErr } = await admin
    .from('memory_chunks')
    .select('id')
    .limit(1);

  if (tableErr) {
    check('Schema: public.memory_chunks table exists and is accessible', false, tableErr.message);
    throw new Error(`public.memory_chunks table does not exist yet. Apply migration 0003 first.`);
  }
  check('Schema: public.memory_chunks table exists and is accessible', true);

  // 2. Create users
  userA = await makeUser('m2a-userA');
  userB = await makeUser('m2a-userB');
  check('Auth: User A and User B created and authenticated', Boolean(userA.client && userB.client));

  // 3. User A creates a document memory
  const memoryId = randomUUID();
  const { error: memErr } = await userA.client.from('memories').insert({
    id: memoryId,
    user_id: userA.id,
    type: 'document',
    title: 'master_agreement_50_pages.pdf',
    text_content: 'Preview: Master Agreement between Acme and Beta',
    file_hash: 'mock-sha256-file-hash',
    content_hash: 'mock-sha256-content-hash',
    parser_version: 'v1',
    extraction_status: 'done',
    chunk_count: 4,
  });
  check('Document Memory: User A inserts parent memory with identity fields', !memErr, memErr?.message);

  // 4. User A inserts chunks (including Page 47 Termination Clause)
  const chunksToInsert = [
    {
      memory_id: memoryId,
      user_id: userA.id,
      chunk_index: 0,
      page_number: 1,
      section_title: 'Introduction',
      chunk_text: 'Master Service Agreement entered into by Acme Corp and Beta Technologies.',
      chunk_hash: 'hash-chunk-0',
      word_count: 10,
    },
    {
      memory_id: memoryId,
      user_id: userA.id,
      chunk_index: 1,
      page_number: 15,
      section_title: 'Payment Terms',
      chunk_text: 'Payment terms: invoices are due net 30 days via wire transfer to Bank Account 84721.',
      chunk_hash: 'hash-chunk-1',
      word_count: 15,
    },
    {
      memory_id: memoryId,
      user_id: userA.id,
      chunk_index: 2,
      page_number: 47,
      section_title: 'Termination',
      chunk_text: 'Termination clause: either party may terminate this agreement with thirty (30) days written notice.',
      chunk_hash: 'hash-chunk-2',
      word_count: 14,
    },
    {
      memory_id: memoryId,
      user_id: userA.id,
      chunk_index: 3,
      page_number: 50,
      section_title: 'Signatures',
      chunk_text: 'In witness whereof, the parties have executed this agreement as of the date first written.',
      chunk_hash: 'hash-chunk-3',
      word_count: 15,
    },
  ];

  const { error: chunkInsertErr } = await userA.client.from('memory_chunks').insert(chunksToInsert);
  check('Chunks: User A inserts 4 structure-aware chunks', !chunkInsertErr, chunkInsertErr?.message);

  // 5. Test FTS on Page 47 Termination Clause
  const { data: searchPage47, error: searchErr1 } = await userA.client
    .from('memory_chunks')
    .select('memory_id, page_number, chunk_text, chunk_index')
    .textSearch('search_vector', 'termination:* & 30:*', { config: 'simple' });

  check(
    'FTS: "termination 30" query retrieves chunk on Page 47',
    !searchErr1 && searchPage47?.length > 0 && searchPage47[0].page_number === 47,
    `found: ${searchPage47?.length} rows, page: ${searchPage47?.[0]?.page_number}`,
  );

  // 6. Test Substring Search on invoice number inside chunk
  const { data: searchInvoice, error: searchErr2 } = await userA.client
    .from('memory_chunks')
    .select('memory_id, page_number, chunk_text')
    .ilike('chunk_text', '%84721%');

  check(
    'FTS / Lexical: invoice number "84721" retrieved on Page 15',
    !searchErr2 && searchInvoice?.length > 0 && searchInvoice[0].page_number === 15,
    `found page: ${searchInvoice?.[0]?.page_number}`,
  );

  // 7. Verify Page Number preservation
  const { data: pageVerify, error: pageErr } = await userA.client
    .from('memory_chunks')
    .select('page_number')
    .eq('chunk_hash', 'hash-chunk-2')
    .single();

  check('Page Attribute: page_number 47 preserved accurately in DB row', !pageErr && pageVerify?.page_number === 47);

  // 8. RLS Security: User B must see ZERO of User A's chunks
  const { data: userBChunks, error: rlsErr1 } = await userB.client.from('memory_chunks').select('*');
  check('RLS: User B sees zero of User A chunks (select isolation)', !rlsErr1 && userBChunks?.length === 0, `user B saw: ${userBChunks?.length}`);

  // 9. RLS Security: User B cannot read User A chunk by direct ID
  const chunkId = searchPage47?.[0] ? (searchPage47[0]).memory_id : null;
  const { data: directRead, error: directErr } = await userB.client
    .from('memory_chunks')
    .select('*')
    .eq('memory_id', memoryId);
  check('RLS: User B cannot read chunk by direct parent memory_id', (directRead?.length ?? 0) === 0);

  // 10. RLS Security: User B cannot insert a chunk spoofing User A's memory
  const { error: spoofErr } = await userB.client.from('memory_chunks').insert({
    memory_id: memoryId,
    user_id: userA.id,
    chunk_index: 99,
    chunk_text: 'Spoofed chunk',
    chunk_hash: 'spoof',
  });
  check('RLS: Insert with spoofed user_id is rejected by with check', Boolean(spoofErr));

  // 11. Idempotency: Reprocessing same document replaces chunks cleanly without duplicates
  // Simulate re-enrichment of unchanged document:
  await userA.client.from('memory_chunks').delete().eq('memory_id', memoryId);
  const { error: reinsertErr } = await userA.client.from('memory_chunks').insert(chunksToInsert);
  const { data: countAfterReprocess } = await userA.client
    .from('memory_chunks')
    .select('id', { count: 'exact' })
    .eq('memory_id', memoryId);

  check(
    'Idempotency: Reprocessing document cleanly replaces chunks (count = 4, no duplicates)',
    !reinsertErr && countAfterReprocess?.length === 4,
    `chunk count: ${countAfterReprocess?.length}`,
  );

  // 12. Cascade Delete: Deleting parent memory automatically removes all chunks
  const { error: delErr } = await userA.client.from('memories').delete().eq('id', memoryId);
  const { data: chunksAfterDelete } = await admin
    .from('memory_chunks')
    .select('id')
    .eq('memory_id', memoryId);

  check(
    'Cascade Delete: Deleting parent memory automatically deletes all child chunks',
    !delErr && chunksAfterDelete?.length === 0,
    `remaining orphaned chunks: ${chunksAfterDelete?.length}`,
  );
} catch (err) {
  console.error('Fatal test error:', err);
  failed += 1;
} finally {
  // Cleanup test users
  if (userA) await admin.auth.admin.deleteUser(userA.id).catch(() => {});
  if (userB) await admin.auth.admin.deleteUser(userB.id).catch(() => {});
  console.log('\n  Cleanup: throwaway verification users removed.');
}

console.log(`\nVerification Summary: ${passed} passed, ${failed} failed.\n`);

if (failed > 0) {
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
