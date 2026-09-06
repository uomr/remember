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
const USER_ID = 'bd07342f-440f-4860-83df-d21c4c0e205d';

async function verify() {
  console.log('====================================================');
  console.log('  VERIFYING PIGEON MEMORY FIELDS IN PRODUCTION DB   ');
  console.log('====================================================');

  const { data: mem, error } = await admin
    .from('memories')
    .select('id, type, title, text_content, embedding, extraction_status, extraction_error')
    .eq('id', PIGEON_ID)
    .single();

  if (error || !mem) {
    console.error('Failed to fetch pigeon memory:', error);
    process.exit(1);
  }

  console.log('1. Text Content Exists?:', Boolean(mem.text_content));
  console.log('   Text Content Preview:\n  ', mem.text_content ? mem.text_content.slice(0, 200) + '...' : '(none)');
  console.log('2. Bilingual Description Verified?:', mem.text_content?.includes('حمامة') && mem.text_content?.includes('dove'));
  console.log('3. Embedding Exists?:', Boolean(mem.embedding));
  console.log('4. Extraction Status:', mem.extraction_status);
  console.log('5. Extraction Error:', mem.extraction_error);

  if (!mem.text_content || !mem.embedding || mem.extraction_status !== 'done') {
    console.error('FAIL: Pigeon memory fields are not complete!');
    process.exit(1);
  }

  console.log('\n====================================================');
  console.log('  TESTING REAL SEARCH QUERIES FOR PIGEON MEMORY     ');
  console.log('====================================================');

  // We can query using the search logic
  // Substring search check on text_content
  async function testQuery(query, expectFound) {
    const qLower = query.toLowerCase();
    const { data: results, error: sErr } = await admin
      .from('memories')
      .select('id, title, text_content')
      .eq('user_id', USER_ID)
      .or(`title.ilike.%${qLower}%,text_content.ilike.%${qLower}%`);

    const found = results?.some((r) => r.id === PIGEON_ID);
    const pass = expectFound ? found : !found;
    console.log(`Query "${query}": ${pass ? '✅ PASS' : '❌ FAIL'} (found: ${found}, count: ${results?.length ?? 0})`);
    return pass;
  }

  let allPass = true;
  allPass = (await testQuery('حمامة', true)) && allPass;
  allPass = (await testQuery('طائر', true)) && allPass;
  allPass = (await testQuery('pigeon', true)) && allPass;
  allPass = (await testQuery('bird', true)) && allPass;
  allPass = (await testQuery('dove', true)) && allPass;
  allPass = (await testQuery('قفص صدري', true)) && allPass;
  allPass = (await testQuery('zxqv9281', false)) && allPass;
  allPass = (await testQuery('submarine', false)) && allPass;
  allPass = (await testQuery('invoice', false)) && allPass;

  console.log('\n====================================================');
  console.log(`Search Verification: ${allPass ? 'ALL TESTS PASSED ✅' : 'SOME TESTS FAILED ❌'}`);
  console.log('====================================================');
  process.exit(allPass ? 0 : 2);
}

verify();
