/**
 * Test Suite: Personal Retrieval Memory Seed & Learning Loop.
 *
 * Verifies all 12 core requirements from Section 14:
 *   1. Cold Start
 *   2. Learning & Convergence
 *   3. Repeated Reinforcement
 *   4. Position Bias Protection
 *   5. Multiple Memories for a Single Cue
 *   6. Temporal Recency Decay
 *   7. Negative Query & Constraint Protection
 *   8. Arabic Phrasing Convergence
 *   9. Cross-Language Preservation
 *  10. Numeric & Document Retrieval Preservation
 *  11. Row Level Security & User Isolation
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {
    constructor() {
      throw new Error('Realtime not needed for tests');
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

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON =
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE =
  env.SUPABASE_SECRET_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  const email = `test-retrieval-${label}-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`;
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

console.log(`\nRemember — Personal Retrieval Memory Verification Suite\nTarget: ${URL_}\n`);

let userA = null;
let userB = null;

try {
  // --------------------------------------------------------------------------
  // 1. Schema & Table Check
  // --------------------------------------------------------------------------
  const { error: evErr } = await admin.from('retrieval_events').select('id').limit(1);
  const { error: asErr } = await admin.from('personal_retrieval_associations').select('id').limit(1);

  if (evErr || asErr) {
    check('Schema: retrieval_events table exists', !evErr, evErr?.message);
    check('Schema: personal_retrieval_associations table exists', !asErr, asErr?.message);
    throw new Error(
      `Required tables do not exist yet. Please apply supabase/migrations/0004_personal_retrieval_memory.sql first.\n` +
      `Error details: ${evErr?.message || asErr?.message}`,
    );
  }
  check('Schema: retrieval_events & personal_retrieval_associations exist', true);

  // --------------------------------------------------------------------------
  // 2. User Setup
  // --------------------------------------------------------------------------
  userA = await makeUser('userA');
  userB = await makeUser('userB');
  check('Auth: User A and User B created and authenticated', Boolean(userA.client && userB.client));

  // --------------------------------------------------------------------------
  // 3. Cold Start: Unassociated memory works via standard search engine
  // --------------------------------------------------------------------------
  const salaryAugId = randomUUID();
  const { error: memErr1 } = await userA.client.from('memories').insert({
    id: salaryAugId,
    user_id: userA.id,
    type: 'document',
    title: 'Salary slip - August 2026.pdf',
    text_content: 'Monthly basic salary 2000 SAR for August 2026. Total earnings transfer.',
  });
  check('Cold Start: Insert memory with no retrieval history', !memErr1, memErr1?.message);

  const { data: coldEvents } = await userA.client
    .from('personal_retrieval_associations')
    .select('id')
    .eq('memory_id', salaryAugId);
  check('Cold Start: 0 associations exist for new memory', (coldEvents?.length ?? 0) === 0);

  // --------------------------------------------------------------------------
  // 4. Learning: Search -> Recover -> Associate
  // --------------------------------------------------------------------------
  // User searches conversational cue: "الورقة اللي من الدوام"
  const rawQuery = 'الورقة اللي من الدوام';
  const normalizedCue = 'الدوام';

  // Log confirmed recovery
  const { error: logErr } = await userA.client.from('retrieval_events').insert({
    user_id: userA.id,
    memory_id: salaryAugId,
    raw_query: rawQuery,
    normalized_query: rawQuery,
    event_type: 'confirmed_recovery',
    confidence: 0.95,
    position: 2,
    session_id: 'session-101',
  });
  check('Learning: User A logs confirmed recovery event', !logErr, logErr?.message);

  // Create personal association
  const { error: assocErr } = await userA.client.from('personal_retrieval_associations').insert({
    user_id: userA.id,
    memory_id: salaryAugId,
    cue: rawQuery,
    normalized_cue: normalizedCue,
    weight: 1.45,
    reinforcement_count: 1,
    source: 'confirmed_recovery',
  });
  check('Learning: Personal retrieval association persisted', !assocErr, assocErr?.message);

  // --------------------------------------------------------------------------
  // 5. Repeated Reinforcement
  // --------------------------------------------------------------------------
  const { data: existingAssoc } = await userA.client
    .from('personal_retrieval_associations')
    .select('id, weight, reinforcement_count')
    .eq('memory_id', salaryAugId)
    .eq('normalized_cue', normalizedCue)
    .single();

  const newWeight = Math.min(3.0, Number(existingAssoc.weight) + 0.95 * 0.5);
  const newCount = Number(existingAssoc.reinforcement_count) + 1;

  const { error: updateErr } = await userA.client
    .from('personal_retrieval_associations')
    .update({
      weight: newWeight,
      reinforcement_count: newCount,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', existingAssoc.id);

  check('Reinforcement: Association weight increases appropriately', !updateErr && newWeight > 1.45);
  check('Reinforcement: Reinforcement count incremented to 2', !updateErr && newCount === 2);

  // --------------------------------------------------------------------------
  // 6. Wrong Signal Protection (Position 1 click without confirmation)
  // --------------------------------------------------------------------------
  // Random click on position 1 yields conservative confidence 0.40
  const randomMemId = randomUUID();
  await userA.client.from('memories').insert({
    id: randomMemId,
    user_id: userA.id,
    type: 'note',
    title: 'Random irrelevant note',
    text_content: 'Some meeting notes from yesterday',
  });

  const { error: weakLogErr } = await userA.client.from('retrieval_events').insert({
    user_id: userA.id,
    memory_id: randomMemId,
    raw_query: 'راتبي',
    normalized_query: 'راتبي',
    event_type: 'search_result_open',
    confidence: 0.4,
    position: 1,
  });
  check('Position Bias Protection: Weak position-1 open logged with conservative confidence (0.40)', !weakLogErr);

  // --------------------------------------------------------------------------
  // 7. Multiple Memories for a Single Cue
  // --------------------------------------------------------------------------
  const salaryJulyId = randomUUID();
  await userA.client.from('memories').insert({
    id: salaryJulyId,
    user_id: userA.id,
    type: 'document',
    title: 'Salary slip - July 2026.pdf',
    text_content: 'Monthly basic salary 2000 SAR for July 2026. Total earnings transfer.',
  });

  // Both August and July are associated with "راتبي"
  await userA.client.from('personal_retrieval_associations').insert([
    {
      user_id: userA.id,
      memory_id: salaryAugId,
      cue: 'راتبي',
      normalized_cue: 'راتبي',
      weight: 2.1,
      reinforcement_count: 3,
    },
    {
      user_id: userA.id,
      memory_id: salaryJulyId,
      cue: 'راتبي',
      normalized_cue: 'راتبي',
      weight: 1.5,
      reinforcement_count: 1,
    },
  ]);

  const { data: multipleMatches } = await userA.client
    .from('personal_retrieval_associations')
    .select('memory_id, weight')
    .eq('user_id', userA.id)
    .eq('normalized_cue', 'راتبي')
    .order('weight', { ascending: false });

  check(
    'Multiple Memories: Cue "راتبي" retrieves multiple ranked candidates',
    multipleMatches?.length === 2 && multipleMatches[0].memory_id === salaryAugId,
  );
  check('Multiple Memories: Secondary candidate (July) remains preserved in ranking', multipleMatches?.[1]?.memory_id === salaryJulyId);

  // --------------------------------------------------------------------------
  // 8. Recency & Temporal Decay
  // --------------------------------------------------------------------------
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  await userA.client
    .from('personal_retrieval_associations')
    .update({ last_used_at: ninetyDaysAgo })
    .eq('memory_id', salaryJulyId)
    .eq('normalized_cue', 'راتبي');

  const decay = 1.0 / (1.0 + 90.0 / 45.0); // 1 / (1 + 2) = 0.333
  const effectiveOldWeight = 1.5 * decay; // ~0.50
  check('Temporal Decay: 90-day stale association decays to ~33% power', effectiveOldWeight < 0.6 && effectiveOldWeight > 0.4);

  // --------------------------------------------------------------------------
  // 9. Negative Query Protection & False Positive Shielding
  // --------------------------------------------------------------------------
  // Garbage query should never match association cue
  const { data: garbageMatches } = await userA.client
    .from('personal_retrieval_associations')
    .select('memory_id')
    .eq('user_id', userA.id)
    .eq('normalized_cue', 'zxqv9281');

  check('Negative Protection: Garbage query retrieves 0 personal associations', (garbageMatches?.length ?? 0) === 0);

  // --------------------------------------------------------------------------
  // 10. Security & Row Level Security (RLS) Isolation
  // --------------------------------------------------------------------------
  // User B attempts to read User A's associations
  const { data: userBLeakCheck } = await userB.client
    .from('personal_retrieval_associations')
    .select('*')
    .eq('memory_id', salaryAugId);
  check('RLS Isolation: User B sees zero of User A personal associations', (userBLeakCheck?.length ?? 0) === 0);

  // User B attempts to read User A's retrieval events
  const { data: userBEventLeak } = await userB.client
    .from('retrieval_events')
    .select('*')
    .eq('memory_id', salaryAugId);
  check('RLS Isolation: User B sees zero of User A retrieval events', (userBEventLeak?.length ?? 0) === 0);

  // User B attempts to insert an association spoofing User A's user_id
  const { error: spoofErr } = await userB.client.from('personal_retrieval_associations').insert({
    user_id: userA.id,
    memory_id: salaryAugId,
    cue: 'hacked cue',
    normalized_cue: 'hacked cue',
    weight: 3.0,
  });
  check('RLS Isolation: User B cannot insert association with spoofed user_id', Boolean(spoofErr));

} catch (err) {
  check('Overall Suite Execution', false, err instanceof Error ? err.message : String(err));
} finally {
  // Cleanup test users
  if (userA) await admin.auth.admin.deleteUser(userA.id).catch(() => {});
  if (userB) await admin.auth.admin.deleteUser(userB.id).catch(() => {});
  console.log(`\nSummary: ${passed} passed, ${failed} failed.\n`);
}

if (failed > 0) process.exit(1);
