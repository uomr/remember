-- ============================================================================
-- Remember — Initial foundation migration (0001)
-- ----------------------------------------------------------------------------
-- Creates the Phase 0 schema: profiles, memories, memory_files.
--
-- SECURITY MODEL
--   * Row Level Security (RLS) is ENABLED on every table below.
--   * Every policy is keyed on auth.uid() so a user can only ever read/write
--     their own rows (profiles: id = auth.uid(); others: user_id = auth.uid()).
--
-- STORAGE (must be set up alongside this migration)
--   * Create a PRIVATE storage bucket named "memories" (no public access).
--       - Supabase Dashboard → Storage → New bucket → name "memories",
--         "Public bucket" = OFF.
--       - Or via SQL below (storage.buckets insert) if you prefer.
--   * Files are stored at the path pattern:  {user-id}/{memory-id}/{file-name}
--   * Storage RLS policies (included at the bottom of this file) restrict access
--     so a user can only touch objects whose first path segment equals their
--     auth.uid(). This is the security boundary for files.
-- ============================================================================

-- gen_random_uuid() lives in pgcrypto (available on Supabase by default).
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Shared helper: keep updated_at fresh on UPDATE.
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- TABLE: profiles
-- One row per user, mirrored from auth.users.
-- ============================================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is 'Per-user profile, auto-created on sign-up. id = auth.users.id.';

alter table public.profiles enable row level security;

-- RLS: a user can only see/modify their own profile row.
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (id = auth.uid());

create policy "profiles_update_own"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_delete_own"
  on public.profiles for delete
  using (id = auth.uid());

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ============================================================================
-- TABLE: memories
-- The core record. Full-text searchable via a generated tsvector column.
-- ============================================================================
create table if not exists public.memories (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  type          text not null check (type in ('image', 'document', 'link', 'note')),
  title         text,
  text_content  text,
  url           text,
  -- Generated, stored full-text search vector over the human-readable fields.
  -- Delivers ranked, stemmed keyword search with zero AI cost.
  search_vector tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' ||
      coalesce(text_content, '') || ' ' ||
      coalesce(url, '')
    )
  ) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.memories is 'Core saved memory (image|document|link|note) with full-text search_vector.';

-- GIN index powers fast full-text search on search_vector.
create index if not exists memories_search_vector_idx
  on public.memories using gin (search_vector);

-- Fast per-user listing, newest first.
create index if not exists memories_user_created_idx
  on public.memories (user_id, created_at desc);

alter table public.memories enable row level security;

create policy "memories_select_own"
  on public.memories for select
  using (user_id = auth.uid());

create policy "memories_insert_own"
  on public.memories for insert
  with check (user_id = auth.uid());

create policy "memories_update_own"
  on public.memories for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "memories_delete_own"
  on public.memories for delete
  using (user_id = auth.uid());

create trigger memories_set_updated_at
  before update on public.memories
  for each row execute function public.set_updated_at();

-- ============================================================================
-- TABLE: memory_files
-- Metadata for files attached to a memory. Bytes live in Storage.
-- ============================================================================
create table if not exists public.memory_files (
  id            uuid primary key default gen_random_uuid(),
  memory_id     uuid not null references public.memories (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  storage_path  text not null,
  file_name     text not null,
  file_type     text,
  file_size     bigint,
  created_at    timestamptz not null default now()
);

comment on table public.memory_files is 'Files attached to a memory. storage_path = {user-id}/{memory-id}/{file-name} in the private "memories" bucket.';

create index if not exists memory_files_memory_idx
  on public.memory_files (memory_id);

create index if not exists memory_files_user_idx
  on public.memory_files (user_id);

alter table public.memory_files enable row level security;

create policy "memory_files_select_own"
  on public.memory_files for select
  using (user_id = auth.uid());

create policy "memory_files_insert_own"
  on public.memory_files for insert
  with check (user_id = auth.uid());

create policy "memory_files_update_own"
  on public.memory_files for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "memory_files_delete_own"
  on public.memory_files for delete
  using (user_id = auth.uid());

-- ============================================================================
-- AUTH TRIGGER: auto-create a profile row for each new user.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', null))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- STORAGE: private "memories" bucket + path-prefix RLS policies.
-- ----------------------------------------------------------------------------
-- Creating the bucket via SQL (id must equal name). "public" = false keeps it
-- private. If you prefer, create it in the Dashboard instead and skip this insert.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('memories', 'memories', false)
on conflict (id) do nothing;

-- Objects are namespaced by user id as the first path segment:
--   {user-id}/{memory-id}/{file-name}
-- storage.foldername(name)[1] is that first segment.

create policy "memories_objects_select_own"
  on storage.objects for select
  using (
    bucket_id = 'memories'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "memories_objects_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'memories'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "memories_objects_update_own"
  on storage.objects for update
  using (
    bucket_id = 'memories'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'memories'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "memories_objects_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'memories'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- FUTURE (NOT created here — see docs/DATABASE.md, ADR-002):
--   * memory_metadata     — flexible per-memory metadata / tags.
--   * search_embeddings    — pgvector embeddings for semantic/hybrid search.
-- ============================================================================
