# Architecture

This document describes the system design of **Remember**. It is intentionally
modular: each concern lives behind a small, well-defined boundary so no single
file becomes a monolith.

## System overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (PWA)                          │
│  Next.js App Router · React · Tailwind · Service Worker      │
│  - Installable, mobile-first                                 │
│  - Web Share Target → POST /share (capture from OS)          │
└───────────────┬─────────────────────────────┬───────────────┘
                │ (@supabase/ssr)              │ (server actions /
                │  browser client              │  route handlers)
                ▼                              ▼
        ┌───────────────┐            ┌──────────────────────┐
        │  Supabase Auth │            │  Next.js Server       │
        │  (magic link / │            │  (RSC, route handlers)│
        │   OTP)         │            │  service-role only    │
        └───────┬────────┘            │  server-side          │
                │                     └──────────┬───────────┘
                ▼                                ▼
        ┌───────────────────────────────────────────────┐
        │                 Supabase                       │
        │  Postgres (RLS)   ·   Storage (private bucket)  │
        │  profiles / memories / memory_files            │
        │  tsvector full-text search + GIN index         │
        └───────────────────────────────────────────────┘
                                ▲
                                │ (isolated, disabled in MVP)
                       ┌────────┴─────────┐
                       │  AI abstraction   │
                       │  layer (no-op)    │
                       └───────────────────┘
```

## Frontend

- **Next.js App Router.** Routing via the `src/app/` directory.
- **Server Components by default.** Data fetching and privileged reads happen in
  Server Components / route handlers. Client Components are opt-in (`'use client'`)
  and used only where interactivity is required (search field, buttons, SW
  registration).
- **Server vs client Supabase:**
  - `src/lib/supabase/server.ts` — for Server Components, server actions, and
    route handlers (uses cookies via `@supabase/ssr`).
  - `src/lib/supabase/client.ts` — for Client Components in the browser.
  - The **service role key is only ever used server-side** and never imported
    into a Client Component.
- **Styling:** Tailwind with a small calm design-token theme. No purple
  gradients, no neon, no card-in-card. Mobile-first, generous spacing.

## Backend (Supabase)

Supabase provides three managed services used here:

1. **Postgres** — the system of record. All tables carry a `user_id` and are
   guarded by RLS.
2. **Auth** — passwordless (magic link / OTP). A trigger auto-creates a
   `profiles` row for each new `auth.users` record.
3. **Storage** — a **private** bucket named `memories` holding user files.

## Database

Three tables in Phase 0 (full detail in [`DATABASE.md`](DATABASE.md)):

- `profiles` — one row per user, keyed by `auth.users.id`.
- `memories` — the core record; typed as `image | document | link | note`, with
  a **generated `tsvector` `search_vector`** over `title`, `text_content`, and
  `url`, indexed with GIN for fast full-text search.
- `memory_files` — file records attached to a memory (storage path, size, type).

Future (not yet created): `memory_metadata`, `search_embeddings` (pgvector).

## Authentication flow

1. User enters an email; Supabase Auth sends a **magic link / OTP**.
2. On verification, Supabase issues a session (stored in cookies via `@supabase/ssr`).
3. A Postgres trigger (`handle_new_user`) inserts a `profiles` row on first sign-up.
4. Server Components read the session server-side; RLS enforces per-user access
   on every query regardless of the client.

> Auth **screens** are Phase 1 — only the DB trigger and client factories exist now.

## Storage flow

- Bucket `memories` is **private** (no public reads).
- Path pattern: **`{user-id}/{memory-id}/{file-name}`**.
- Storage RLS policies allow a user to read/write **only** objects whose first
  path segment equals their `auth.uid()`.
- Uploads are validated **server-side** for MIME type and size (see
  `src/lib/config.ts`) before a `memory_files` row is written.

## AI processing flow

- AI is an **isolated abstraction layer** (`src/lib/ai/`). The rest of the app
  depends only on the `AIService` interface — never on a concrete provider.
- The default provider is a **disabled no-op**; `AI_PROVIDER=disabled` in the MVP.
- When enabled later, providers (OCR, image description, text extraction,
  embeddings) plug in behind the same interface without touching the UI.
- AI never runs on the client and never blocks capture.

## Security model

- **RLS everywhere.** Every user table enables RLS with `user_id = auth.uid()`
  (`profiles` uses `id = auth.uid()`). This is the primary security boundary.
- **Private storage** keyed on the user-id path prefix.
- **Secret hygiene.** The service role key is server-only and never shipped to
  the browser. Only `NEXT_PUBLIC_*` values reach the client.
- **Least privilege.** Client uses the anon key; privileged operations run
  server-side.
- **Privacy-conscious analytics.** The analytics stub emits only typed,
  content-free events — it never receives memory content.
