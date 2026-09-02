/**
 * Connectivity test for the OpenRouter embeddings endpoint (semantic search).
 * Confirms the key + model + /embeddings path work and reports the vector size.
 * Reads .env.local; never prints the key.
 *
 * Run: node scripts/test-embeddings.mjs
 */
import { readFileSync } from 'node:fs';

function readEnv(name) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === name) return m[2];
  }
  return '';
}

const apiKey = readEnv('OPENROUTER_API_KEY');
const model = readEnv('OPENROUTER_EMBEDDING_MODEL') || 'openai/text-embedding-3-small';
if (!apiKey) {
  console.error('No OPENROUTER_API_KEY in .env.local');
  process.exit(1);
}

const input = 'حذاء أسود رياضي / black sneaker / جزمة';

try {
  const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Remember',
    },
    body: JSON.stringify({ model, input }),
  });
  console.log('HTTP status:', res.status, res.statusText);
  if (!res.ok) {
    console.error('FAILED. Body:', (await res.text()).slice(0, 500));
    process.exit(2);
  }
  const json = await res.json();
  const vec = json.data?.[0]?.embedding;
  console.log('Model:', model);
  console.log('Vector length:', Array.isArray(vec) ? vec.length : '(none)');
  console.log('First 5 dims:', Array.isArray(vec) ? vec.slice(0, 5) : json);
  if (Array.isArray(vec) && vec.length === 1536) {
    console.log('OK: embeddings work and match vector(1536).');
  } else {
    console.log('WARN: vector length is not 1536 — adjust the DB column/model to match.');
  }
} catch (err) {
  console.error('Request error:', err?.message || String(err));
  process.exit(3);
}
