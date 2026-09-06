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

async function testSemantic() {
  const orRes = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/text-embedding-3-small',
      input: 'pigeon',
    }),
  });

  const json = await orRes.json();
  const vector = json.data[0].embedding;

  const { data, error } = await admin.rpc('match_memories', {
    query_embedding: vector,
    match_count: 5,
    similarity_threshold: 0.2,
  });

  console.log('match_memories for pigeon:', error ? error : data);
  const found = data?.some((m) => m.id === PIGEON_ID);
  console.log('Found pigeon memory via semantic search?:', found);
}

testSemantic();
