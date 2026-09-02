/**
 * TypeScript types mirroring the Postgres schema.
 * Source of truth: supabase/migrations/0001_initial_foundation.sql
 *
 * TODO (Phase 1): consider generating these with `supabase gen types typescript`
 * once the schema stabilizes, and wire them into the Supabase client generics.
 */

/** The four memory kinds supported in the MVP. */
export type MemoryType = 'image' | 'document' | 'link' | 'note';

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
  // search_vector is a generated tsvector column; it is not selected into the app layer.
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
