/**
 * Document Intelligence types.
 *
 * Defines the contracts for deterministic document extraction, structure-aware
 * chunking, content identity, and search representation.
 */

export interface DocumentPage {
  /** 1-based page number */
  pageNumber: number;
  /** Plain text extracted from this page */
  text: string;
}

export interface DocumentSection {
  /** Section heading / title if detected */
  title?: string;
  /** Section plain text */
  text: string;
  /** Associated page number if known */
  pageNumber?: number;
}

export interface ExtractedDocument {
  /** Complete normalized plain text */
  rawText: string;
  /** Individual pages if format preserves page boundaries (e.g. PDF) */
  pages?: DocumentPage[];
  /** Total page count if known */
  pageCount?: number;
  /** SHA-256 hash of the original raw file bytes */
  fileHash: string;
  /** SHA-256 hash of the normalized extracted text */
  contentHash: string;
  /** Parser version used for extraction */
  parserVersion: string;
  /** True if the document text was truncated due to hard safety limits */
  truncated: boolean;
}

export interface DocumentChunk {
  /** 0-indexed sequence order within the document */
  chunkIndex: number;
  /** 1-based page number where this chunk originates (when available) */
  pageNumber?: number | null;
  /** Nearest section heading/title (e.g. from Markdown or DOCX) */
  sectionTitle?: string | null;
  /** Cleaned, searchable text of the chunk */
  chunkText: string;
  /** SHA-256 hash of the chunk text for change detection and embedding cache */
  chunkHash: string;
  /** Word count of chunkText */
  wordCount: number;
  /** Character count of chunkText */
  charCount: number;
}

export interface ChunkSearchResult {
  memoryId: string;
  chunkIndex: number;
  pageNumber: number | null;
  sectionTitle: string | null;
  chunkText: string;
  rank?: number;
}
