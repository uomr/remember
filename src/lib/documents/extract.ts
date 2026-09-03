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

export function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')           // normalize line endings
    .replace(/[ \t]+/g, ' ')          // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n')       // collapse excessive blank lines
    .trim();
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
              text: cleanedPage,
            });
          }
        }
      }
    }

    const fullText = normalizeExtractedText(
      typeof result === 'string' ? result : (result as { text?: string })?.text ?? pages.map((p) => p.text).join('\n\n'),
    );
    const truncated = fullText.length > HARD_MAX_CHARS;

    return {
      rawText: fullText.slice(0, HARD_MAX_CHARS),
      pages,
      pageCount: typeof result?.total === 'number' ? result.total : pages.length,
      truncated,
    };
  } catch {
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
  } catch {
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
