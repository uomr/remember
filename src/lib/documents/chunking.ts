/**
 * Structure-aware document chunking engine.
 *
 * Splitting hierarchy:
 *   Document
 *   → Page / Section (PDF page breaks, Markdown headings, DOCX paragraphs)
 *   → Paragraph (\n\n)
 *   → Sentence fallback (for oversized legal or continuous text blocks)
 *
 * Target chunk size: 300–500 words (~1,500–2,500 characters).
 * Overlap: 40–60 words (~200–300 characters) only across split continuous blocks.
 */

import { computeSha256 } from './identity';
import type { DocumentChunk, DocumentPage, ExtractedDocument } from './types';

// Target chunk constraints in words and characters
const TARGET_MIN_WORDS = 200;
const TARGET_MAX_WORDS = 400;
const TARGET_MAX_CHARS = 2000;
const OVERLAP_WORDS = 35;

/** Count whitespace-delimited words in a string. */
function countWords(text: string): number {
  const matches = text.trim().match(/[\p{L}\p{N}_\-]+/gu);
  return matches ? matches.length : 0;
}

/** Split a large paragraph into sentences based on punctuation. */
function splitSentences(paragraph: string): string[] {
  // Matches sentence endings (.!? followed by whitespace or line end), supporting unicode
  const sentences = paragraph.split(/(?<=[.!?؟])\s+/u).map((s) => s.trim()).filter(Boolean);
  return sentences.length > 0 ? sentences : [paragraph.trim()];
}

/**
 * Pack sentences or paragraphs into structure-aware chunks.
 */
function packTextUnits(
  units: string[],
  pageNumber: number | null,
  sectionTitle: string | null,
  startIndex: number,
): { chunks: DocumentChunk[]; nextIndex: number } {
  const chunks: DocumentChunk[] = [];
  let currentWords: string[] = [];
  let currentChunkText = '';
  let currentIndex = startIndex;

  function flushChunk() {
    const trimmed = currentChunkText.trim();
    if (!trimmed) return;

    const words = trimmed.split(/\s+/).filter(Boolean);
    chunks.push({
      chunkIndex: currentIndex++,
      pageNumber,
      sectionTitle,
      chunkText: trimmed,
      chunkHash: computeSha256(trimmed),
      wordCount: words.length,
      charCount: trimmed.length,
    });

    // Compute overlap words from the end of the current chunk for semantic continuity
    if (words.length > OVERLAP_WORDS) {
      currentWords = words.slice(-OVERLAP_WORDS);
      currentChunkText = currentWords.join(' ') + ' ';
    } else {
      currentWords = [];
      currentChunkText = '';
    }
  }

  for (const unit of units) {
    const unitWordCount = countWords(unit);

    // If unit itself is bigger than MAX_WORDS or MAX_CHARS, break into sentences
    if (unitWordCount > TARGET_MAX_WORDS || unit.length > TARGET_MAX_CHARS) {
      const sentences = splitSentences(unit);
      for (const sentence of sentences) {
        const sentenceWords = countWords(sentence);
        const prospectiveWords = countWords(currentChunkText) + sentenceWords;
        const prospectiveChars = currentChunkText.length + sentence.length;

        if (
          (prospectiveWords > TARGET_MAX_WORDS || prospectiveChars > TARGET_MAX_CHARS) &&
          (countWords(currentChunkText) >= TARGET_MIN_WORDS || currentChunkText.length >= 1000)
        ) {
          flushChunk();
        }

        currentChunkText = currentChunkText ? `${currentChunkText} ${sentence}` : sentence;
      }
    } else {
      const prospectiveWords = countWords(currentChunkText) + unitWordCount;
      const prospectiveChars = currentChunkText.length + unit.length;
      if (
        (prospectiveWords > TARGET_MAX_WORDS || prospectiveChars > TARGET_MAX_CHARS) &&
        (countWords(currentChunkText) >= TARGET_MIN_WORDS || currentChunkText.length >= 1000)
      ) {
        flushChunk();
      }
      currentChunkText = currentChunkText ? `${currentChunkText}\n\n${unit}` : unit;
    }
  }

  // Flush remaining text
  if (currentChunkText.trim()) {
    const trimmed = currentChunkText.trim();
    const words = trimmed.split(/\s+/).filter(Boolean);
    chunks.push({
      chunkIndex: currentIndex++,
      pageNumber,
      sectionTitle,
      chunkText: trimmed,
      chunkHash: computeSha256(trimmed),
      wordCount: words.length,
      charCount: trimmed.length,
    });
  }

  return { chunks, nextIndex: currentIndex };
}

/**
 * Chunk a multi-page document (such as PDF) where pages are known.
 * Each page is processed respecting its page boundary so page numbers are strictly preserved.
 */
function chunkPages(pages: DocumentPage[]): DocumentChunk[] {
  const allChunks: DocumentChunk[] = [];
  let chunkIndex = 0;

  for (const page of pages) {
    const rawPageText = page.text.trim();
    if (!rawPageText) continue;

    // Split page into paragraphs
    const paragraphs = rawPageText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const { chunks, nextIndex } = packTextUnits(paragraphs, page.pageNumber, null, chunkIndex);
    allChunks.push(...chunks);
    chunkIndex = nextIndex;
  }

  return allChunks;
}

/**
 * Chunk a single continuous or sectioned document (Markdown, DOCX, TXT).
 * Detects Markdown headings (# Section) if present to attach sectionTitle metadata.
 */
function chunkLinearDocument(text: string): DocumentChunk[] {
  const allChunks: DocumentChunk[] = [];
  let chunkIndex = 0;

  // Check if text has Markdown-style headings
  const sectionRegex = /(?:^|\n)(#{1,4}\s+[^\n]+)/g;
  const hasHeadings = sectionRegex.test(text);

  if (hasHeadings) {
    // Split by headings while capturing heading titles
    const sections: { title: string; body: string }[] = [];
    const lines = text.split('\n');
    let currentTitle = 'General';
    let currentBody: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
      if (headingMatch) {
        if (currentBody.length > 0) {
          sections.push({ title: currentTitle, body: currentBody.join('\n').trim() });
          currentBody = [];
        }
        const rawTitle = headingMatch && headingMatch[1] ? headingMatch[1] : 'General';
        currentTitle = rawTitle.trim();
      } else {
        currentBody.push(line);
      }
    }
    if (currentBody.length > 0) {
      sections.push({ title: currentTitle, body: currentBody.join('\n').trim() });
    }

    for (const section of sections) {
      if (!section.body) continue;
      const paragraphs = section.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      const { chunks, nextIndex } = packTextUnits(paragraphs, null, section.title, chunkIndex);
      allChunks.push(...chunks);
      chunkIndex = nextIndex;
    }
  } else {
    // Standard paragraph splitting
    const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const { chunks } = packTextUnits(paragraphs, null, null, chunkIndex);
    allChunks.push(...chunks);
  }

  return allChunks;
}

/**
 * Main structure-aware chunking function.
 *
 * Takes an ExtractedDocument and produces an array of DocumentChunk items
 * ready for PostgreSQL insertion and full-text search indexing.
 */
export function chunkDocument(document: ExtractedDocument): DocumentChunk[] {
  if (document.pages && document.pages.length > 0) {
    const pageChunks = chunkPages(document.pages);
    if (pageChunks.length > 0) return pageChunks;
  }

  return chunkLinearDocument(document.rawText);
}
