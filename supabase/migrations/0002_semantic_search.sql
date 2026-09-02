-- ============================================================================
-- Remember — Semantic search foundation (0002)
-- ----------------------------------------------------------------------------
-- Adds MEANING-BASED (vector) search alongside the existing lexical search.
--   * Enables the pgvector extension.
--   * Adds memories.embedding vector(1536)  (OpenAI text-embedding-3-small).
--   * HNSW cosine index for fast approximate-nearest-neighbour search.
--   * match_memories() RPC — RLS-safe semantic search (SECURITY INVOKER).
--
-- SAFE / ADDITIVE: does NOT touch 0001. `embedding` is nullable, so every
-- existing row and all current queries keep working unchanged until rows are
-- embedded. Re-runnable (IF NOT EXISTS / CREATE OR REPLACE).
-- ============================================================================

create extension if not exists vector;

alter table public.memories
  add column if not exists embedding vector(1536);

comment on column public.memories.embedding is
  'Semantic-search embedding (text-embedding-3-small, 1536d, cosine). NULL until enriched.';

-- Approximate-nearest-neighbour index for cosine distance. m / ef_construction
-- tuned for a personal-scale dataset (fast to build, lean memory footprint).
create index if not exists memories_embedding_hnsw_idx
  on public.memories using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ----------------------------------------------------------------------------
-- RPC: semantic nearest-neighbour search over the CALLER's own memories.
-- SECURITY INVOKER = the existing RLS policy on `memories` still applies, so a
-- user can only ever match their own rows. Returns ids + cosine similarity; the
-- app then fetches full rows (and signs files) via its normal RLS-guarded read.
-- ----------------------------------------------------------------------------
create or replace function public.match_memories(
  query_embedding vector(1536),
  match_count int default 24,
  similarity_threshold float default 0.0
)
returns table (id uuid, similarity float)
language sql
stable
security invoker
set search_path = public
as $$
  select
    m.id,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.memories m
  where m.embedding is not null
    and (1 - (m.embedding <=> query_embedding)) >= similarity_threshold
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

comment on function public.match_memories is
  'RLS-safe semantic search: the caller''s memory ids ordered by cosine similarity to query_embedding.';
