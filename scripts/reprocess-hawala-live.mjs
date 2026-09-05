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

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY);

const memoryId = '1ba6f5b6-972d-4ed2-a7a1-7a2a2d9eabed';

// Fetch memory and file
const { data: memory } = await admin.from('memories').select('*').eq('id', memoryId).single();
const { data: file } = await admin.from('memory_files').select('*').eq('memory_id', memoryId).single();

console.log('Target document file:', file.file_name, 'storage_path:', file.storage_path);

// Download
const { data: fileData, error: dlErr } = await admin.storage
  .from('memories')
  .download(file.storage_path);

if (dlErr) {
  console.error('Download error:', dlErr);
  process.exit(1);
}

const buffer = Buffer.from(await fileData.arrayBuffer());
console.log('Downloaded buffer size:', buffer.length);

// Extract with our new parser logic
const { PDFParse } = await import('pdf-parse');
const parser = new PDFParse({ data: buffer });
const result = await parser.getText();

// Arabic normalization and augmentation
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

function normalizeExtractedText(raw) {
  return raw
    .normalize('NFKC')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function augmentArabicPdfText(text) {
  if (!text) return '';
  const hasArabic = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  if (!hasArabic) return text;

  const norm = normalizeArabicForSearch(text);
  const tokens = norm.split(/\s+/);
  const extraTokens = new Set();

  for (const token of tokens) {
    if (/[\u0600-\u06FF]/.test(token) && token.length > 2) {
      const looksReversed = /^ه/.test(token) || /ال$/.test(token) || /لل$/.test(token);
      if (looksReversed) {
        const rev = Array.from(token).reverse().join('');
        if (rev.length > 1) extraTokens.add(rev);
      }
      extraTokens.add(token);
    }
  }

  if (extraTokens.size > 0) {
    return `${text}\n\n${Array.from(extraTokens).join(' ')}`;
  }
  return text;
}

const cleaned = normalizeExtractedText(result.text);
const augmented = augmentArabicPdfText(cleaned);

console.log('Augmented text length:', augmented.length);
console.log('Sample augmented text:\n', augmented.slice(0, 400));

// Create chunks
const chunkSize = 800;
const chunkOverlap = 150;
const chunks = [];
let idx = 0;
let offset = 0;
while (offset < augmented.length) {
  const end = Math.min(offset + chunkSize, augmented.length);
  const text = augmented.slice(offset, end);
  chunks.push({
    memory_id: memoryId,
    user_id: memory.user_id,
    chunk_index: idx++,
    page_number: 1,
    chunk_text: text,
    chunk_hash: 'hash_' + idx,
    word_count: text.split(/\s+/).length,
  });
  if (end >= augmented.length) break;
  offset += chunkSize - chunkOverlap;
}

console.log(`Generated ${chunks.length} chunks.`);

// Insert chunks
await admin.from('memory_chunks').delete().eq('memory_id', memoryId);
const { error: insErr } = await admin.from('memory_chunks').insert(chunks);
if (insErr) {
  console.error('Insert chunks error:', insErr);
} else {
  console.log('Successfully inserted memory_chunks!');
}

// Compute embedding via OpenRouter
let embeddingJson = null;
if (env.OPENROUTER_API_KEY) {
  console.log('Computing semantic embedding via OpenRouter...');
  const textToEmbed = [file.file_name, augmented.slice(0, 2000)].filter(Boolean).join('\n\n');
  const embedRes = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'openai/text-embedding-3-small',
      input: textToEmbed,
    }),
  });
  if (embedRes.ok) {
    const json = await embedRes.json();
    embeddingJson = JSON.stringify(json.data[0].embedding);
    console.log('Embedding computed! Length:', json.data[0].embedding.length);
  } else {
    console.error('Embedding error:', await embedRes.text());
  }
}

// Update memories record
const updatePayload = {
  text_content: augmented.slice(0, 800),
  chunk_count: chunks.length,
  extraction_status: 'done',
  extraction_error: null,
};
if (embeddingJson) {
  updatePayload.embedding = embeddingJson;
}

const { error: upErr } = await admin.from('memories').update(updatePayload).eq('id', memoryId);
if (upErr) {
  console.error('Update memories error:', upErr);
} else {
  console.log('Successfully updated memory record with extraction_status: done!');
}

console.log('\n=== VERIFYING SEARCH ON REPROCESSED HAWALA DOCUMENT ===');

// Test 1: Lexical query for account number 315000010006086039455
const { data: q1 } = await admin
  .from('memory_chunks')
  .select('memory_id')
  .ilike('chunk_text', '%315000010006086039455%');
console.log('Search "315000010006086039455":', q1?.length > 0 ? 'FOUND' : 'NOT FOUND');

// Test 2: Lexical query for Alrajhibank
const { data: q2 } = await admin
  .from('memory_chunks')
  .select('memory_id')
  .ilike('chunk_text', '%Alrajhibank%');
console.log('Search "Alrajhibank":', q2?.length > 0 ? 'FOUND' : 'NOT FOUND');

// Test 3: Lexical query for Transfer Fees
const { data: q3 } = await admin
  .from('memory_chunks')
  .select('memory_id')
  .ilike('chunk_text', '%Transfer%');
console.log('Search "Transfer":', q3?.length > 0 ? 'FOUND' : 'NOT FOUND');

// Test 4: Semantic query using match_memories RPC
if (embeddingJson) {
  const qVecRes = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'openai/text-embedding-3-small',
      input: 'سند حوالة بنكية تحويل مالي',
    }),
  });
  const qVec = (await qVecRes.json()).data[0].embedding;

  // Let's test cosine similarity directly
  const docVec = JSON.parse(embeddingJson);
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < docVec.length; i++) {
    dot += docVec[i] * qVec[i];
    nA += docVec[i] * docVec[i];
    nB += qVec[i] * qVec[i];
  }
  const sim = dot / (Math.sqrt(nA) * Math.sqrt(nB));
  console.log('Cosine similarity with "سند حوالة بنكية تحويل مالي":', sim.toFixed(4));
}
