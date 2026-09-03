-- ============================================================================
-- Remember — Document Intelligence Foundation (0003)
-- ----------------------------------------------------------------------------
-- Adds deep document retrieval capabilities ($0 AI cost lexical baseline):
--   * Content & parser identity fields on `memories` (file_hash, content_hash, parser_version).
--   * `memory_chunks` table for structure-aware, page-attributed document segments.
--   * Stored `search_vector tsvector` per chunk using the 'simple' dictionary for unstemmed/exact matches.
--   * GIN index on chunk search_vector for fast deep-page retrieval (e.g. page 47).
--   * Strict RLS on memory_chunks: user can only see/modify their own chunks.
--
-- SAFE / ADDITIVE: does NOT alter existing rows or existing hybrid search.
-- Nullable columns and cascade delete ensure zero orphaned data.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Identity & extraction lifecycle fields on `memories`
-- ----------------------------------------------------------------------------
alter table public.memories
  add column if not exists file_hash text,
  add column if not exists content_hash text,
  add column if not exists parser_version text default 'v1',
  add column if not exists extraction_status text check (extraction_status in ('pending', 'done', 'failed', 'skipped')),
  add column if not exists extraction_error text,
  add column if not exists chunk_count int default 0;

comment on column public.memories.file_hash is 'SHA-256 hash of original file bytes for change and duplicate detection.';
comment on column public.memories.content_hash is 'SHA-256 hash of normalized extracted text for chunk freshness.';
comment on column public.memories.parser_version is 'Version of extraction algorithm; allows deterministic reprocessing.';
comment on column public.memories.extraction_status is 'Status of background document processing (pending|done|failed|skipped).';

-- Fast lookup for duplicate files and identity freshness
create index if not exists memories_file_hash_idx
  on public.memories (user_id, file_hash)
  where file_hash is not null;

-- ----------------------------------------------------------------------------
-- 2. TABLE: memory_chunks
-- Canonical searchable representation of extracted document text.
-- Implementation detail — never exposed directly in the UI as chunks.
-- ----------------------------------------------------------------------------
create table if not exists public.memory_chunks (
  id                uuid primary key default gen_random_uuid(),
  memory_id         uuid not null references public.memories (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  chunk_index       int not null,
  page_number       int,
  section_title     text,
  chunk_text        text not null,
  chunk_hash        text not null,
  word_count        int,
  -- Stored tsvector using 'simple' dictionary: indexes exact tokens, code, numbers,
  -- and non-English scripts without stemmer corruption. Delivers $0 AI deep retrieval.
  search_vector     tsvector generated always as (
    to_tsvector('simple', coalesce(chunk_text, ''))
  ) stored,
  -- Nullable semantic fields prepared for M2B selective expansion
  embedding         vector(1536),
  embedding_model   text,
  embedding_version text,
  created_at        timestamptz not null default now()
);

comment on table public.memory_chunks is
  'Structure-aware document chunks for deep lexical and semantic search. Internal implementation detail.';

-- ----------------------------------------------------------------------------
-- 3. Row Level Security (RLS) on memory_chunks
-- Strictly mirrors the memories security boundary: user can only touch their own.
-- ----------------------------------------------------------------------------
alter table public.memory_chunks enable row level security;

drop policy if exists "chunks_select_own" on public.memory_chunks;
create policy "chunks_select_own"
  on public.memory_chunks for select
  using (user_id = auth.uid());

drop policy if exists "chunks_insert_own" on public.memory_chunks;
create policy "chunks_insert_own"
  on public.memory_chunks for insert
  with check (user_id = auth.uid());

drop policy if exists "chunks_update_own" on public.memory_chunks;
create policy "chunks_update_own"
  on public.memory_chunks for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "chunks_delete_own" on public.memory_chunks;
create policy "chunks_delete_own"
  on public.memory_chunks for delete
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 4. Justified Indexes on memory_chunks
-- ----------------------------------------------------------------------------
-- GIN index on search_vector: powers lightning-fast sub-sentence keyword/phrase lookup
create index if not exists memory_chunks_search_vector_idx
  on public.memory_chunks using gin (search_vector);

-- Foreign key lookup and cascading delete acceleration
create index if not exists memory_chunks_memory_id_idx
  on public.memory_chunks (memory_id);

-- User-scoped chunk retrieval
create index if not exists memory_chunks_user_idx
  on public.memory_chunks (user_id);

-- Deterministic chunk identity & change detection
create index if not exists memory_chunks_chunk_hash_idx
  on public.memory_chunks (user_id, chunk_hash);
