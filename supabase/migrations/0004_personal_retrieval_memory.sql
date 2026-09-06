-- ============================================================================
-- Remember — Personal Retrieval Memory Seed (0004)
-- ----------------------------------------------------------------------------
-- Adds persistent personal retrieval history and learned associations:
--   * `retrieval_events`: logs search queries, clicks, confirmations, and corrections.
--   * `personal_retrieval_associations`: learned per-user mappings between retrieval
--     cues and memories with reinforcement counts and recency tracking.
--   * Strict RLS on both tables: a user can only ever view and modify their own rows.
--
-- SAFE / ADDITIVE: does NOT modify existing memories or chunks tables.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLE: retrieval_events
-- Logs the event stream of user retrieval behavior.
-- ----------------------------------------------------------------------------
create table if not exists public.retrieval_events (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  memory_id         uuid references public.memories (id) on delete cascade,
  raw_query         text not null,
  normalized_query  text not null,
  language          text default 'auto',
  event_type        text not null check (event_type in ('search_result_open', 'confirmed_recovery', 'correction')),
  confidence        float not null default 0.5 check (confidence >= 0.0 and confidence <= 1.0),
  position          int,
  session_id        text,
  created_at        timestamptz not null default now()
);

comment on table public.retrieval_events is
  'User retrieval behavior event stream for personal recovery learning. Strictly private.';

-- ----------------------------------------------------------------------------
-- 2. TABLE: personal_retrieval_associations
-- The persistent mental bridge: "For this user, this cue recovered this memory."
-- ----------------------------------------------------------------------------
create table if not exists public.personal_retrieval_associations (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  memory_id           uuid not null references public.memories (id) on delete cascade,
  cue                 text not null,
  normalized_cue      text not null,
  weight              float not null default 1.0 check (weight >= 0.0),
  reinforcement_count int not null default 1 check (reinforcement_count >= 1),
  last_used_at        timestamptz not null default now(),
  source              text not null default 'recovery',
  created_at          timestamptz not null default now(),
  constraint uq_personal_retrieval_cue unique (user_id, memory_id, normalized_cue)
);

comment on table public.personal_retrieval_associations is
  'Persistent personal retrieval associations learned from confirmed recoveries. Strictly private.';

-- ----------------------------------------------------------------------------
-- 3. Row Level Security (RLS)
-- Strictly enforced per-user boundaries. No cross-user leakage is possible.
-- ----------------------------------------------------------------------------
alter table public.retrieval_events enable row level security;
alter table public.personal_retrieval_associations enable row level security;

-- retrieval_events RLS policies
drop policy if exists "retrieval_events_select_own" on public.retrieval_events;
create policy "retrieval_events_select_own"
  on public.retrieval_events for select
  using (user_id = auth.uid());

drop policy if exists "retrieval_events_insert_own" on public.retrieval_events;
create policy "retrieval_events_insert_own"
  on public.retrieval_events for insert
  with check (user_id = auth.uid());

drop policy if exists "retrieval_events_update_own" on public.retrieval_events;
create policy "retrieval_events_update_own"
  on public.retrieval_events for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "retrieval_events_delete_own" on public.retrieval_events;
create policy "retrieval_events_delete_own"
  on public.retrieval_events for delete
  using (user_id = auth.uid());

-- personal_retrieval_associations RLS policies
drop policy if exists "associations_select_own" on public.personal_retrieval_associations;
create policy "associations_select_own"
  on public.personal_retrieval_associations for select
  using (user_id = auth.uid());

drop policy if exists "associations_insert_own" on public.personal_retrieval_associations;
create policy "associations_insert_own"
  on public.personal_retrieval_associations for insert
  with check (user_id = auth.uid());

drop policy if exists "associations_update_own" on public.personal_retrieval_associations;
create policy "associations_update_own"
  on public.personal_retrieval_associations for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "associations_delete_own" on public.personal_retrieval_associations;
create policy "associations_delete_own"
  on public.personal_retrieval_associations for delete
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 4. Justified Performance Indexes
-- ----------------------------------------------------------------------------
-- Fast retrieval of user events in chronological sequence
create index if not exists retrieval_events_user_created_idx
  on public.retrieval_events (user_id, created_at desc);

-- Fast session reconstruction (for reformulation detection)
create index if not exists retrieval_events_user_session_idx
  on public.retrieval_events (user_id, session_id)
  where session_id is not null;

-- Foreign key lookup & cascade on memory deletion
create index if not exists retrieval_events_memory_id_idx
  on public.retrieval_events (memory_id);

-- Ultra-fast lookup of personal associations during search queries (< 2ms)
create index if not exists personal_retrieval_user_cue_idx
  on public.personal_retrieval_associations (user_id, normalized_cue);

-- Foreign key lookup & cascade on memory deletion
create index if not exists personal_retrieval_memory_id_idx
  on public.personal_retrieval_associations (memory_id);

-- ----------------------------------------------------------------------------
-- 5. Explicit Permissions for PostgREST Schema Cache & Roles
-- ----------------------------------------------------------------------------
grant all on table public.retrieval_events to postgres, anon, authenticated, service_role;
grant all on table public.personal_retrieval_associations to postgres, anon, authenticated, service_role;

