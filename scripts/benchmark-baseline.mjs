import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
  if (m) {
    let val = (m[2] || '').trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[m[1]] = val;
  }
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const openRouterKey = env.OPENROUTER_API_KEY;

const supabase = createClient(url, key);

async function runBenchmark() {
  console.log('--- BASELINE LATENCY MEASUREMENTS ---');

  // 1. Raw Lexical Search Latency
  const t0 = performance.now();
  const { data: lexData } = await supabase
    .from('memories')
    .select('id, title, text_content, url, created_at')
    .ilike('title', '%test%')
    .limit(20);
  const lexMs = performance.now() - t0;
  console.log(`[1] Raw Lexical Search Latency: ${lexMs.toFixed(2)}ms (found ${lexData?.length || 0})`);

  // 2. Signed URL Generation Latency (Signing 5-10 files)
  const { data: files } = await supabase.from('memory_files').select('storage_path').limit(10);
  if (files && files.length > 0) {
    const tSign = performance.now();
    await Promise.all(
      files.map(f => supabase.storage.from('memories').createSignedUrl(f.storage_path, 3600))
    );
    const signMs = performance.now() - tSign;
    console.log(`[2] Supabase createSignedUrl for ${files.length} files: ${signMs.toFixed(2)}ms (Avg: ${(signMs / files.length).toFixed(2)}ms/file)`);
  }

  // 3. OpenRouter Embedding Latency
  if (openRouterKey) {
    const tEmb = performance.now();
    const embRes = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',
        input: 'receipt coffee',
      }),
    });
    const embMs = performance.now() - tEmb;
    console.log(`[3] OpenRouter Embedding Latency: ${embMs.toFixed(2)}ms (Status: ${embRes.status})`);

    // 4. OpenRouter Query Expansion Latency (Arabic -> Cross-Language)
    const tExp = performance.now();
    const expRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        temperature: 0,
        max_tokens: 30,
        messages: [
          { role: 'system', content: 'Expand query intent concisely.' },
          { role: 'user', content: 'سقراط' },
        ],
      }),
    });
    const expMs = performance.now() - tExp;
    console.log(`[4] OpenRouter Query Expansion (LLM) Latency: ${expMs.toFixed(2)}ms (Status: ${expRes.status})`);
  }
}

runBenchmark().catch(console.error);
