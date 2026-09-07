import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { extractDocument } from '../src/lib/documents/extract.ts';
import { chunkDocument } from '../src/lib/documents/chunking.ts';
import { PARSER_VERSION } from '../src/lib/documents/identity.ts';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class DummyWebSocket {};
}

const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
  auth: { persistSession: false },
});

async function reprocess(memoryId, title) {
  console.log(`\n======================================================`);
  console.log(`Reprocessing: "${title}" (${memoryId})`);
  console.log(`======================================================`);

  const { data: mem, error: memErr } = await admin
    .from('memories')
    .select('*, memory_files(*)')
    .eq('id', memoryId)
    .single();

  if (memErr || !mem || !mem.memory_files || mem.memory_files.length === 0) {
    console.error('Failed to fetch memory or files:', memErr);
    return;
  }

  const file = mem.memory_files[0];
  console.log('Downloading storage path:', file.storage_path);
  const { data: fileData, error: dlErr } = await admin.storage
    .from('memories')
    .download(file.storage_path);

  if (dlErr || !fileData) {
    console.error('Failed to download file:', dlErr);
    return;
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());
  console.log('Downloaded bytes:', buffer.length);

  console.log('Running extractDocument with Scanned PDF OCR & Reverse Arabic support...');
  const extracted = await extractDocument(buffer, file.file_type || 'application/pdf', file.file_name);
  console.log('Extracted rawText length:', extracted.rawText.length);
  console.log('Pages count:', extracted.pages ? extracted.pages.length : 0);
  console.log('Error reason (if any):', extracted.errorReason || 'None');

  if (!extracted.rawText.trim()) {
    console.warn('Warning: extracted text is empty!');
    return;
  }

  const chunks = chunkDocument(extracted);
  console.log(`Generated ${chunks.length} structured chunks.`);

  // Delete old chunks
  const { error: delErr } = await admin.from('memory_chunks').delete().eq('memory_id', memoryId);
  if (delErr) console.warn('Delete chunks note:', delErr.message);

  // Insert new chunks
  if (chunks.length > 0) {
    const chunkRows = chunks.map((c) => ({
      memory_id: memoryId,
      user_id: mem.user_id,
      chunk_index: c.chunkIndex,
      page_number: c.pageNumber ?? null,
      section_title: c.sectionTitle ?? null,
      chunk_text: c.chunkText,
      chunk_hash: c.chunkHash,
      word_count: c.wordCount,
    }));
    const { error: insErr } = await admin.from('memory_chunks').insert(chunkRows);
    if (insErr) {
      console.error('Failed to insert chunks:', insErr);
    } else {
      console.log(`Successfully inserted ${chunkRows.length} chunks into memory_chunks!`);
    }
  }

  // Preview for text_content
  const rawPreview = extracted.rawText.slice(0, 1000).trim();
  const updatePayload = {
    text_content: rawPreview,
    file_hash: extracted.fileHash,
    content_hash: extracted.contentHash,
    parser_version: PARSER_VERSION,
    chunk_count: chunks.length,
    extraction_status: 'done',
    extraction_error: null,
  };

  const { error: upErr } = await admin.from('memories').update(updatePayload).eq('id', memoryId);
  if (upErr) {
    console.error('Failed to update memory row:', upErr);
  } else {
    console.log('Memory row successfully updated to extraction_status = "done"!');
  }
}

async function main() {
  // 1. Reprocess ركن عمر.pdf
  await reprocess('cfa54223-c601-4947-9a34-cb65e741c101', 'ركن عمر.pdf');

  // 2. Reprocess WhatsApp Scan_ 2026-09-01 at 16.10.18.pdf
  await reprocess('10d81c5c-6120-4a0a-a7d9-5f59466108ce', 'WhatsApp Scan_ 2026-09-01 at 16.10.18.pdf');
  await reprocess('2f42e958-41d6-49d4-8568-3cdce272282f', 'WhatsApp Scan_ 2026-09-01 at 16.10.18.pdf');
}

main();
