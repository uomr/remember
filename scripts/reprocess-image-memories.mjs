/**
 * Production Reprocess & Backfill Script for Image Memories.
 *
 * Reprocesses unenriched or failed image memories:
 *   - Downloads the original image directly from private Supabase Storage (zero HTTP self-fetch)
 *   - Runs multimodal vision understanding via OpenRouter (google/gemini-2.5-flash)
 *   - Generates 1536-dimensional semantic vector embedding (openai/text-embedding-3-small)
 *   - Updates text_content, embedding, extraction_status ('done' | 'failed'), extraction_error
 *   - Idempotent: safe to run multiple times.
 *
 * Usage:
 *   node scripts/reprocess-image-memories.mjs                              # all pending/unenriched/failed images
 *   node scripts/reprocess-image-memories.mjs --id <memory-id>            # specific memory
 *   node scripts/reprocess-image-memories.mjs --all                       # force reprocess every image
 */

import { readFileSync } from 'node:fs';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {
    constructor() {
      throw new Error('Realtime not needed for script');
    }
  };
}

const { createClient } = await import('@supabase/supabase-js');

// Load environment from .env.local
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE =
  env.SUPABASE_SECRET_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const OR_KEY = env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
const OR_MODEL = env.OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const OR_EMBEDDING_MODEL =
  env.OPENROUTER_EMBEDDING_MODEL ||
  process.env.OPENROUTER_EMBEDDING_MODEL ||
  'openai/text-embedding-3-small';
const STORAGE_BUCKET = 'memories';

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}
if (!OR_KEY) {
  console.error('Missing OPENROUTER_API_KEY in .env.local');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// Prompts identical to production openrouter.ts
const DESCRIBE_PROMPT =
  'Describe this image so a person can find it later by searching in EITHER ' +
  'English or Arabic. Write it in two short lines: first an English description, ' +
  'then an Arabic (العربية) description with the SAME meaning. Focus on concrete ' +
  'subjects, objects, colors, visible text, and any brand or product names; if it ' +
  'is a logo, say explicitly "logo / شعار". Then add a final line starting with ' +
  '"Keywords:" listing 5-10 search terms in BOTH English and Arabic. Return only ' +
  'that text, with no extra commentary.';

const OCR_PROMPT =
  'Extract ALL text visible in this image exactly as written, preserving reading ' +
  'order. Return only the transcribed text with no commentary. If there is no ' +
  'readable text, return an empty response.';

async function askOpenRouter(dataUrl, prompt, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OR_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/uomr/remember',
          'X-Title': 'Remember',
        },
        body: JSON.stringify({
          model: OR_MODEL,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`OpenRouter chat failed (${res.status}): ${detail.slice(0, 300)}`);
      }

      const json = await res.json();
      return json.choices?.[0]?.message?.content?.trim() ?? '';
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        console.warn(`  [RETRY] OpenRouter vision attempt ${attempt} failed (${err.message}). Retrying in 2s...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  throw lastErr;
}

async function getEmbedding(text) {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OR_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/uomr/remember',
      'X-Title': 'Remember',
    },
    body: JSON.stringify({
      model: OR_EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter embedding failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const json = await res.json();
  const vector = json.data?.[0]?.embedding;
  if (!vector || vector.length === 0) {
    throw new Error('Empty embedding returned');
  }
  return vector;
}

export async function reprocessMemory(memoryId) {
  console.log(`\nProcessing Memory: ${memoryId}`);

  // Fetch memory
  const { data: memory, error: memErr } = await admin
    .from('memories')
    .select('*, memory_files(*)')
    .eq('id', memoryId)
    .single();

  if (memErr || !memory) {
    console.error(`  [ERROR] Memory not found:`, memErr?.message);
    return { ok: false, error: memErr?.message || 'Memory not found' };
  }

  if (memory.type !== 'image') {
    console.log(`  [SKIP] Memory is not an image (type=${memory.type})`);
    return { ok: true, skipped: true };
  }

  const file = memory.memory_files?.[0];
  if (!file || !file.storage_path) {
    console.error(`  [ERROR] No file attachment found for image`);
    await admin
      .from('memories')
      .update({ extraction_status: 'failed', extraction_error: 'No file record found' })
      .eq('id', memoryId);
    return { ok: false, error: 'No file record found' };
  }

  // Set pending
  await admin.from('memories').update({ extraction_status: 'pending' }).eq('id', memoryId);

  // Download directly from Storage
  console.log(`  Downloading bytes from storage path: ${file.storage_path}...`);
  const { data: fileData, error: dlErr } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(file.storage_path);

  if (dlErr || !fileData) {
    const errMsg = dlErr?.message || 'Storage download failed';
    console.error(`  [ERROR] ${errMsg}`);
    await admin
      .from('memories')
      .update({ extraction_status: 'failed', extraction_error: errMsg })
      .eq('id', memoryId);
    return { ok: false, error: errMsg };
  }

  const arrayBuf = await fileData.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  console.log(`  Downloaded ${buffer.byteLength} bytes. Creating data URL...`);

  const mime = file.file_type || 'image/jpeg';
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;

  // Call OpenRouter
  console.log(`  Calling OpenRouter Vision (${OR_MODEL})...`);
  let description = '';
  let ocrText = '';
  try {
    const [descRes, ocrRes] = await Promise.allSettled([
      askOpenRouter(dataUrl, DESCRIBE_PROMPT),
      askOpenRouter(dataUrl, OCR_PROMPT),
    ]);
    description = descRes.status === 'fulfilled' ? descRes.value : '';
    ocrText = ocrRes.status === 'fulfilled' ? ocrRes.value : '';

    if (descRes.status === 'rejected') {
      console.warn(`  [WARN] Vision describe failed:`, descRes.reason);
    }
    if (ocrRes.status === 'rejected') {
      console.warn(`  [WARN] Vision OCR failed:`, ocrRes.reason);
    }
  } catch (visionErr) {
    const errMsg = visionErr instanceof Error ? visionErr.message : String(visionErr);
    console.error(`  [ERROR] Vision API call failed: ${errMsg}`);
    await admin
      .from('memories')
      .update({ extraction_status: 'failed', extraction_error: errMsg })
      .eq('id', memoryId);
    return { ok: false, error: errMsg };
  }

  console.log(`  Vision Result Description: ${description ? description.slice(0, 100) + '...' : '(none)'}`);
  console.log(`  Vision Result OCR: ${ocrText ? ocrText.slice(0, 80) + '...' : '(none)'}`);

  const userNote = memory.text_content?.trim() ?? '';
  const parts = [userNote, description, ocrText].filter(Boolean);
  const combined = Array.from(new Set(parts)).join('\n\n').trim();
  const searchText = combined || userNote;

  if (!searchText) {
    console.warn(`  [WARN] No text could be extracted or described for image.`);
    await admin
      .from('memories')
      .update({ extraction_status: 'failed', extraction_error: 'No text or description generated' })
      .eq('id', memoryId);
    return { ok: false, error: 'No text or description generated' };
  }

  // Generate vector embedding
  console.log(`  Generating 1536-dim embedding (${OR_EMBEDDING_MODEL})...`);
  let vector = null;
  try {
    vector = await getEmbedding(searchText);
    console.log(`  Embedding generated successfully (${vector.length} floats).`);
  } catch (embErr) {
    console.warn(`  [WARN] Embedding failed:`, embErr.message);
  }

  const updatePayload = {
    text_content: searchText,
    extraction_status: 'done',
    extraction_error: null,
  };
  if (vector && vector.length > 0) {
    updatePayload.embedding = JSON.stringify(vector);
  }

  const { error: updateErr } = await admin
    .from('memories')
    .update(updatePayload)
    .eq('id', memoryId);

  if (updateErr) {
    console.error(`  [ERROR] Database update failed:`, updateErr.message);
    await admin
      .from('memories')
      .update({ extraction_status: 'failed', extraction_error: updateErr.message })
      .eq('id', memoryId);
    return { ok: false, error: updateErr.message };
  }

  console.log(`  ✅ Memory ${memoryId} successfully enriched!`);
  return { ok: true, memoryId, description, hasEmbedding: Boolean(vector) };
}

async function main() {
  const specificIdIndex = process.argv.indexOf('--id');
  const forceAll = process.argv.includes('--all');

  if (specificIdIndex !== -1 && process.argv[specificIdIndex + 1]) {
    const targetId = process.argv[specificIdIndex + 1];
    console.log(`Targeting specific memory: ${targetId}`);
    const result = await reprocessMemory(targetId);
    process.exit(result.ok ? 0 : 1);
  }

  console.log('Querying image memories requiring enrichment...');
  const { data: images, error } = await admin
    .from('memories')
    .select('id, title, text_content, embedding, extraction_status, created_at')
    .eq('type', 'image')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to query image memories:', error.message);
    process.exit(1);
  }

  console.log(`Total image memories in database: ${images.length}`);
  const candidates = images.filter((img) => {
    if (forceAll) return true;
    const missingText = !img.text_content || img.text_content.trim().length === 0;
    const missingEmbedding = !img.embedding;
    const isFailed = img.extraction_status === 'failed';
    return missingText || missingEmbedding || isFailed;
  });

  console.log(`Images needing reprocessing: ${candidates.length}`);
  for (const c of candidates) {
    console.log(`- ${c.id} (${c.title}): status=${c.extraction_status}, text=${Boolean(c.text_content)}, emb=${Boolean(c.embedding)}`);
  }

  let successCount = 0;
  let failCount = 0;

  for (const c of candidates) {
    const res = await reprocessMemory(c.id);
    if (res.ok) successCount++;
    else failCount++;
  }

  console.log(`\n================ SUMMARY ================`);
  console.log(`Reprocessed: ${successCount} succeeded, ${failCount} failed.`);
  process.exit(failCount === 0 ? 0 : 2);
}

if (process.argv[1]?.endsWith('reprocess-image-memories.mjs')) {
  main();
}
