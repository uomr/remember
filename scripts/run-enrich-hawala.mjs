import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const { createClient } = await import('@supabase/supabase-js');
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY);

const memoryId = '1ba6f5b6-972d-4ed2-a7a1-7a2a2d9eabed';
const { data: memory } = await admin.from('memories').select('*').eq('id', memoryId).single();
const { data: file } = await admin.from('memory_files').select('*').eq('memory_id', memoryId).single();

// 1. Download file bytes
const { data: fileData } = await admin.storage.from('memories').download(file.storage_path);
const buffer = Buffer.from(await fileData.arrayBuffer());

// 2. Extract with pdf-parse
const { PDFParse } = await import('pdf-parse');
const parser = new PDFParse({ data: buffer });
const result = await parser.getText();
const rawText = result.text;

console.log('Raw text extracted, length:', rawText.length);

// 3. Summarize with gpt-4o-mini as defined in our enrich pipeline
let summary = '';
if (env.OPENROUTER_API_KEY) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
          content: 'You are a document analyzer. Extract key metadata and entities from this document text in concise Arabic and English. Include document type (e.g. سند تحويل / إيصال حوالة / Bank Transfer Receipt), parties, amounts, account numbers, dates, and reference numbers. Return plain text only.',
        },
        {
          role: 'user',
          content: `File: ${file.file_name}\n\n${rawText}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
    }),
  });
  if (res.ok) {
    const json = await res.json();
    summary = json.choices[0]?.message?.content?.trim() ?? '';
    console.log('AI SUMMARY GENERATED:\n', summary);
  }
}

// 4. Update memory text_content with summary + rawText
const combinedText = summary ? `${summary}\n\n${rawText}` : rawText;

// 5. Generate embedding of combined text
let embedding = null;
if (env.OPENROUTER_API_KEY) {
  const textToEmbed = [file.file_name, summary, rawText.slice(0, 1500)].filter(Boolean).join('\n\n');
  const embedRes = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'openai/text-embedding-3-small',
      input: textToEmbed,
    }),
  });
  if (embedRes.ok) {
    const embedJson = await embedRes.json();
    embedding = JSON.stringify(embedJson.data[0].embedding);
    console.log('Embedding regenerated successfully!');
  }
}

// 6. Update database
await admin.from('memories').update({
  text_content: combinedText.slice(0, 1500),
  embedding: embedding,
  extraction_status: 'done',
  extraction_error: null,
}).eq('id', memoryId);

// 7. Update chunk
await admin.from('memory_chunks').update({
  chunk_text: combinedText.slice(0, 2000),
}).eq('memory_id', memoryId);

console.log('Memory and chunk updated with AI summary and clean Arabic terms!');
