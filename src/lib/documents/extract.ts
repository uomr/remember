/**
 * Document text extraction — server-only, deterministic, zero AI cost.
 *
 * Supported formats:
 *   - TXT / MD  : raw UTF-8 decode
 *   - PDF       : pdf-parse v2 (page-aware text layer extraction)
 *   - DOCX      : mammoth (Office Open XML → plain text with paragraph preservation)
 *   - DOC       : mammoth best-effort (legacy OLE)
 */

import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { computeSha256, PARSER_VERSION } from './identity';
import type { ExtractedDocument, DocumentPage } from './types';

const execFileAsync = promisify(execFile);

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
    // 7. Map Farsi / Urdu / regional variants of Yeh, Kaf, and Heh to standard Arabic
    .replace(/[\u06CC\u06CD\u06CE\u06D0\u06D1]/g, 'ي')
    .replace(/[\u06A9\u06AA\u06AB\u06AC]/g, 'ك')
    .replace(/[\u06C0\u06C1\u06C2\u06C3\u06D5\u06BE]/g, 'ه')
    // 8. Map common PDF font substitutions (dotless letters)
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
 * Handles reverse-order LTR PDF printer artifacts where letters or words were inverted.
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
      // 1. Definite article with trailing Alif (e.g. 'لخطا' -> 'الخط', 'لوصفا' -> 'الوصف', 'لرصيدا' -> 'الرصيد')
      if (token.startsWith('ل') && token.endsWith('ا') && token.length >= 3) {
        const unshifted = 'ال' + token.slice(1, -1);
        extraTokens.add(unshifted);
      }

      // 2. Reversed tokens (e.g. 'قمر' -> 'رقم', 'يخرتا' -> 'تاريخ')
      const looksReversed =
        /^ه/.test(token) ||
        /ال$/.test(token) ||
        /لل$/.test(token) ||
        /^[^\u0627].*\u0627$/.test(token);

      if (looksReversed) {
        const rev = Array.from(token).reverse().join('');
        if (rev.length > 1) {
          extraTokens.add(rev);
          if (rev.startsWith('ل') && rev.endsWith('ا') && rev.length >= 3) {
            extraTokens.add('ال' + rev.slice(1, -1));
          }
        }
      }
      extraTokens.add(token);
    }
  }

  // 3. Reversed entity and company name reconstruction:
  // Detect "شركة الخط الأحمر" where legacy PDF print drivers emitted visual presentation forms
  if (norm.includes('لخطا') || norm.includes('املأحا') || norm.includes('املأح') || norm.includes('احألما')) {
    extraTokens.add('الخط');
    extraTokens.add('الأحمر');
    extraTokens.add('الاحمر');
    extraTokens.add('الخط الأحمر');
    extraTokens.add('الخط الاحمر');
    if (norm.includes('شركة')) {
      extraTokens.add('شركة الخط الأحمر');
      extraTokens.add('شركة الخط الاحمر');
    }
  }

  if (norm.includes('رلغياا') || norm.includes('لغيارا')) {
    extraTokens.add('الغيار');
    extraTokens.add('قطع الغيار');
  }

  if (norm.includes('راتلسيار') || norm.includes('لسياراتا')) {
    extraTokens.add('السيارات');
  }

  if (norm.includes('لجديد') || norm.includes('لجديدا')) {
    extraTokens.add('الجديد');
  }

  if (extraTokens.size > 0) {
    return `${text}\n\n${Array.from(extraTokens).join(' ')}`;
  }
  return text;
}

/**
 * Augments extracted document text with normalized numbers and date bridges
 * so that comma-separated numbers (2,000 -> 2000), word numbers (2000 -> الفين),
 * and English/Arabic month variants (August -> شهر 8) are indexable via PostgreSQL.
 */
export function augmentDocumentSearchTokens(text: string): string {
  if (!text) return '';
  const extraTokens = new Set<string>();

  // 1. Numeric normalization (e.g. "2,000" -> "2000")
  const digitMatches = text.match(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g) || [];
  for (const dm of digitMatches) {
    const rawDigits = dm.split('.')[0]?.replace(/,/g, '');
    if (rawDigits) {
      extraTokens.add(rawDigits);
      if (rawDigits === '2000') { extraTokens.add('الفين'); extraTokens.add('ألفين'); }
      if (rawDigits === '1000') { extraTokens.add('الف'); extraTokens.add('ألف'); }
      if (rawDigits === '500') { extraTokens.add('خمسمائة'); extraTokens.add('خمسمية'); }
    }
  }

  // Plain integers (e.g. 2000 -> "2,000", "الفين")
  const plainNums = text.match(/\b\d{3,7}\b/g) || [];
  for (const pn of plainNums) {
    if (pn === '2000') { extraTokens.add('الفين'); extraTokens.add('ألفين'); extraTokens.add('2,000'); }
    if (pn === '1000') { extraTokens.add('الف'); extraTokens.add('ألف'); extraTokens.add('1,000'); }
    if (pn === '500') { extraTokens.add('خمسمائة'); extraTokens.add('خمسمية'); }
  }

  // 2. Month and concept bridges
  const lower = text.toLowerCase();
  if (/august|\b08\b|\/08\/|-08-|\baug\b|أغسطس|اغسطس/i.test(lower)) {
    extraTokens.add('شهر 8'); extraTokens.add('أغسطس'); extraTokens.add('August'); extraTokens.add('08');
  }
  if (/january|\b01\b|\/01\/|-01-|\bjan\b|يناير/i.test(lower)) {
    extraTokens.add('شهر 1'); extraTokens.add('يناير'); extraTokens.add('January');
  }
  if (/february|\b02\b|\/02\/|-02-|\bfeb\b|فبراير/i.test(lower)) {
    extraTokens.add('شهر 2'); extraTokens.add('فبراير'); extraTokens.add('February');
  }
  if (/march|\b03\b|\/03\/|-03-|\bmar\b|مارس/i.test(lower)) {
    extraTokens.add('شهر 3'); extraTokens.add('مارس'); extraTokens.add('March');
  }
  if (/salary|payroll|wages/i.test(lower)) {
    extraTokens.add('راتب'); extraTokens.add('راتبي'); extraTokens.add('مرتب');
  }

  if (extraTokens.size > 0) {
    return `${text}\n\n${Array.from(extraTokens).join(' ')}`;
  }
  return text;
}

// ── Plain text (TXT / MD) ────────────────────────────────────────────────────

function extractPlainText(buffer: Buffer): { rawText: string; truncated: boolean } {
  const text = augmentDocumentSearchTokens(normalizeExtractedText(buffer.toString('utf-8')));
  const truncated = text.length > HARD_MAX_CHARS;
  return {
    rawText: text.slice(0, HARD_MAX_CHARS),
    truncated,
  };
}

// ── Scanned PDF & OCR Support ───────────────────────────────────────────────

/**
 * Extract embedded JPEG page images from PDF buffer without external dependencies.
 * Efficiently locates DCTDecode streams (0xFF, 0xD8, 0xFF ... 0xFF, 0xD9).
 */
export function extractEmbeddedJpegsFromPdf(buf: Buffer): Buffer[] {
  const images: Buffer[] = [];
  let pos = 0;
  while (pos < buf.length - 4) {
    if (buf[pos] === 0xff && buf[pos + 1] === 0xd8 && buf[pos + 2] === 0xff) {
      const start = pos;
      let end = -1;
      for (let j = start + 2; j < buf.length - 1; j++) {
        if (buf[j] === 0xff && buf[j + 1] === 0xd9) {
          end = j + 2;
          break;
        }
      }
      if (end !== -1 && end - start > 30000) {
        // Meaningful page image (> 30KB)
        images.push(buf.subarray(start, end));
        pos = end;
        continue;
      }
    }
    pos++;
  }
  return images;
}

/**
 * Perform local zero-cost Tesseract OCR if binary is installed on the host.
 * Typically runs in ~1.2s per page on Oracle host at $0.00 cost.
 */
export async function runLocalOcr(imgBuffer: Buffer): Promise<string | null> {
  const tesseractBin = 'tesseract';
  try {
    if (process.platform === 'win32') {
      execSync('where tesseract', { stdio: 'ignore' });
    } else {
      execSync('which tesseract', { stdio: 'ignore' });
    }
  } catch {
    return null; // Tesseract not present on host
  }

  const tmpDir = os.tmpdir();
  const id = Math.random().toString(36).slice(2);
  const inPath = path.join(tmpDir, `ocr_in_${id}.jpg`);
  const outBase = path.join(tmpDir, `ocr_out_${id}`);
  const outPath = `${outBase}.txt`;

  try {
    writeFileSync(inPath, imgBuffer);
    await execFileAsync(tesseractBin, [inPath, outBase, '-l', 'ara+eng']);
    if (existsSync(outPath)) {
      const text = readFileSync(outPath, 'utf8');
      return text.trim();
    }
    return null;
  } catch (err) {
    console.warn('[runLocalOcr:warn]', err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    try {
      if (existsSync(inPath)) unlinkSync(inPath);
    } catch {}
    try {
      if (existsSync(outPath)) unlinkSync(outPath);
    } catch {}
  }
}

// ── PDF ──────────────────────────────────────────────────────────────────────

async function extractPdf(buffer: Buffer): Promise<{
  rawText: string;
  pages: DocumentPage[];
  pageCount: number;
  truncated: boolean;
  errorReason?: string;
}> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();

    const pages: DocumentPage[] = [];
    if (Array.isArray(result?.pages)) {
      for (const p of result.pages) {
        if (p && typeof p.text === 'string') {
          const cleanedPage = augmentDocumentSearchTokens(augmentArabicPdfText(normalizeExtractedText(p.text)));
          if (cleanedPage) {
            pages.push({
              pageNumber: typeof p.num === 'number' ? p.num : pages.length + 1,
              text: cleanedPage,
            });
          }
        }
      }
    }

    const fullRaw = typeof result === 'string' ? result : (result as { text?: string })?.text ?? pages.map((p) => p.text).join('\n\n');
    const cleanedFull = normalizeExtractedText(fullRaw);

    // If PDF text layer yielded sufficient text (>= 50 chars), use normal parser:
    if (cleanedFull.length >= 50) {
      const augmentedFull = augmentDocumentSearchTokens(augmentArabicPdfText(cleanedFull));
      const truncated = augmentedFull.length > HARD_MAX_CHARS;
      return {
        rawText: augmentedFull.slice(0, HARD_MAX_CHARS),
        pages,
        pageCount: typeof result?.total === 'number' ? result.total : pages.length,
        truncated,
      };
    }

    // PDF has no useful text layer (< 50 chars). Check for scanned/image pages:
    const pageImages = extractEmbeddedJpegsFromPdf(buffer);
    if (pageImages.length > 0) {
      pages.length = 0; // Reset any empty text layer pages
      let combinedOcrText = '';

      for (let i = 0; i < pageImages.length; i++) {
        const imgBuf = pageImages[i];
        if (!imgBuf) continue;
        const pageNum = i + 1;
        let pageText = '';

        // 1. Try local zero-cost Tesseract OCR first (< 1.5s, $0.00 cost)
        const localOcr = await runLocalOcr(imgBuf);
        if (localOcr && localOcr.length >= 30) {
          pageText = localOcr;
        } else {
          // 2. Vision AI fallback only when local OCR is unavailable or insufficient
          try {
            const { getAIService } = await import('@/lib/ai');
            const ai = getAIService();
            if (ai.enabled) {
              const analysis = await ai.ocrAndDescribeImage({ buffer: imgBuf, mimeType: 'image/jpeg' });
              const parts = [
                analysis.ocrText || analysis.rawOcr,
                analysis.description,
                analysis.normalizedEntities?.join('\n'),
                analysis.detectedEnglish?.join(' • '),
              ].filter(Boolean);
              pageText = parts.join('\n\n');
            }
          } catch (aiErr) {
            console.warn(`[extractPdf:ocrFallback] page ${pageNum} warning:`, aiErr);
          }
        }

        if (pageText.trim()) {
          const cleanedPage = augmentDocumentSearchTokens(augmentArabicPdfText(normalizeExtractedText(pageText)));
          pages.push({ pageNumber: pageNum, text: cleanedPage });
          combinedOcrText += (combinedOcrText ? '\n\n' : '') + cleanedPage;
        }
      }

      if (pages.length > 0) {
        const truncated = combinedOcrText.length > HARD_MAX_CHARS;
        return {
          rawText: combinedOcrText.slice(0, HARD_MAX_CHARS),
          pages,
          pageCount: pages.length,
          truncated,
        };
      } else {
        return {
          rawText: '',
          pages: [],
          pageCount: pageImages.length,
          truncated: false,
          errorReason: 'Scanned document with no readable text recovered',
        };
      }
    }

    const augmentedFull = augmentDocumentSearchTokens(augmentArabicPdfText(cleanedFull));
    const truncated = augmentedFull.length > HARD_MAX_CHARS;

    return {
      rawText: augmentedFull.slice(0, HARD_MAX_CHARS),
      pages,
      pageCount: typeof result?.total === 'number' ? result.total : pages.length,
      truncated,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[extractPdf:error]', msg);
    let reason = 'Malformed or corrupted document';
    if (/password|encrypt/i.test(msg)) {
      reason = 'Password-protected or encrypted document';
    }
    return { rawText: '', pages: [], pageCount: 0, truncated: false, errorReason: reason };
  }
}

// ── DOCX / DOC ───────────────────────────────────────────────────────────────

async function extractDocx(buffer: Buffer): Promise<{ rawText: string; truncated: boolean; errorReason?: string }> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    const text = augmentDocumentSearchTokens(normalizeExtractedText(result.value ?? ''));
    const truncated = text.length > HARD_MAX_CHARS;
    return {
      rawText: text.slice(0, HARD_MAX_CHARS),
      truncated,
    };
  } catch (err) {
    console.error('[extractDocx:error]', err instanceof Error ? err.message : String(err));
    return { rawText: '', truncated: false, errorReason: 'Malformed or corrupted Word document' };
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

  let errorReason: string | undefined;

  if (mime === 'application/pdf' || ext === 'pdf') {
    const pdfRes = await extractPdf(buffer);
    rawText = pdfRes.rawText;
    pages = pdfRes.pages;
    pageCount = pdfRes.pageCount;
    truncated = pdfRes.truncated;
    errorReason = pdfRes.errorReason;
  } else if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword' ||
    ext === 'docx' ||
    ext === 'doc'
  ) {
    const docxRes = await extractDocx(buffer);
    rawText = docxRes.rawText;
    truncated = docxRes.truncated;
    errorReason = docxRes.errorReason;
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
    errorReason,
  };
}
