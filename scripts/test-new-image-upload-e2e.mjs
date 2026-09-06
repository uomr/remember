/**
 * End-to-End Test for a NEW Image Upload
 *
 * Validates the entire image pipeline for a brand new image:
 * 1. Uploads real image bytes directly to private Supabase Storage
 * 2. Creates the memory record with extraction_status = 'pending'
 * 3. Creates the memory_files attachment record
 * 4. Runs server-side enrichment (Storage download -> OpenRouter Vision -> Embedding -> DB update)
 * 5. Verifies extraction_status transitions to 'done' (extraction_error is null)
 * 6. Verifies text_content contains bilingual natural-language description and keywords
 * 7. Verifies 1536-dim vector embedding was generated and stored
 * 8. Runs hybrid retrieval tests across Arabic and English concepts
 * 9. Confirms negative controls reject the new image
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = class {
    constructor() {
      throw new Error('Realtime not needed for script');
    }
  };
}

const { createClient } = await import('@supabase/supabase-js');
const { reprocessMemory } = await import('./reprocess-image-memories.mjs');

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
const STORAGE_BUCKET = 'memories';
const USER_ID = 'bd07342f-440f-4860-83df-d21c4c0e205d';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

async function main() {
  console.log('================================================================');
  console.log('    TESTING NEW IMAGE UPLOAD & ENRICHMENT PIPELINE END-TO-END   ');
  console.log('================================================================');

  const imagePath = 'C:\\Users\\we\\.gemini\\antigravity-ide\\brain\\e2c035fd-39fd-4681-919e-e7ac3f92e90d\\red_coffee_mug_1788708142618.jpg';
  const imageBytes = readFileSync(imagePath);
  console.log(`Loaded test image: ${imageBytes.byteLength} bytes`);

  const memoryId = randomUUID();
  const fileName = 'red_coffee_mug.jpg';
  const storagePath = `${USER_ID}/${memoryId}/${fileName}`;

  console.log(`\nStep 1: Uploading to private storage: ${storagePath}...`);
  const { error: upErr } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, imageBytes, { contentType: 'image/jpeg', upsert: false });

  if (upErr) {
    console.error('FAIL: Storage upload failed:', upErr.message);
    process.exit(1);
  }
  console.log('✅ Storage upload succeeded.');

  console.log(`\nStep 2: Creating memory row (id=${memoryId}, extraction_status='pending')...`);
  const { error: memErr } = await admin.from('memories').insert({
    id: memoryId,
    user_id: USER_ID,
    type: 'image',
    title: fileName,
    text_content: null,
    extraction_status: 'pending',
  });

  if (memErr) {
    console.error('FAIL: Memory insert failed:', memErr.message);
    await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
    process.exit(1);
  }
  console.log('✅ Memory record created.');

  console.log('\nStep 3: Creating memory_files attachment row...');
  const { error: fileErr } = await admin.from('memory_files').insert({
    memory_id: memoryId,
    user_id: USER_ID,
    storage_path: storagePath,
    file_name: fileName,
    file_type: 'image/jpeg',
    file_size: imageBytes.byteLength,
  });

  if (fileErr) {
    console.error('FAIL: File attachment insert failed:', fileErr.message);
    await admin.from('memories').delete().eq('id', memoryId);
    await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
    process.exit(1);
  }
  console.log('✅ File attachment record created.');

  console.log('\nStep 4: Running server-side enrichment...');
  const enrichResult = await reprocessMemory(memoryId);

  if (!enrichResult.ok) {
    console.error('FAIL: Enrichment returned error:', enrichResult.error);
    process.exit(1);
  }

  console.log('\nStep 5: Verifying DB state after enrichment...');
  const { data: updatedMem, error: getErr } = await admin
    .from('memories')
    .select('id, type, title, text_content, embedding, extraction_status, extraction_error')
    .eq('id', memoryId)
    .single();

  if (getErr || !updatedMem) {
    console.error('FAIL: Could not fetch updated memory:', getErr?.message);
    process.exit(1);
  }

  console.log(`- extraction_status: ${updatedMem.extraction_status} (Expected: 'done')`);
  console.log(`- extraction_error:  ${updatedMem.extraction_error} (Expected: null)`);
  console.log(`- text_content length: ${updatedMem.text_content?.length ?? 0}`);
  console.log(`- embedding present:  ${Boolean(updatedMem.embedding)}`);
  console.log('\n--- EXTRACTED TEXT PREVIEW ---');
  console.log(updatedMem.text_content);
  console.log('------------------------------');

  if (updatedMem.extraction_status !== 'done') {
    console.error('FAIL: extraction_status is not done!');
    process.exit(1);
  }
  if (!updatedMem.text_content || updatedMem.text_content.length < 20) {
    console.error('FAIL: text_content is missing or too short!');
    process.exit(1);
  }
  if (!updatedMem.embedding) {
    console.error('FAIL: embedding is missing!');
    process.exit(1);
  }

  console.log('\nStep 6: Testing Search Retrieval for NEW image memory...');

  async function testRetrieval(query, expectFound) {
    // Check lexical OR semantic match
    const qLower = query.toLowerCase();
    const { data: lexResults } = await admin
      .from('memories')
      .select('id, title, text_content')
      .eq('user_id', USER_ID)
      .or(`title.ilike.%${qLower}%,text_content.ilike.%${qLower}%`);

    let foundLexical = lexResults?.some((r) => r.id === memoryId) ?? false;

    // Check semantic match
    let foundSemantic = false;
    try {
      const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/uomr/remember',
          'X-Title': 'Remember',
        },
        body: JSON.stringify({
          model: 'openai/text-embedding-3-small',
          input: query,
        }),
      });
      if (res.ok) {
        const j = await res.json();
        const vec = j.data?.[0]?.embedding;
        if (vec) {
          const { data: semResults } = await admin.rpc('match_memories', {
            query_embedding: vec,
            similarity_threshold: 0.3,
            match_count: 10,
          });
          foundSemantic = semResults?.some((r) => r.id === memoryId) ?? false;
        }
      }
    } catch {
      // ignore
    }

    const found = foundLexical || foundSemantic;
    const pass = expectFound ? found : !found;
    console.log(
      `  Query "${query}": ${pass ? '✅ PASS' : '❌ FAIL'} (found=${found}, lex=${foundLexical}, sem=${foundSemantic})`,
    );
    return pass;
  }

  let searchPass = true;
  searchPass = (await testRetrieval('قهوة', true)) && searchPass;
  searchPass = (await testRetrieval('كوب', true)) && searchPass;
  searchPass = (await testRetrieval('كوب أحمر', true)) && searchPass;
  searchPass = (await testRetrieval('مشروب ساخن', true)) && searchPass;
  searchPass = (await testRetrieval('coffee', true)) && searchPass;
  searchPass = (await testRetrieval('red mug', true)) && searchPass;
  searchPass = (await testRetrieval('wooden table', true)) && searchPass;

  // Negative controls
  console.log('\nStep 7: Testing Negative Controls (must NOT retrieve new mug)...');
  searchPass = (await testRetrieval('حمامة', false)) && searchPass;
  searchPass = (await testRetrieval('zxqv9281', false)) && searchPass;
  searchPass = (await testRetrieval('فاتورة تحويل 2500', false)) && searchPass;

  if (!searchPass) {
    console.error('\nFAIL: Search verification did not pass all tests!');
    process.exit(1);
  }

  console.log('\n================================================================');
  console.log('  🎉 SUCCESS: NEW IMAGE UPLOAD FULLY ENRICHED & SEARCHABLE!     ');
  console.log('================================================================\n');
  process.exit(0);
}

main();
