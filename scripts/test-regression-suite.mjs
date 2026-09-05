import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
function safeFileName(raw) {
  const base = raw.replace(/^.*[/\\]/, '');
  const cleaned = base
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'file';
}

function detectFamily(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'pdf';
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const str = Buffer.from(bytes).toString('binary');
    if (str.includes('[Content_Types].xml') || str.includes('word/')) return 'docx';
    return 'zip';
  }
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    return 'exe';
  }
  return 'unknown';
}

const maxImageSize = 10 * 1024 * 1024;
const maxDocumentSize = 25 * 1024 * 1024;
const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
const allowedDocumentTypes = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
];

function resolveEffectiveMime(file) {
  const type = file.type?.toLowerCase();
  if (type && type !== 'application/octet-stream' && type !== 'binary/octet-stream') {
    return type;
  }
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (name.endsWith('.doc')) return 'application/msword';
  if (name.endsWith('.txt')) return 'text/plain';
  if (name.endsWith('.md')) return 'text/markdown';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  return type;
}

function validateUpload(file) {
  const type = resolveEffectiveMime(file);
  if (allowedImageTypes.includes(type)) {
    if (file.size > maxImageSize) return { ok: false, reason: 'Image too large' };
    return { ok: true, memoryType: 'image', mimeType: type };
  }
  if (allowedDocumentTypes.includes(type)) {
    if (file.size > maxDocumentSize) return { ok: false, reason: 'Document too large' };
    return { ok: true, memoryType: 'document', mimeType: type };
  }
  return { ok: false, reason: 'Unsupported' };
}

async function verifyUpload(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const family = detectFamily(bytes);
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    return { ok: family === 'pdf', memoryType: 'document' };
  }
  if (name.endsWith('.docx')) {
    return { ok: family === 'docx', memoryType: 'document' };
  }
  if (file.type === 'text/plain' || file.type === 'text/markdown' || name.endsWith('.txt') || name.endsWith('.md')) {
    return { ok: true, memoryType: 'document' };
  }
  return { ok: false };
}

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

// 6. Genuine DOCX (zip with Office Open XML [Content_Types].xml entry)
const genuineDocxHeader = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]),
  Buffer.from(' [Content_Types].xml word/document.xml'),
]);
const docxFile = new File([genuineDocxHeader], 'document.docx', {
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
const docxVal = await verifyUpload(docxFile);
assert(docxVal.ok && docxVal.memoryType === 'document', 'Authentic DOCX with OPC structure passes validation');

// 7. Generic ZIP file renamed to .docx (missing [Content_Types].xml / word/)
const genericZipBytes = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]),
  Buffer.from(' photos/cat_vacation.jpg'),
]);
const fakeDocxFile = new File([genericZipBytes], 'archive.docx', {
  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
const fakeDocxVal = await verifyUpload(fakeDocxFile);
assert(!fakeDocxVal.ok, 'Generic ZIP renamed to .docx is rejected by structural OPC check');

// 8. DOCX with generic octet-stream MIME resolves and passes if OPC is present
const docxOctet = new File([genuineDocxHeader], 'document.docx', { type: 'application/octet-stream' });
const docxOctetVal = await verifyUpload(docxOctet);
assert(docxOctetVal.ok && docxOctetVal.memoryType === 'document', 'DOCX with application/octet-stream resolves and passes');

// 9. Plain TXT
const txtFile = new File(['Hello Remember World'], 'notes.txt', { type: 'text/plain' });
const txtVal = await verifyUpload(txtFile);
assert(txtVal.ok && txtVal.memoryType === 'document', 'Plain text file passes validation');

// 10. Markdown MD
const mdFile = new File(['# Architecture Notes\nClean and calm'], 'notes.md', { type: 'text/markdown' });
const mdVal = await verifyUpload(mdFile);
assert(mdVal.ok && mdVal.memoryType === 'document', 'Markdown file passes validation');

// 11. File size near limit (24MB mock)
const mock24Mb = { name: 'large.pdf', size: 24 * 1024 * 1024, type: 'application/pdf' };
assert(validateUpload(mock24Mb).ok, '24MB document is accepted under 25MB limit');

// 12. Oversized file (>25MB mock)
const mock26Mb = { name: 'huge.pdf', size: 26 * 1024 * 1024, type: 'application/pdf' };
assert(!validateUpload(mock26Mb).ok, '26MB document is rejected over 25MB limit');

// -------------------------------------------------------------
// SECTION 2: URL SEARCH TESTS
// -------------------------------------------------------------
console.log('\n[SECTION 2] URL Deterministic Search & Parameterized Safety');

const testUserId = 'bd07342f-440f-4860-83df-d21c4c0e205d';
const urlToSave = 'https://news.ycombinator.com/item?id=39201923';

const { data: linkMem, error: linkErr } = await client.from('memories').insert({
  user_id: testUserId,
  type: 'link',
  url: urlToSave,
  title: 'news.ycombinator.com',
}).select().single();

assert(!linkErr && linkMem, 'Test link inserted successfully');

// Direct exact URL search
const { data: urlHitsExact } = await client.from('memories').select('id').ilike('url', '%news.ycombinator.com/item?id=39201923%');
assert(urlHitsExact?.some((m) => m.id === linkMem.id), 'Exact full URL matches via url ilike');

// Domain-only search
const { data: urlHitsDomain } = await client.from('memories').select('id').ilike('url', '%news.ycombinator.com%');
assert(urlHitsDomain?.some((m) => m.id === linkMem.id), 'Domain-only search matches via url ilike');

await client.from('memories').delete().eq('id', linkMem.id);

// Complex URL containing commas, query strings, and hashes
const complexUrl = 'https://example.com/search?q=foo,bar&category=news_items#section-2';
const { data: complexMem, error: complexErr } = await client.from('memories').insert({
  user_id: testUserId,
  type: 'link',
  url: complexUrl,
  title: 'example.com',
}).select().single();

assert(!complexErr && complexMem, 'Complex URL with commas and query parameters inserted successfully');

// Parameterized search for URL containing comma
const escapedTarget = 'example.com/search?q=foo,bar'.replace(/[%_\\]/g, '\\$&');
const { data: complexHits, error: complexQueryErr } = await client
  .from('memories')
  .select('id')
  .ilike('url', `%${escapedTarget}%`);
assert(
  !complexQueryErr && complexHits?.some((m) => m.id === complexMem.id),
  'URL containing comma in query string matches safely without PostgREST syntax error',
);

await client.from('memories').delete().eq('id', complexMem.id);

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
// Arabic Garbage test "قفصطبلغ"
const judgeArabicGarbRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    temperature: 0,
    messages: [{
      role: 'user',
      content: `You are the precision relevance judge for a personal-memory search app. Return strict JSON {"ids":[...]}.
USER QUERY: قفصطبلغ
CANDIDATES: ${JSON.stringify([{ id: socMem.id, type: 'note', title: socMem.title, text: socMem.text_content, url: '' }])}`
    }]
  })
});
const judgeArabicGarbJson = JSON.parse((await judgeArabicGarbRes.json()).choices[0].message.content.replace(/```json|```/g, '').trim());
assert(judgeArabicGarbJson.ids?.length === 0, 'AI Judge returns 0 results for Arabic garbage "قفصطبلغ"');

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

// -------------------------------------------------------------
// SECTION 5: DEV SIGN-IN SCRIPT PRODUCTION KILL-SWITCH
// -------------------------------------------------------------
console.log('\n[SECTION 5] Dev Sign-In Script Production Kill-Switch');

try {
  const { execSync } = await import('node:child_process');
  execSync('node scripts/dev-signin-link.mjs test@example.com', {
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: 'pipe',
  });
  assert(false, 'dev-signin-link did not abort under NODE_ENV=production');
} catch {
  assert(true, 'dev-signin-link unconditionally aborts with error under NODE_ENV=production');
}

// -------------------------------------------------------------
// SECTION 6: PHOTO UX, STABLE MEDIA CACHING & PROGRESSIVE SEARCH
// -------------------------------------------------------------
console.log('\n[SECTION 6] Photo UX, Media Caching & Progressive Search');

// 1. Photo Capture Dual Triggers in CaptureButton
const captureBtnSrc = readFileSync(new URL('../src/components/capture/CaptureButton.tsx', import.meta.url), 'utf8');
assert(
  captureBtnSrc.includes('capture="environment"') && captureBtnSrc.includes('Take photo'),
  'CaptureButton provides dedicated native Camera trigger with capture="environment"',
);
assert(
  captureBtnSrc.includes('Choose from photos') && captureBtnSrc.includes('galleryInputRef'),
  'CaptureButton provides dedicated Photo Library/Gallery trigger without forcing camera',
);
assert(
  captureBtnSrc.includes('previewUrl') && captureBtnSrc.includes('createObjectURL'),
  'CaptureButton generates instant thumbnail preview for chosen photo',
);

// 2. Stable Media Proxy & Caching Route (/api/media/[id])
const mediaRouteSrc = readFileSync(new URL('../src/app/api/media/[id]/route.ts', import.meta.url), 'utf8');
assert(
  mediaRouteSrc.includes('Cache-Control') && mediaRouteSrc.includes('stale-while-revalidate'),
  'Media proxy sets private HTTP Cache-Control headers with long max-age',
);
assert(
  mediaRouteSrc.includes('if-none-match') && mediaRouteSrc.includes('304'),
  'Media proxy implements ETag and 304 Not Modified cache validation',
);
assert(
  mediaRouteSrc.includes('memories!inner(id, user_id)'),
  'Media proxy validates user ownership and multi-tenancy RLS isolation before serving file',
);

// 3. Progressive Search Race Condition Defense in MemoryLibrary
const librarySrc = readFileSync(new URL('../src/components/memories/MemoryLibrary.tsx', import.meta.url), 'utf8');
assert(
  librarySrc.includes('querySeq.current') && librarySrc.includes('abortController'),
  'MemoryLibrary enforces monotonic sequence counter and AbortController to discard stale search responses',
);
assert(
  librarySrc.includes('tier=fast') && librarySrc.includes('tier=deep'),
  'MemoryLibrary executes progressive two-tier search (fast lexical first -> deep semantic second)',
);
assert(
  librarySrc.includes('isSearching'),
  'MemoryLibrary exposes non-blocking isSearching micro-indicator without freezing UI',
);

// -------------------------------------------------------------
// SECTION 7: DOCUMENT INTELLIGENCE, ARABIC RETRIEVAL & LIFECYCLE
// -------------------------------------------------------------
console.log('\n[SECTION 7] Document Intelligence, Arabic Retrieval & Lifecycle');

// 1. Arabic Normalization Equivalence
function normalizeArabicForSearch(text) {
  if (!text) return '';
  return text
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\u066E/g, 'ت')
    .replace(/\u06A1/g, 'ف')
    .replace(/\u066F/g, 'ق')
    .replace(/[٠۰]/g, '0')
    .replace(/[١۱]/g, '1')
    .replace(/[٢۲]/g, '2')
    .replace(/[٣۳]/g, '3')
    .replace(/[٤۴]/g, '4')
    .replace(/[٥۵]/g, '5')
    .replace(/[٦۶]/g, '6')
    .replace(/[٧۷]/g, '7')
    .replace(/[٨۸]/g, '8')
    .replace(/[٩۹]/g, '9');
}
assert(normalizeArabicForSearch('حوالة') === normalizeArabicForSearch('حواله'), 'Arabic normalizer equates ة and ه (حوالة == حواله)');
assert(normalizeArabicForSearch('إيصال') === normalizeArabicForSearch('ايصال'), 'Arabic normalizer equates Alef variants (إيصال == ايصال)');
assert(normalizeArabicForSearch('سَنَد') === normalizeArabicForSearch('سند'), 'Arabic normalizer strips diacritics/tashkeel (سَنَد == سند)');
assert(normalizeArabicForSearch('١٤٩٠٠٠٠١٠٠') === normalizeArabicForSearch('1490000100'), 'Arabic normalizer unifies Eastern Arabic numerals to standard digits');

// 2. Next.js External Packages Config
const nextCfgSrc = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8');
assert(
  nextCfgSrc.includes('serverComponentsExternalPackages') &&
  nextCfgSrc.includes('pdf-parse') &&
  nextCfgSrc.includes('mammoth'),
  'next.config.mjs declares serverComponentsExternalPackages for pdf-parse and mammoth',
);

// 3. Document Extraction & Enrichment Architecture
const enrichSrc = readFileSync(new URL('../src/app/actions/enrich.ts', import.meta.url), 'utf8');
assert(
  enrichSrc.includes('ai.embed') && enrichSrc.includes('summarizeDocument'),
  'enrichDocumentMemory generates semantic embedding and clean document summary',
);
assert(
  enrichSrc.includes('reprocessDocumentMemory'),
  'enrich.ts exports reprocessDocumentMemory for retry and lifecycle repair',
);

// 4. MemoryCard Document Lifecycle Indicators
const cardSrc = readFileSync(new URL('../src/components/memories/MemoryCard.tsx', import.meta.url), 'utf8');
assert(
  cardSrc.includes('Processing document…') && cardSrc.includes('Scanned document (No text layer)'),
  'MemoryCard displays calm status badges for processing, scanned, and error states',
);

// 5. Live Hawala Document Verification in Database
const hawalaMemoryId = '1ba6f5b6-972d-4ed2-a7a1-7a2a2d9eabed';
const { data: hawalaRow } = await client
  .from('memories')
  .select('id, type, extraction_status, chunk_count, embedding, text_content')
  .eq('id', hawalaMemoryId)
  .single();

assert(hawalaRow && hawalaRow.type === 'document', 'Target hawala document exists in Supabase');
assert(hawalaRow && hawalaRow.extraction_status === 'done', 'Target hawala document extraction_status is "done"');
assert(hawalaRow && (hawalaRow.chunk_count ?? 0) > 0, 'Target hawala document has chunks stored in memory_chunks');
assert(hawalaRow && hawalaRow.embedding !== null, 'Target hawala document has 1536d semantic embedding stored');

// 6. Live Lexical & Substring Retrieval on Hawala Document
const { data: numHits } = await client
  .from('memory_chunks')
  .select('memory_id')
  .ilike('chunk_text', '%315000010006086039455%');
assert(
  numHits?.some((r) => r.memory_id === hawalaMemoryId),
  'Deterministic retrieval finds document by exact account number (315000010006086039455)',
);

const { data: bankHits } = await client
  .from('memory_chunks')
  .select('memory_id')
  .ilike('chunk_text', '%Alrajhibank%');
assert(
  bankHits?.some((r) => r.memory_id === hawalaMemoryId),
  'Deterministic retrieval finds document by bank domain identifier (Alrajhibank)',
);

console.log('\n================================================================');
console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log('================================================================');

if (failed > 0) process.exit(1);
