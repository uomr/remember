# Roadmap

Phased plan for **Remember**. Markers: **DONE**, **IN PROGRESS**, **NOT STARTED**.

---

## Phase 0 — Foundation — **DONE**

Repository, documentation, environment config, database + security foundation,
and a modular source skeleton. No user-facing features.

- **DONE** — Repo scaffold, tooling, and strict TypeScript config.
- **DONE** — Calm design tokens (Tailwind theme).
- **DONE** — Six mandatory docs + README (documentation-first).
- **DONE** — Supabase migration: `profiles`, `memories`, `memory_files`,
  RLS on all tables, `tsvector` full-text search + GIN index, triggers, storage
  policy SQL.
- **DONE** — PWA manifest with **Web Share Target**; placeholder service worker.
- **DONE** — Modular `src/` skeleton: layout, home shell, Supabase factories,
  config, AI abstraction (disabled), analytics stub, UI primitives, DB types.
- **DONE** — Phase 0 review and consistency pass.

---

## Phase 1 — Core MVP — **IN PROGRESS** (implemented; live verification pending)

The smallest lovable product: capture, store, find.

- **DONE** — Authentication (Supabase Auth, magic link / OTP), session
  handling via middleware, route protection.
- **DONE** — Capture flow for all four memory types: **image**,
  **document**, **link**, **note**.
- **DONE** — File upload to the private `memories` bucket with server-side
  MIME/size validation and orphan-safe rollback.
- **DONE** — Library UI: list with type-aware cards, detail view, delete
  (with Storage cleanup).
- **DONE** — Search UI wired to a **hybrid** predicate: full-text over the
  `tsvector` `search_vector` OR-ed with a Unicode-safe per-term substring pass
  (URL-synced, debounced, prefix matching). Matches words inside URLs and file
  names and works for non-Latin scripts (e.g. Arabic); verified live.
- **DONE** — Empty states for no-memories and no-results.
- **DONE** — `POST /share` route handler implementing the Web Share Target.
- **DONE** — Offset-based pagination ("Load more") for the library and search.
- **DONE** — Server-side magic-byte (file-signature) validation on uploads
  (`src/lib/memories/signatures.ts` + `verifyUpload`), so a renamed binary can't
  masquerade as an allowed type. Satisfies PRD §29.
- **DONE** — Installable PWA polish: real brand icons (SVG masters +
  rasterized PNG set), an `/offline` fallback page, and a network-first service
  worker with SWR for static assets.
- **DONE** — Live backend verification against a real Supabase project
  (`npm run verify:backend`: 40/40 — RLS isolation, private storage, delete
  cascade, and the search regression cases).
- **IN PROGRESS** — Interactive magic-link sign-in journey (human clicks the
  emailed link) — the only remaining manual check before Phase 1 ships.

---

## Phase 2 — Intelligence — **IN PROGRESS**

Make memories smarter — without compromising privacy or the disabled-by-default AI stance.

- **DONE** — Enable the AI abstraction layer with a real provider: **OpenRouter**
  (`src/lib/ai/providers/openrouter.ts`), resolved by `getAIService()` when
  `AI_PROVIDER=openrouter` + `OPENROUTER_API_KEY` are set; model via
  `OPENROUTER_MODEL` (default `google/gemini-2.5-flash`). See ADR-007.
- **DONE** — Image OCR **and** description, run as non-blocking post-save
  enrichment (`enrichImageMemory`, `src/app/actions/enrich.ts`) folded into
  `memories.text_content`, so images are findable by what's in them via the
  existing hybrid search. Stays a no-op when AI is disabled/unconfigured.
- **NOT STARTED** — Text extraction for documents (PDF/DOCX) — `extractText` is
  declared on the provider but not implemented yet.
- **NOT STARTED** — Auto-titles from the AI description.
- **NOT STARTED** — `memory_metadata` table (tags, entities, source).
- **NOT STARTED** — `search_embeddings` (pgvector) for semantic / hybrid search
  (`embed` declared, not implemented).
- **NOT STARTED** — Proper service worker strategy (Workbox), background sync.

---

## Phase 3 — Growth — **NOT STARTED**

Retention, reach, and delight.

- **NOT STARTED** — Collections / tags / lightweight organization.
- **NOT STARTED** — Reminders and resurfacing ("remember this later").
- **NOT STARTED** — Sharing a memory / read-only links.
- **NOT STARTED** — Import from other tools; export / data portability.
- **NOT STARTED** — Onboarding refinement and empty-state guidance.

---

## Phase 4 — Monetization — **NOT STARTED**

Sustainable, privacy-respecting revenue.

- **NOT STARTED** — Free vs Pro tiers (storage quota, advanced search, AI).
- **NOT STARTED** — Billing integration.
- **NOT STARTED** — Usage limits and quota enforcement.
- **NOT STARTED** — Team / shared spaces (exploratory).
