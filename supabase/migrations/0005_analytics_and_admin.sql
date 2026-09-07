-- ============================================================================
-- MIGRATION: 0005_analytics_and_admin.sql
-- Lightweight, non-blocking telemetry and Admin v1 foundation.
-- DOES NOT apply or depend on migration 0004.
-- ============================================================================

-- Table for system and user activity telemetry
create table if not exists public.analytics_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  event_type  text not null,
  memory_id   uuid references public.memories(id) on delete set null,
  query       text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.analytics_events is 'Lightweight telemetry events for search intelligence and operational observability. Admin-only reads, fail-safe async writes.';

-- Performance indexes for dashboard aggregations and time-series rollups
create index if not exists idx_analytics_events_created_at
  on public.analytics_events (created_at desc);

create index if not exists idx_analytics_events_type_created
  on public.analytics_events (event_type, created_at desc);

create index if not exists idx_analytics_events_user_created
  on public.analytics_events (user_id, created_at desc);

-- RLS Enforcement
alter table public.analytics_events enable row level security;

-- Inserts: Any authenticated user (or service role) can record an event
create policy "analytics_events_insert_own"
  on public.analytics_events for insert
  with check (auth.uid() = user_id or auth.uid() is null);

-- Reads: Strictly restricted to service role or admin. Normal users cannot read analytics.
create policy "analytics_events_select_service_role"
  on public.analytics_events for select
  using (auth.jwt()->>'role' = 'service_role');
