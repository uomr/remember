import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    }),
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const PIGEON_ID = '77ebc983-7e3b-4793-869c-70d2b899e070';

async function test() {
  console.log('--- Step 1: Querying Memory from DB ---');
  const { data: memory, error } = await admin
    .from('memories')
    .select('*, memory_files(*)')
    .eq('id', PIGEON_ID)
    .single();

  if (error || !memory) {
    console.error('Error fetching memory:', error);
    return;
  }

  console.log('Memory found:', {
    id: memory.id,
    type: memory.type,
    title: memory.title,
    text_content: memory.text_content,
    extraction_status: memory.extraction_status,
    file_count: memory.memory_files?.length,
  });

  const file = memory.memory_files?.[0];
  console.log('File record:', file);

  // In getMemory(), resolveFirstFile returns:
  const resolvedFileUrl = `/api/media/${memory.id}`;
  console.log('\n--- Step 2: What getMemory() returned to enrichImageMemory ---');
  console.log('fileUrl:', resolvedFileUrl);

  console.log('\n--- Step 3: Simulating what happens when enrichImageMemory calls ai.ocrAndDescribeImage ---');
  try {
    await fetch(resolvedFileUrl);
  } catch (err) {
    console.log('FETCH FAILED AS EXPECTED WITH RELATIVE URL:');
    console.log('Error name:', err.name);
    console.log('Error message:', err.message);
    console.log('Error code:', err.code);
  }

  console.log('\n--- Step 4: Testing the Correct Resolution (Storage Signed URL) ---');
  const { data: signedData, error: signError } = await admin.storage
    .from('memories')
    .createSignedUrl(file.storage_path, 300);

  if (signError || !signedData?.signedUrl) {
    console.error('Failed to create signed URL:', signError);
    return;
  }
  console.log('Signed URL created:', signedData.signedUrl.slice(0, 80) + '...');

  const fetchRes = await fetch(signedData.signedUrl);
  console.log('Fetch with Signed URL succeeded! Status:', fetchRes.status, 'Size:', fetchRes.headers.get('content-length'));
}

test();
