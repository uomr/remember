/**
 * Connectivity test for the OpenRouter provider. Mirrors the production path:
 * fetch the image bytes, send them INLINE as a base64 data URL, and run a real
 * OCR call. Reads the key from .env.local and never prints it.
 */
import { readFileSync } from 'node:fs';

function readEnv(name) {
  const txt = readFileSync('.env.local', 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === name) return m[2];
  }
  return '';
}

const apiKey = readEnv('OPENROUTER_API_KEY');
const model = readEnv('OPENROUTER_MODEL') || 'google/gemini-2.5-flash';
if (!apiKey) {
  console.error('No OPENROUTER_API_KEY in .env.local');
  process.exit(1);
}

// A generated PNG containing the text "REMEMBER OCR OK".
const imageUrl = 'https://placehold.co/600x200/png?text=REMEMBER+OCR+OK';

async function toDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch image failed: ${res.status}`);
  const contentType = res.headers.get('content-type') || 'image/png';
  const base64 = Buffer.from(await res.arrayBuffer()).toString('base64');
  return `data:${contentType};base64,${base64}`;
}

try {
  const dataUrl = await toDataUrl(imageUrl);
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Remember',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe the text in this image. Reply with only that text.' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });

  console.log('HTTP status:', res.status, res.statusText);
  if (!res.ok) {
    const body = await res.text();
    console.error('FAILED. Body (first 500 chars):', body.slice(0, 500));
    process.exit(2);
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content?.trim() ?? '(empty)';
  console.log('Model:', model);
  console.log('Model read from image =>', JSON.stringify(text));
  console.log('OK: OpenRouter key + vision model + base64 path all work.');
} catch (err) {
  console.error('Request error:', err?.message || String(err));
  process.exit(3);
}
