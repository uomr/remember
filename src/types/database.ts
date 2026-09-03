/**
 * TypeScript types mirroring the Postgres schema.
 * Source of truth:
 *   - supabase/migrations/0001_initial_foundation.sql
 *   - supabase/migrations/0002_semantic_search.sql
 *   - supabase/migrations/0003_document_intelligence.sql
 */

/** The four memory kinds supported in the MVP. */
export type MemoryType = 'image' | 'document' | 'link' | 'note';

/** Extraction processing status for document memories. */
export type ExtractionStatus = 'pending' | 'done' | 'failed' | 'skipped';

/** `public.profiles` — one row per user. */
export interface Profile {
  id: string; // uuid, equals auth.users.id
  display_name: string | null;
  created_at: string; // ISO timestamptz
  updated_at: string; // ISO timestamptz
}

/** `public.memories` — the core saved record. */
export interface Memory {
  id: string; // uuid
  user_id: string; // uuid -> auth.users.id
  type: MemoryType;
  title: string | null;
  text_content: string | null;
  url: string | null;
  created_at: string; // ISO timestamptz
  updated_at: string; // ISO timestamptz
  /** pgvector 1536-dimensional semantic embedding (or stringified array from RPC/REST) */
  embedding?: number[] | string | null;
  /** SHA-256 hash of original file bytes */
  file_hash?: string | null;
  /** SHA-256 hash of normalized extracted text */
  content_hash?: string | null;
  /** Version of document extraction algorithm */
  parser_version?: string | null;
  /** Status of document text extraction */
  extraction_status?: ExtractionStatus | null;
  /** Error message if extraction failed */
  extraction_error?: string | null;
  /** Total number of extracted chunks in memory_chunks */
  chunk_count?: number | null;
}

/** `public.memory_files` — file metadata; bytes live in the private bucket. */
export interface MemoryFile {
  id: string; // uuid
  memory_id: string; // uuid -> memories.id
  user_id: string; // uuid -> auth.users.id
  storage_path: string; // {user-id}/{memory-id}/{file-name}
  file_name: string;
  file_type: string | null; // MIME type
  file_size: number | null; // bytes
  created_at: string; // ISO timestamptz
}

/** `public.memory_chunks` — canonical searchable representation of document text. */
export interface MemoryChunk {
  id: string; // uuid
  memory_id: string; // uuid -> memories.id
  user_id: string; // uuid -> auth.users.id
  chunk_index: number;
  page_number: number | null;
  section_title: string | null;
  chunk_text: string;
  chunk_hash: string;
  word_count: number | null;
  embedding?: number[] | string | null;
  embedding_model?: string | null;
  embedding_version?: string | null;
  created_at: string; // ISO timestamptz
}

