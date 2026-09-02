/** Live, read-only test of the intent-aware search reranker on existing memories. */
import { readFileSync } from 'node:fs';
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = class {};
const { createClient } = await import('@supabase/supabase-js');
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'))
  .map((line) => { const i = line.indexOf('='); return [line.slice(0, i).trim(), line.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });
const { data, error } = await db.from('memories').select('id,type,title,text_content,url');
if (error) throw error;
const candidates = (data ?? []).map((m) => ({
  id: m.id, type: m.type, title: (m.title ?? '').slice(0, 160),
  text: (m.text_content ?? '').slice(0, 900), url: (m.url ?? '').slice(0, 240),
}));
const queries = process.argv.slice(2);
if (!queries.length) queries.push('جزمة', 'حذاء اسود', 'شوز اسود');
for (const query of queries) {
  const prompt = [
    'You are the precision relevance judge for a personal-memory search app.',
    'Understand the user intent naturally in any language, including colloquial Arabic, spelling variants and synonyms.',
    'Return ONLY memories that genuinely satisfy the request. Reject weak topical association, gibberish, and items missing an explicitly requested attribute (such as color).',
    'Exact identifiers, visible text, brands, URLs and file names count as strong evidence.',
    'If the query is broad (for example جزمة), include candidates that are actually shoes/boots/footwear, but never unrelated notes or logos.',
    'If nothing is truly relevant, return an empty list.',
    'Respond as strict JSON only: {"ids":["id1","id2"]}, ordered best first. Use only ids supplied below.',
    `USER QUERY: ${query}`, `CANDIDATES: ${JSON.stringify(candidates)}`,
  ].join('\n');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Remember' },
    body: JSON.stringify({ model: env.OPENROUTER_MODEL || 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content ?? '';
  console.log(`\nQUERY: ${query}\nRANKER: ${raw}`);
  const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
  for (const id of parsed.ids ?? []) {
    const item = candidates.find((candidate) => candidate.id === id);
    console.log(`  -> ${id.slice(0, 8)} ${item?.type} ${item?.title}`);
  }
}
