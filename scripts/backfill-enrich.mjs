/**
 * One-off backfill: enrich EXISTING image memories that were saved before AI
 * enrichment ran (or before the key was configured), so they become searchable.
 *
 * Mirrors the app's production enrichment path (src/app/actions/enrich.ts +
 * src/lib/ai/providers/openrouter.ts): for each image it mints a short-lived
 * signed URL, fetches the bytes, asks the vision model for a BILINGUAL
 * (English + Arabic) description and an OCR transcription, then folds both into
 * the memory's `text_content` (preserving any note the user already wrote).
 *
 * Safe & idempotent-ish: it only APPENDS model output that isn't already there.
 * By default it processes ONLY images with little/no text; pass `--all` to
 * re-enrich every image. Reads .env.local and never prints the API key.
 *
 * Run:  node scripts/backfill-enrich.mjs           # only under-enriched images
 *       node scripts/backfill-enrich.mjs --all      # every image
 */
import { readFileSync } from 'node:fs';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {
    constructor() {
      throw new Error('Realtime is not used by this script.');
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

const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const OR_KEY = env.OPENROUTER_API_KEY;
const OR_MODEL = env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const BUCKET = 'memories';
const PROCESS_ALL = process.argv.includes('--all');

if (!SUPA_URL || !SERVICE) {
  console.error('Missing Supabase url / service role key in .env.local.');
  process.exit(1);
}
if (!OR_KEY) {
  console.error('Missing OPENROUTER_API_KEY in .env.local — cannot enrich.');
  process.exit(1);
}

const admin = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false } });

// --- prompts (kept in sync with src/lib/ai/providers/openrouter.ts) ----
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

// --- OpenRouter helpers (same shape as the app provider) ---------------
async function toDataUrl(fileUrl) {
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`fetch image failed: ${res.status}`);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const base64 = Buffer.from(await res.arrayBuffer()).toString('base64');
  return `data:${contentType};base64,${base64}`;
}

async function askAboutImage(dataUrl, prompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OR_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
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
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() ?? '';
}

// --- load image memories ----------------------------------------------
const { data, error } = await admin
  .from('memories')
  .select('id, type, text_content, memory_files ( storage_path, file_name )')
  .eq('type', 'image')
  .order('created_at', { ascending: false });

if (error) {
  console.error('Query failed:', error.message);
  process.exit(2);
}

const images = data ?? [];
console.log(`Found ${images.length} image memories.`);

let enriched = 0;
let skipped = 0;
let failed = 0;

for (const mem of images) {
  const existing = (mem.text_content ?? '').trim();
  const file = mem.memory_files?.[0];

  if (!file?.storage_path) {
    console.log(`- ${mem.id}  SKIP (no file)`);
    skipped += 1;
    continue;
  }
  // By default only touch under-enriched images (a real description is long).
  if (!PROCESS_ALL && existing.length >= 40) {
    console.log(`- ${mem.id}  SKIP (already has ${existing.length} chars of text)`);
    skipped += 1;
    continue;
  }

  try {
    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(file.storage_path, 600);
    if (signErr || !signed?.signedUrl) throw new Error(signErr?.message || 'no signed url');

    const dataUrl = await toDataUrl(signed.signedUrl);

    const [descRes, ocrRes] = await Promise.allSettled([
      askAboutImage(dataUrl, DESCRIBE_PROMPT),
      askAboutImage(dataUrl, OCR_PROMPT),
    ]);
    const description = descRes.status === 'fulfilled' ? descRes.value.trim() : '';
    const ocrText = ocrRes.status === 'fulfilled' ? ocrRes.value.trim() : '';

    const parts = [existing, description, ocrText].filter(Boolean);
    const combined = Array.from(new Set(parts)).join('\n\n').trim();

    if (!combined || combined === existing) {
      console.log(`- ${mem.id}  no new text produced — left as-is`);
      skipped += 1;
      continue;
    }

    const { error: upErr } = await admin
      .from('memories')
      .update({ text_content: combined })
      .eq('id', mem.id);
    if (upErr) throw new Error(upErr.message);

    enriched += 1;
    const preview = combined.replace(/\s+/g, ' ').slice(0, 120);
    console.log(`- ${mem.id}  ENRICHED (${file.file_name}) -> "${preview}${combined.length > 120 ? '…' : ''}"`);
  } catch (e) {
    failed += 1;
    console.log(`- ${mem.id}  FAILED: ${e?.message || String(e)}`);
  }
}

console.log(`\nDone. enriched=${enriched} skipped=${skipped} failed=${failed}`);
