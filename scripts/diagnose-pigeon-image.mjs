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
const STORAGE_PATH = 'bd07342f-440f-4860-83df-d21c4c0e205d/77ebc983-7e3b-4793-869c-70d2b899e070/1000271157.jpg';

async function diagnose() {
  console.log('1. Checking storage object...');
  const { data: signedData, error: signError } = await admin.storage
    .from('memories')
    .createSignedUrl(STORAGE_PATH, 300);

  if (signError || !signedData?.signedUrl) {
    console.error('Storage sign error:', signError);
    return;
  }
  console.log('Signed URL generated successfully.');

  console.log('2. Fetching image bytes...');
  const res = await fetch(signedData.signedUrl);
  console.log('Fetch status:', res.status, 'Content-Type:', res.headers.get('content-type'));
  const buffer = await res.arrayBuffer();
  console.log('Fetched bytes:', buffer.byteLength);

  console.log('3. Testing OpenRouter API with this image...');
  const base64 = Buffer.from(buffer).toString('base64');
  const dataUrl = `data:image/jpeg;base64,${base64}`;

  const apiKey = env.OPENROUTER_API_KEY;
  const model = env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
  console.log('Using model:', model);

  const prompt =
    'Describe this image so a person can find it later by searching in EITHER ' +
    'English or Arabic. Write it in two short lines: first an English description, ' +
    'then an Arabic (العربية) description with the SAME meaning. Focus on concrete ' +
    'subjects, objects, colors, visible text, and any brand or product names. Then add a final line starting with ' +
    '"Keywords:" listing 5-10 search terms in BOTH English and Arabic. Return only ' +
    'that text, with no extra commentary.';

  const chatRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/uomr/remember',
      'X-Title': 'Remember',
    },
    body: JSON.stringify({
      model: model,
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

  console.log('Chat response status:', chatRes.status);
  const chatText = await chatRes.text();
  console.log('Chat response body:\n', chatText);
}

diagnose();
