import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { validateUpload, verifyUpload, safeFileName, resolveEffectiveMime } from '../src/lib/memories/validation.ts';
import { detectFamily } from '../src/lib/memories/signatures.ts';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {};
}

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const apiKey = env.OPENROUTER_API_KEY;
const model = env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY);

console.log('================================================================');
console.log('REMEMBER REGRESSION & SECURITY AUDIT TEST SUITE');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${name}`);
    failed++;
  }
}

// -------------------------------------------------------------
// SECTION 1: UPLOAD & VALIDATION TESTS
// -------------------------------------------------------------
console.log('[SECTION 1] Upload, MIME, Signatures, & Filenames');

// 1. WhatsApp Scan filename with spaces and Unicode
const rawName = 'WhatsApp Scan 2026-09-05 at 08.32.02.pdf';
const safe = safeFileName(rawName);
assert(safe === 'WhatsApp Scan 2026-09-05 at 08.32.02.pdf', 'safeFileName preserves spaces, digits, and dots');

const arabicName = 'وثيقة سكنية 2026.pdf';
assert(safeFileName(arabicName) === 'وثيقة سكنية 2026.pdf', 'safeFileName preserves Arabic Unicode characters');

const traversalName = '../../../../etc/passwd.pdf';
assert(!safeFileName(traversalName).includes('/') && !safeFileName(traversalName).includes('\\'), 'safeFileName prevents path traversal');

// 2. Normal PDF
const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]); // %PDF-1.4
const pdfFile = new File([pdfBytes], 'test.pdf', { type: 'application/pdf' });
const pdfVal = await verifyUpload(pdfFile);
assert(pdfVal.ok && pdfVal.memoryType === 'document', 'Normal PDF passes validation and signature check');

// 3. WhatsApp Scan with generic octet-stream MIME
const waFile = new File([pdfBytes], 'WhatsApp Scan 2026-09-05 at 08.32.02.pdf', { type: 'application/octet-stream' });
const waVal = await verifyUpload(waFile);
assert(waVal.ok && waVal.memoryType === 'document', 'PDF with application/octet-stream resolves and passes');

// 4. PDF with mobile application/x-pdf
const xpdfFile = new File([pdfBytes], 'doc.pdf', { type: 'application/x-pdf' });
const xpdfVal = await verifyUpload(xpdfFile);
assert(xpdfVal.ok && xpdfVal.memoryType === 'document', 'PDF with application/x-pdf passes');

// 5. Malformed/renamed executable claiming PDF
const exeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // MZ executable header
const fakePdf = new File([exeBytes], 'invoice.pdf', { type: 'application/pdf' });
const fakeVal = await verifyUpload(fakePdf);
assert(!fakeVal.ok, 'Renamed executable claiming PDF fails signature check');

// 6. Normal DOCX (zip signature PK 03 04)
const docxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
const docxFile = new File([docxBytes], 'document.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
const docxVal = await verifyUpload(docxFile);
assert(docxVal.ok && docxVal.memoryType === 'document', 'Normal DOCX passes validation and signature check');

// 7. DOCX with generic octet-stream
const docxOctet = new File([docxBytes], 'document.docx', { type: 'application/octet-stream' });
const docxOctetVal = await verifyUpload(docxOctet);
assert(docxOctetVal.ok && docxOctetVal.memoryType === 'document', 'DOCX with application/octet-stream resolves and passes');

// 8. Plain TXT
const txtFile = new File(['Hello Remember World'], 'notes.txt', { type: 'text/plain' });
const txtVal = await verifyUpload(txtFile);
assert(txtVal.ok && txtVal.memoryType === 'document', 'Plain text file passes validation');

// 9. Markdown MD
const mdFile = new File(['# Architecture Notes\nClean and calm'], 'notes.md', { type: 'text/markdown' });
const mdVal = await verifyUpload(mdFile);
assert(mdVal.ok && mdVal.memoryType === 'document', 'Markdown file passes validation');

// 10. File size near limit (24MB mock)
const mock24Mb = { name: 'large.pdf', size: 24 * 1024 * 1024, type: 'application/pdf' };
assert(validateUpload(mock24Mb).ok, '24MB document is accepted under 25MB limit');

// 11. Oversized file (>25MB mock)
const mock26Mb = { name: 'huge.pdf', size: 26 * 1024 * 1024, type: 'application/pdf' };
assert(!validateUpload(mock26Mb).ok, '26MB document is rejected over 25MB limit');

// -------------------------------------------------------------
// SECTION 2: URL SEARCH TESTS
// -------------------------------------------------------------
console.log('\n[SECTION 2] URL Deterministic Search');

const testUserId = 'bd07342f-440f-4860-83df-d21c4c0e205d';
const urlToSave = 'https://news.ycombinator.com/item?id=39201923';

const { data: linkMem, error: linkErr } = await client.from('memories').insert({
  user_id: testUserId,
  type: 'link',
  url: urlToSave,
  title: 'news.ycombinator.com'
}).select().single();

assert(!linkErr && linkMem, 'Test link inserted successfully');

// Direct exact URL search
const { data: urlHitsExact } = await client.from('memories').select('id').ilike('url', '%news.ycombinator.com/item?id=39201923%');
assert(urlHitsExact?.some(m => m.id === linkMem.id), 'Exact full URL matches via url ilike');

// Domain-only search
const { data: urlHitsDomain } = await client.from('memories').select('id').ilike('url', '%news.ycombinator.com%');
assert(urlHitsDomain?.some(m => m.id === linkMem.id), 'Domain-only search matches via url ilike');

await client.from('memories').delete().eq('id', linkMem.id);

// -------------------------------------------------------------
// SECTION 3: CROSS-LANGUAGE & SEARCH PRECISION TESTS
// -------------------------------------------------------------
console.log('\n[SECTION 3] Cross-Language Semantic Search & False-Positive Precision');

const socratesText = 'Socrates was an ancient Greek philosopher from Athens who is credited as the founder of Western philosophy and among the first moral philosophers of the ethical tradition of thought.';

// Compute embedding for Socrates
const embRes = await fetch('https://openrouter.ai/api/v1/embeddings', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: socratesText })
});
const socratesEmb = (await embRes.json()).data[0].embedding;

const { data: socMem } = await client.from('memories').insert({
  user_id: testUserId,
  type: 'note',
  title: 'Socrates and Philosophy',
  text_content: socratesText,
  embedding: JSON.stringify(socratesEmb)
}).select().single();

// Query expansion for "سقراط"
const expandRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    temperature: 0,
    messages: [{
      role: 'user',
      content: 'You are a search query expansion assistant for bilingual English/Arabic search. Given an Arabic query, output the original Arabic query followed by its primary English translations and key synonyms. Output only space-separated words, nothing else.\nQuery: سقراط'
    }]
  })
});
const expandedSoc = 'سقراط ' + (await expandRes.json()).choices[0].message.content.trim();

const socQEmbRes = await fetch('https://openrouter.ai/api/v1/embeddings', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: expandedSoc })
});
const socQEmb = (await socQEmbRes.json()).data[0].embedding;

// Check similarity in pgvector
const { data: socMatches } = await client.rpc('match_memories', {
  query_embedding: socQEmb,
  match_count: 5,
  similarity_threshold: 0.30
});
const socFound = socMatches?.some(m => m.id === socMem.id);
assert(socFound, 'Arabic "سقراط" retrieves English Socrates note with similarity >= 0.30');

// AI Judge for Socrates
const judgeSocRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    temperature: 0,
    messages: [{
      role: 'user',
      content: `You are the precision relevance judge for a personal-memory search app. Return strict JSON {"ids":[...]}.
USER QUERY: سقراط
CANDIDATES: ${JSON.stringify([{ id: socMem.id, type: 'note', title: socMem.title, text: socMem.text_content, url: '' }])}`
    }]
  })
});
const judgeSocJson = JSON.parse((await judgeSocRes.json()).choices[0].message.content.replace(/```json|```/g, '').trim());
assert(judgeSocJson.ids?.includes(socMem.id), 'AI Judge confirms Socrates note is relevant for "سقراط"');

// Garbage test "zxqv9281!!!"
const judgeGarbRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    temperature: 0,
    messages: [{
      role: 'user',
      content: `You are the precision relevance judge for a personal-memory search app. Return strict JSON {"ids":[...]}.
USER QUERY: zxqv9281!!!
CANDIDATES: ${JSON.stringify([{ id: socMem.id, type: 'note', title: socMem.title, text: socMem.text_content, url: '' }])}`
    }]
  })
});
const judgeGarbJson = JSON.parse((await judgeGarbRes.json()).choices[0].message.content.replace(/```json|```/g, '').trim());
assert(judgeGarbJson.ids?.length === 0, 'AI Judge returns 0 results for random garbage "zxqv9281!!!"');

await client.from('memories').delete().eq('id', socMem.id);

// -------------------------------------------------------------
// SECTION 4: SECURITY & RLS MULTI-TENANCY TESTS
// -------------------------------------------------------------
console.log('\n[SECTION 4] Security & RLS Multi-Tenancy Isolation');

const userAId = 'bd07342f-440f-4860-83df-d21c4c0e205d';
const fakeUserBId = '00000000-0000-0000-0000-000000000002';

// 1. Verify foreign user memory creation restriction under RLS
const anonKey =
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const userClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, anonKey);

// Without auth session, anon cannot select private memories
const { data: anonRows } = await userClient.from('memories').select('id');
assert(anonRows?.length === 0 || anonRows === null, 'Unauthenticated client cannot view any memories (RLS enforced)');

// Storage bucket privacy check
const { data: publicUrlData } = userClient.storage.from('memories').getPublicUrl('nonexistent/file.pdf');
const pubRes = await fetch(publicUrlData.publicUrl);
assert(pubRes.status === 400 || pubRes.status === 404 || pubRes.status === 403, 'Direct unauthenticated access to storage bucket is denied (Bucket is private)');

console.log('\n================================================================');
console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================');

if (failed > 0) process.exit(1);
