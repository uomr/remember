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
const targetUserId = 'bd07342f-440f-4860-83df-d21c4c0e205d';
const hawalaId = '1ba6f5b6-972d-4ed2-a7a1-7a2a2d9eabed';

// Import Arabic normalizer
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

// Function to simulate user search
async function testSearch(query) {
  console.log(`\n-----------------------------------------`);
  console.log(`QUERY: "${query}"`);

  // 1. Lexical search in memory_chunks
  const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  const perTerm = terms.map((t) => {
    const norm = normalizeArabicForSearch(t);
    if (norm && norm !== t) {
      return `or(chunk_text.ilike.%${t}%,chunk_text.ilike.%${norm}%)`;
    }
    return `chunk_text.ilike.%${t}%`;
  });
  const subFilter = perTerm.length === 1 ? perTerm[0] : `and(${perTerm.join(',')})`;

  const { data: chunkHits } = await admin
    .from('memory_chunks')
    .select('memory_id')
    .eq('user_id', targetUserId)
    .or(subFilter);

  const chunkFound = (chunkHits || []).some((r) => r.memory_id === hawalaId);
  console.log('Tier 1 Lexical / Chunk hit:', chunkFound ? 'YES' : 'NO');

  // 2. Semantic search
  let semanticFound = false;
  let similarity = 0;
  if (env.OPENROUTER_API_KEY) {
    // Cross-language query expansion for Arabic
    let queryForEmbedding = query;
    if (/[\u0600-\u06FF]/.test(query)) {
      const expRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'Output 3 to 6 high-value search keywords/synonyms in both Arabic and English. Return only space-separated keywords.',
            },
            { role: 'user', content: query },
          ],
          temperature: 0.1,
          max_tokens: 60,
        }),
      });
      if (expRes.ok) {
        const expJson = await expRes.json();
        queryForEmbedding = expJson.choices[0].message.content.trim();
        console.log('  Expanded query:', queryForEmbedding);
      }
    }

    const embedRes = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',
        input: queryForEmbedding,
      }),
    });
    if (embedRes.ok) {
      const qVec = (await embedRes.json()).data[0].embedding;
      const { data: memRow } = await admin.from('memories').select('embedding').eq('id', hawalaId).single();
      if (memRow?.embedding) {
        const docVec = typeof memRow.embedding === 'string' ? JSON.parse(memRow.embedding) : memRow.embedding;
        let dot = 0, nA = 0, nB = 0;
        for (let i = 0; i < docVec.length; i++) {
          dot += docVec[i] * qVec[i];
          nA += docVec[i] * docVec[i];
          nB += qVec[i] * qVec[i];
        }
        similarity = dot / (Math.sqrt(nA) * Math.sqrt(nB));
        semanticFound = similarity >= 0.30;
      }
    }
  }
  console.log(`Tier 2 Semantic hit: ${semanticFound ? 'YES' : 'NO'} (Cosine: ${similarity.toFixed(4)})`);
  console.log(`OVERALL RESULT: ${chunkFound || semanticFound ? 'FOUND' : 'NOT FOUND'}`);
}

await testSearch('حوالة');
await testSearch('حواله');
await testSearch('سند حوالة');
await testSearch('تحويل');
await testSearch('تحويل مالي');
await testSearch('315000010006086039455');
await testSearch('Alrajhibank');
await testSearch('Transfer');
await testSearch('zxqv9281!!!');
await testSearch('قفصطبلغ');
