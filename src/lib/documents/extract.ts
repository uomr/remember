/**
 * Document text extraction — server-only, deterministic, zero AI cost.
 *
 * Supported formats:
 *   - TXT / MD  : raw UTF-8 decode
 *   - PDF       : pdf-parse v2 (page-aware text layer extraction)
 *   - DOCX      : mammoth (Office Open XML → plain text with paragraph preservation)
 *   - DOC       : mammoth best-effort (legacy OLE)
 */

import { computeSha256, PARSER_VERSION } from './identity';
import type { ExtractedDocument, DocumentPage } from './types';

// Maximum characters to extract per document to avoid runaway memory on pathological files
const HARD_MAX_CHARS = 500_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Universal Arabic normalizer for search and indexing.
 * Ensures consistent matching across spelling variations, Presentation Forms,
 * and regional character variants.
 */
export function normalizeArabicForSearch(text: string): string {
  if (!text) return '';
  return text
    // 1. Unicode NFKC (decomposes presentation forms U+FB50-U+FDFF, U+FE70-U+FEFF into standard Arabic)
    .normalize('NFKC')
    // 2. Remove Arabic diacritics (Harakat / Tashkeel)
    .replace(/[\u064B-\u065F\u0670]/g, '')
    // 3. Remove Tatweel / Kashida
    .replace(/\u0640/g, '')
    // 4. Normalize Alef variants (أ, إ, آ, ٱ -> ا)
    .replace(/[أإآٱ]/g, 'ا')
    // 5. Normalize Taa Marbuta (ة -> ه)
    .replace(/ة/g, 'ه')
    // 6. Normalize Alef Maksura (ى -> ي)
    .replace(/ى/g, 'ي')
    // 7. Map common PDF font substitutions (dotless letters)
    .replace(/\u066E/g, 'ت')
    .replace(/\u06A1/g, 'ف')
    .replace(/\u066F/g, 'ق')
    // 8. Normalize Eastern Arabic & Persian numerals to standard digits (٠-٩ -> 0-9)
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

export function normalizeExtractedText(raw: string): string {
  // Always NFKC normalize first to convert Presentation Forms into standard Unicode
  const nfkc = raw.normalize('NFKC');
  return nfkc
    .replace(/\r\n/g, '\n')           // normalize line endings
    .replace(/[ \t]+/g, ' ')          // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')       // collapse excessive blank lines
    .trim();
}

/**
 * Augments extracted PDF text with normalized Arabic and reversed-word tokens
 * so that both original visual glyphs and corrected semantic tokens match in FTS.
 */
export function augmentArabicPdfText(text: string): string {
  if (!text) return '';
  const hasArabic = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  if (!hasArabic) return text;

  const norm = normalizeArabicForSearch(text);
  const tokens = norm.split(/\s+/);
  const extraTokens = new Set<string>();

  for (const token of tokens) {
    if (/[\u0600-\u06FF]/.test(token) && token.length > 2) {
      // If token looks visually reversed (e.g. starts with 'ه' or ends with 'ال'):
      const looksReversed = /^ه/.test(token) || /ال$/.test(token) || /لل$/.test(token);
      if (looksReversed) {
        const rev = Array.from(token).reverse().join('');
        if (rev.length > 1) extraTokens.add(rev);
      }
      extraTokens.add(token);
    }
  }

  if (extraTokens.size > 0) {
    return `${text}\n\n${Array.from(extraTokens).join(' ')}`;
  }
  return text;
}

// ── Plain text (TXT / MD) ────────────────────────────────────────────────────

function extractPlainText(buffer: Buffer): { rawText: string; truncated: boolean } {
  const text = normalizeExtractedText(buffer.toString('utf-8'));
  const truncated = text.length > HARD_MAX_CHARS;
  return {
    rawText: text.slice(0, HARD_MAX_CHARS),
    truncated,
  };
}

// ── PDF ──────────────────────────────────────────────────────────────────────

async function extractPdf(buffer: Buffer): Promise<{
  rawText: string;
  pages: DocumentPage[];
  pageCount: number;
  truncated: boolean;
}> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();

    const pages: DocumentPage[] = [];
    if (Array.isArray(result?.pages)) {
      for (const p of result.pages) {
        if (p && typeof p.text === 'string') {
          const cleanedPage = normalizeExtractedText(p.text);
          if (cleanedPage) {
            pages.push({
              pageNumber: typeof p.num === 'number' ? p.num : pages.length + 1,
              text: augmentArabicPdfText(cleanedPage),
            });
          }
        }
      }
    }

    const fullRaw = typeof result === 'string' ? result : (result as { text?: string })?.text ?? pages.map((p) => p.text).join('\n\n');
    const cleanedFull = normalizeExtractedText(fullRaw);
    const augmentedFull = augmentArabicPdfText(cleanedFull);
    const truncated = augmentedFull.length > HARD_MAX_CHARS;

    return {
      rawText: augmentedFull.slice(0, HARD_MAX_CHARS),
      pages,
      pageCount: typeof result?.total === 'number' ? result.total : pages.length,
      truncated,
    };
  } catch (err) {
    console.error('[extractPdf:error]', err instanceof Error ? err.message : String(err));
    return { rawText: '', pages: [], pageCount: 0, truncated: false };
  }
}

// ── DOCX / DOC ───────────────────────────────────────────────────────────────

async function extractDocx(buffer: Buffer): Promise<{ rawText: string; truncated: boolean }> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    const text = normalizeExtractedText(result.value ?? '');
    const truncated = text.length > HARD_MAX_CHARS;
    return {
      rawText: text.slice(0, HARD_MAX_CHARS),
      truncated,
    };
  } catch (err) {
    console.error('[extractDocx:error]', err instanceof Error ? err.message : String(err));
    return { rawText: '', truncated: false };
  }
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Extract text from a document buffer and construct a complete ExtractedDocument.
 *
 * @param buffer   Raw file bytes.
 * @param mimeType Declared MIME type (already validated by verifyUpload).
 * @param fileName Original file name (used for extension-based fallback).
 */
export async function extractDocument(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ExtractedDocument> {
  const fileHash = computeSha256(buffer);
  const mime = mimeType.trim().toLowerCase();
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

  let rawText = '';
  let pages: DocumentPage[] | undefined;
  let pageCount: number | undefined;
  let truncated = false;

  if (mime === 'application/pdf' || ext === 'pdf') {
    const pdfRes = await extractPdf(buffer);
    rawText = pdfRes.rawText;
    pages = pdfRes.pages;
    pageCount = pdfRes.pageCount;
    truncated = pdfRes.truncated;
  } else if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword' ||
    ext === 'docx' ||
    ext === 'doc'
  ) {
    const docxRes = await extractDocx(buffer);
    rawText = docxRes.rawText;
    truncated = docxRes.truncated;
  } else if (mime.startsWith('text/') || ['txt', 'md', 'markdown', 'rst'].includes(ext)) {
    const textRes = extractPlainText(buffer);
    rawText = textRes.rawText;
    truncated = textRes.truncated;
  }

  const contentHash = computeSha256(rawText);

  return {
    rawText,
    pages,
    pageCount,
    fileHash,
    contentHash,
    parserVersion: PARSER_VERSION,
    truncated,
  };
}
