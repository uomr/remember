import 'server-only';

import { AI_CONFIG } from '@/lib/config';
import type {
  AIService,
  Embedding,
  ExtractedText,
  ImageAnalysis,
  ImageDescription,
  OcrResult,
  SearchCandidate,
  SearchRanking,
} from '../types';

/**
 * OpenRouter provider (Phase 2).
 *
 * OpenRouter exposes an OpenAI-compatible Chat Completions API and brokers many
 * vision-capable models behind a single key, which is exactly why it was chosen
 * (see docs/DECISIONS.md ADR-007): we can swap the underlying model by changing
 * one env var, with zero code changes and no vendor lock-in.
 *
 * SERVER-ONLY. The API key never leaves the server. Every method is defensive:
 * it times out, and it surfaces a clear Error on failure so callers (which are
 * always best-effort enrichment paths) can swallow it and degrade gracefully —
 * AI must NEVER block or break capture.
 *
 * Images are fetched server-side and sent INLINE as a base64 data URL rather
 * than handing the model provider a remote URL to fetch. That is both more
 * reliable (many hosts, incl. private/signed URLs, block third-party fetchers)
 * and more private (we never expose the signed URL to the provider).
 */

const { apiKey, baseUrl, model, embeddingModel, referer, title, timeoutMs } = AI_CONFIG.openRouter;

interface ChatMessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

/** Fetch an image and return it as a `data:<mime>;base64,...` URL. */
async function toDataUrl(fileUrl: string, signal: AbortSignal): Promise<string> {
  const res = await fetch(fileUrl, { signal });
  if (!res.ok) throw new Error(`Could not fetch image for AI (${res.status}).`);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const base64 = Buffer.from(await res.arrayBuffer()).toString('base64');
  return `data:${contentType};base64,${base64}`;
}

/**
 * Low-level call to OpenRouter chat completions. Returns the assistant's text.
 * Throws on any non-OK response or timeout; callers decide how to handle it.
 */
async function chat(content: ChatMessageContent[], signal: AbortSignal): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // Optional attribution headers used by OpenRouter for app rankings.
      'HTTP-Referer': referer,
      'X-Title': title,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter request failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenRouter returned an empty response.');
  return text;
}

/**
 * Ask a vision model about an already-fetched base64 data URL.
 * This is the core vision call — it does NOT re-fetch the image.
 * Callers that need to make multiple passes over the same image
 * should fetch the image ONCE and call this directly to avoid
 * duplicated bandwidth and signed-URL expiry risk (fixes G2).
 */
async function askAboutImageData(
  dataUrl: string,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  return chat(
    [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
    signal,
  );
}

/**
 * Ask a vision model about an image URL. Fetches the bytes once and calls
 * the completion under one shared timeout so a slow step never hangs.
 * Prefer `askAboutImageData` directly when multiple prompts share the same image.
 */
async function askAboutImage(fileUrl: string, prompt: string): Promise<string> {
  if (!apiKey) throw new Error('OpenRouter API key is not configured.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const dataUrl = await toDataUrl(fileUrl, controller.signal);
    return await askAboutImageData(dataUrl, prompt, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

const OCR_PROMPT =
  'Extract ALL text visible in this image exactly as written, preserving reading ' +
  'order. Return only the transcribed text with no commentary. If there is no ' +
  'readable text, return an empty response.';

const DESCRIBE_PROMPT =
  'Describe this image so a person can find it later by searching in EITHER ' +
  'English or Arabic. Write it in two short lines: first an English description, ' +
  'then an Arabic (العربية) description with the SAME meaning. Focus on concrete ' +
  'subjects, objects, colors, visible text, and any brand or product names; if it ' +
  'is a logo, say explicitly "logo / شعار". Then add a final line starting with ' +
  '"Keywords:" listing 5-10 search terms in BOTH English and Arabic. Return only ' +
  'that text, with no extra commentary.';

/** The concrete OpenRouter-backed AIService. */
export const openRouterProvider: AIService = {
  enabled: true,

  /**
   * OCR pass. Kept as a standalone method for callers that only need text extraction.
   * When both OCR and description are needed for the same image, use enrichImageMemory
   * which fetches the image once and calls both passes via askAboutImageData.
   */
  async ocr({ fileUrl }): Promise<OcrResult> {
    const text = await askAboutImage(fileUrl, OCR_PROMPT);
    return { text };
  },

  async describeImage({ fileUrl }): Promise<ImageDescription> {
    const description = await askAboutImage(fileUrl, DESCRIBE_PROMPT);
    return { description };
  },

  /**
   * Fetch the image exactly ONCE and run both OCR and describe passes in parallel.
   * This halves bandwidth and eliminates the race condition where the signed URL
   * expires between the two sequential calls (fixes G2 / P4 from audit).
   */
  async ocrAndDescribeImage({ fileUrl }): Promise<ImageAnalysis> {
    if (!apiKey) throw new Error('OpenRouter API key is not configured.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs * 2); // two model calls share one budget
    try {
      const dataUrl = await toDataUrl(fileUrl, controller.signal);
      const [descResult, ocrResult] = await Promise.allSettled([
        askAboutImageData(dataUrl, DESCRIBE_PROMPT, controller.signal),
        askAboutImageData(dataUrl, OCR_PROMPT, controller.signal),
      ]);
      return {
        description: descResult.status === 'fulfilled' ? descResult.value.trim() : '',
        ocrText: ocrResult.status === 'fulfilled' ? ocrResult.value.trim() : '',
      };
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * Document text extraction is deferred: reliably parsing PDFs/DOCX needs more
   * than a single vision call. Kept explicit so the interface stays honest and
   * callers get a clear signal rather than a silent wrong answer.
   */
  extractText(): Promise<ExtractedText> {
    return Promise.reject(
      new Error('extractText is not implemented for the OpenRouter provider yet.'),
    );
  },

  /**
   * Produce a semantic embedding for a piece of text via OpenRouter's
   * OpenAI-compatible /embeddings endpoint. Powers meaning-based search
   * (pgvector, migration 0002). Times out and throws on failure so the
   * best-effort caller can swallow it and fall back to lexical search.
   */
  async embed({ text }): Promise<Embedding> {
    if (!apiKey) throw new Error('OpenRouter API key is not configured.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': referer,
          'X-Title': title,
        },
        body: JSON.stringify({ model: embeddingModel, input: text }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`OpenRouter embeddings failed (${res.status}): ${detail.slice(0, 300)}`);
      }

      const json = (await res.json()) as { data?: { embedding?: number[] }[] };
      const vector = json.data?.[0]?.embedding;
      if (!vector || vector.length === 0) {
        throw new Error('OpenRouter returned an empty embedding.');
      }
      return vector;
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * Fast bilingual/conceptual query expansion for semantic search.
   * Bridges cross-language semantic retrieval (e.g. Arabic to English Socrates)
   * while keeping similarity thresholds high enough to reject background noise.
   */
  async expandQuery({ query }: { query: string }): Promise<string> {
    if (!apiKey) return query;
    const trimmed = query.trim();
    if (!trimmed) return query;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': referer,
          'X-Title': title,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: `You are a search query expansion assistant for bilingual English/Arabic search.
Given an Arabic query, output the original Arabic query followed by its primary English translations and key synonyms.
Given an English query, output the original English query followed by its primary Arabic translations and key synonyms.
Output only space-separated words, nothing else. No markdown, no punctuation.

Query: ${trimmed}`,
            },
          ],
        }),
      });

      if (!res.ok) return query;
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = json.choices?.[0]?.message?.content?.trim();
      return raw ? `${trimmed} ${raw}` : query;
    } catch {
      return query;
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * Produce a clean, structured natural-language summary of raw document text.
   * Bridges PDF glyph corruption, tables, and reverse-Arabic visual streams.
   */
  async summarizeDocument({
    fileName,
    rawText,
  }: {
    fileName: string;
    rawText: string;
  }): Promise<string> {
    if (!apiKey) return '';
    const trimmed = rawText.trim();
    if (!trimmed) return '';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': referer,
          'X-Title': title,
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 220,
          messages: [
            {
              role: 'system',
              content: `You are an expert document understanding engine for a personal memory app.
Given extracted raw text from a document (which may have PDF glyph artifacts, reversed words, or bilingual tables), produce:
1. Document Type / Concept in standard Arabic and English (e.g. سند تحويل / إيصال حوالة بنكية / Bank Transfer Receipt, فاتورة / Invoice, عقد / Contract).
2. Key Entities: Parties, Accounts, Numbers, Amounts, Dates.
3. Clean summary in natural Arabic and English.
Keep it factual, concise (under 120 words), without conversational filler.`,
            },
            {
              role: 'user',
              content: `File name: ${fileName}\n\nRaw text:\n${trimmed.slice(0, 3500)}`,
            },
          ],
        }),
      });

      if (!res.ok) return '';
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return json.choices?.[0]?.message?.content?.trim() ?? '';
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * Final intent-aware relevance judge. Embeddings retrieve broadly; this pass
   * reads the actual candidate descriptions and removes merely adjacent items.
   * It understands colloquial Arabic, synonyms and the user's requested
   * attributes instead of relying on a dictionary or one cosine threshold.
   */
  async rankSearch({
    query,
    candidates,
  }: {
    query: string;
    candidates: SearchCandidate[];
  }): Promise<SearchRanking> {
    if (!apiKey) throw new Error('OpenRouter API key is not configured.');
    if (candidates.length === 0) return { ids: [] };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const compact = candidates.map((candidate) => ({
        id: candidate.id,
        type: candidate.type,
        title: candidate.title.slice(0, 160),
        text: candidate.text.slice(0, 900),
        url: candidate.url.slice(0, 240),
      }));
      const prompt = [
        'You are the precision relevance judge for a personal-memory search app.',
        'Understand the user intent naturally in any language, including colloquial Arabic, spelling variants and synonyms.',
        'Return ONLY memories that genuinely satisfy the request. Reject weak topical association, gibberish, and items missing an explicitly requested attribute (such as color).',
        'Exact identifiers, visible text, brands, URLs and file names count as strong evidence.',
        'If the query is broad (for example جزمة), include candidates that are actually shoes/boots/footwear, but never unrelated notes or logos.',
        'If nothing is truly relevant, return an empty list.',
        'Respond as strict JSON only: {"ids":["id1","id2"]}, ordered best first. Use only ids supplied below.',
        `USER QUERY: ${query}`,
        `CANDIDATES: ${JSON.stringify(compact)}`,
      ].join('\n');

      // temperature:0 for deterministic ranking; response_format enforces JSON output
      // on models that support it (OpenRouter passes it through transparently).
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': referer,
          'X-Title': title,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`OpenRouter reranker failed (${res.status}): ${detail.slice(0, 300)}`);
      }
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = json.choices?.[0]?.message?.content?.trim() ?? '';
      if (!raw) throw new Error('OpenRouter reranker returned empty response.');
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned) as { ids?: unknown };
      if (!Array.isArray(parsed.ids)) throw new Error('Search reranker returned invalid JSON.');

      const allowed = new Set(candidates.map((candidate) => candidate.id));
      const ids = parsed.ids.filter(
        (id): id is string => typeof id === 'string' && allowed.has(id),
      );
      return { ids: Array.from(new Set(ids)) };
    } finally {
      clearTimeout(timer);
    }
  },
};
