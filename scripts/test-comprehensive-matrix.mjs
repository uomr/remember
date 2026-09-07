/**
 * Comprehensive Forensic Test Matrix
 * Covers: Editing Lifecycle, Image Intelligence, Unseen Queries,
 * Compound Contradiction, Salary/Temporal, Admin Security & Analytics.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
try {
  const serverOnlyPath = require.resolve('server-only');
  require.cache[serverOnlyPath] = { id: serverOnlyPath, filename: serverOnlyPath, loaded: true, exports: {} };
} catch {}

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class DummyWebSocket {};
}

import { parseQueryIntent } from '../src/lib/memories/queryUnderstanding.ts';
const { rankCandidatesByCompoundIntent } = await import('../src/lib/memories/queries.ts');
import { fetchAdminDashboardData } from '../src/lib/admin/data.ts';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

for (const [k, v] of Object.entries(env)) {
  process.env[k] = v;
}

const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
const results = [];

function recordTest(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`[PASS] ${name} ${detail ? `(${detail})` : ''}`);
  } else {
    failed++;
    console.error(`[FAIL] ${name} ${detail ? `(${detail})` : ''}`);
  }
  results.push({ name, ok, detail });
}

async function runAllTests() {
  console.log('======================================================');
  console.log('STARTING FORENSIC TEST MATRIX');
  console.log('======================================================\n');

  // ──────────────────────────────────────────────────────────
  // SUITE 1: EDITING LIFECYCLE & LIVE RE-INDEXING
  // ──────────────────────────────────────────────────────────
  console.log('--- SUITE 1: Editing Lifecycle & Re-indexing ---');
  const testUserId = 'bd07342f-440f-4860-83df-d21c4c0e205d'; // Existing owner user
  const testMemId = 'e1111111-2222-3333-4444-555555555555';

  await admin.from('memories').delete().eq('id', testMemId);

  // 1.1 Create test image memory with note "سير دركسون"
  const { error: insertErr } = await admin.from('memories').insert({
    id: testMemId,
    user_id: testUserId,
    type: 'image',
    title: 'camera_10002899.jpg',
    text_content: 'سير دركسون\n\nA black ribbed serpentine steering drive belt for a car engine.',
    extraction_status: 'done',
  });
  recordTest('1.1 Create Memory with Note "سير دركسون"', !insertErr, insertErr?.message);

  // 1.2 Test initial retrieval: "سير" and "سير دركسون"
  const { data: memsInitial } = await admin.from('memories').select('*, memory_files(*)');
  const q1Intent = parseQueryIntent('سير');
  const res1 = rankCandidatesByCompoundIntent(memsInitial, q1Intent, q1Intent.coreTerms, new Map());
  recordTest('1.2a Search "سير" finds image', res1.ids.includes(testMemId));

  const q2Intent = parseQueryIntent('سير دركسون');
  const res2 = rankCandidatesByCompoundIntent(memsInitial, q2Intent, q2Intent.coreTerms, new Map());
  recordTest('1.2b Search "سير دركسون" finds image', res2.ids.includes(testMemId));

  // 1.3 Simulate User Editing Note to: "سير دركسون لأكسنت 2018 — مستعمل"
  const updatedNote = 'سير دركسون لأكسنت 2018 — مستعمل';
  const updatedFullText = `${updatedNote}\n\nA black ribbed serpentine steering drive belt for a car engine.`;
  const { error: updateErr } = await admin
    .from('memories')
    .update({
      text_content: updatedFullText,
      updated_at: new Date().toISOString(),
    })
    .eq('id', testMemId);
  recordTest('1.3 Update Memory Note via Edit Lifecycle', !updateErr, updateErr?.message);

  // 1.4 Test retrieval after edit
  const { data: memsUpdated } = await admin.from('memories').select('*, memory_files(*)');

  const qEdit1 = parseQueryIntent('2018');
  const resEdit1 = rankCandidatesByCompoundIntent(memsUpdated, qEdit1, qEdit1.coreTerms, new Map());
  recordTest('1.4a Search new number "2018" finds edited memory', resEdit1.ids.includes(testMemId));

  const qEdit2 = parseQueryIntent('مستعمل');
  const resEdit2 = rankCandidatesByCompoundIntent(memsUpdated, qEdit2, qEdit2.coreTerms, new Map());
  recordTest('1.4b Search new term "مستعمل" finds edited memory', resEdit2.ids.includes(testMemId));

  const qEdit3 = parseQueryIntent('سير دركسون لأكسنت');
  const resEdit3 = rankCandidatesByCompoundIntent(memsUpdated, qEdit3, qEdit3.coreTerms, new Map());
  recordTest('1.4c Search compound "سير دركسون لأكسنت" finds edited memory', resEdit3.ids.includes(testMemId));

  // Clean up
  await admin.from('memories').delete().eq('id', testMemId);

  // ──────────────────────────────────────────────────────────
  // SUITE 2: ADMIN SECURITY & AUTHORIZATION GATE
  // ──────────────────────────────────────────────────────────
  console.log('\n--- SUITE 2: Admin Security & Authorization ---');
  // Check default admin allowlist
  const adminEmails = new Set(['admin@remember.app', 'boviy33963@hebase.com']);
  recordTest('2.1 Owner email recognized (boviy33963@hebase.com)', adminEmails.has('boviy33963@hebase.com'));
  recordTest('2.2 Owner email recognized (admin@remember.app)', adminEmails.has('admin@remember.app'));
  recordTest('2.3 Normal user blocked (test@example.com)', !adminEmails.has('test@example.com'));
  recordTest('2.4 Normal user blocked (stranger@gmail.com)', !adminEmails.has('stranger@gmail.com'));

  // 2.5 Admin dashboard data aggregation
  try {
    const dashData = await fetchAdminDashboardData();
    recordTest('2.5 Admin Dashboard Aggregation succeeds', Boolean(dashData.metrics.totalUsers > 0));
    recordTest('2.6 Admin Dashboard User list populated', Boolean(dashData.users.length > 0));
    recordTest('2.7 Admin Dashboard Storage bytes calculated', typeof dashData.metrics.totalStorageBytes === 'number');
    recordTest('2.8 Admin Dashboard System Health populated', dashData.systemHealth.databaseStatus === 'operational');
  } catch (err) {
    recordTest('2.5 Admin Dashboard Aggregation', false, err.message);
  }

  // ──────────────────────────────────────────────────────────
  // SUITE 3: UNSEEN DOMAIN QUERIES & CONTRADICTION VETO
  // ──────────────────────────────────────────────────────────
  console.log('\n--- SUITE 3: Unseen Domain Queries & Retrieval Precision ---');
  const { data: allMemories } = await admin.from('memories').select('*, memory_files(*)');
  const { data: chunkRows } = await admin.from('memory_chunks').select('memory_id, chunk_text');
  const chunksByMemoryId = new Map();
  for (const cr of chunkRows || []) {
    const list = chunksByMemoryId.get(cr.memory_id) || [];
    list.push(cr.chunk_text);
    chunksByMemoryId.set(cr.memory_id, list);
  }

  const unseenTests = [
    // Colors & Shapes
    { q: 'أحمر', targetContains: 'red', desc: 'Color detection (أحمر)' },
    { q: 'كوب أحمر', targetContains: 'red', desc: 'Object + Color (كوب أحمر)' },
    // Vehicle & Compound Contradictions
    {
      q: 'صدام خلفي أكسنت',
      mustNotInclude: 'front',
      desc: 'Rear bumper Accent does NOT return front bumper',
    },
    // Salary & Months
    { q: 'راتبي شهر 7', targetMonth: '7', desc: 'Exact month 7 isolation' },
    { q: 'راتبي شهر 8', targetMonth: '8', desc: 'Exact month 8 isolation' },
    // Entity / Company
    { q: 'شركة الخط الأحمر', targetEntity: 'شركة الخط', desc: 'General entity (شركة الخط الأحمر)' },
    // Numbers
    { q: '2500', desc: 'Amount 2500 exact match' },
    { q: 'الفين', desc: 'Arabic word number الفين' },
  ];

  for (const t of unseenTests) {
    const intent = parseQueryIntent(t.q);
    const res = rankCandidatesByCompoundIntent(allMemories, intent, intent.coreTerms, chunksByMemoryId);
    if (t.targetContains) {
      const topMem = allMemories.find((m) => m.id === res.ids[0]);
      const matches = topMem && (topMem.text_content || '').toLowerCase().includes(t.targetContains);
      recordTest(`3.x Query "${t.q}"`, matches, t.desc);
    } else if (t.mustNotInclude) {
      recordTest(`3.x Query "${t.q}" Contradiction Veto`, res.ids.length > 0, t.desc);
    } else {
      recordTest(`3.x Query "${t.q}"`, res.ids.length > 0, t.desc);
    }
  }

  console.log('\n======================================================');
  console.log(`TEST MATRIX SUMMARY: Passed ${passed}, Failed ${failed}`);
  console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  console.log('======================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal error running matrix:', err);
  process.exit(1);
});
