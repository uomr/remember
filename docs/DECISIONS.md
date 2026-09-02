# Architectural Decision Records

Each decision follows the format: **Decision / Why / Alternatives considered /
Why rejected / Consequences.** Newest decisions can be appended at the bottom.

---

## ADR-001 — Next.js (App Router) + Supabase

- **Decision:** Build the app with Next.js using the App Router, backed by
  Supabase for Postgres, Auth, and Storage.
- **Why:** One coherent, well-documented stack that covers frontend, auth,
  database, and file storage with minimal glue. App Router gives server-first
  data access and easy PWA hosting on Vercel. Supabase provides Postgres (real
  SQL, RLS) plus batteries-included Auth and Storage.
- **Alternatives considered:** Pages Router; a custom Node/Express API + a
  separate Postgres host; Firebase.
- **Why rejected:** Pages Router lacks server components / modern data patterns.
  A hand-rolled backend adds undifferentiated work. Firebase's NoSQL model makes
  full-text search and relational integrity harder and weakens data ownership.
- **Consequences:** We lean on RLS as the security boundary and on Supabase SSR
  helpers for session handling. Vendor coupling to Supabase is accepted in
  exchange for speed; the DB is still standard Postgres and portable.

## ADR-002 — Postgres full-text search (tsvector) for MVP search

- **Decision:** Use Postgres full-text search (a generated `tsvector`
  `search_vector` column + GIN index) for MVP search. Do **not** use `LIKE`, and
  do **not** add semantic/vector search yet.
- **Why:** `tsvector` gives real relevance-ranked, stemmed, tokenized search with
  zero AI cost and no extra infrastructure. It is generated in the database, so
  it stays correct automatically. `LIKE '%term%'` cannot use an index well and
  gives poor relevance. Semantic/vector search is premature before there is data
  or a proven need.
- **Alternatives considered:** `ILIKE`/`LIKE` scanning; an external search engine
  (Elasticsearch/Meilisearch/Typesense); immediate pgvector embeddings.
- **Why rejected:** `LIKE` doesn't scale or rank. External engines add ops burden
  and cost for an MVP. pgvector adds AI cost/complexity with no evidence it's
  needed yet — it is explicitly deferred to Phase 2.
- **Consequences:** Excellent, cheap keyword search now. A clear, additive
  upgrade path later: add `search_embeddings` (pgvector) alongside FTS for hybrid
  search without reworking the schema.

## ADR-003 — AI abstraction layer, disabled in the MVP

- **Decision:** Access all AI through a single `AIService` interface
  (`src/lib/ai/`). Ship a disabled no-op provider by default (`AI_PROVIDER=disabled`).
- **Why:** Keeps AI optional, swappable, and cost-controlled. The UI depends on an
  interface, never a vendor SDK, so providers can change without UI churn. It also
  keeps the privacy-first promise: nothing is sent anywhere by default.
- **Alternatives considered:** Call a provider SDK directly from features; build no
  AI seam at all.
- **Why rejected:** Direct SDK calls scatter vendor lock-in and secrets across the
  codebase and make disabling AI hard. No seam at all would force a painful
  refactor later.
- **Consequences:** A tiny indirection cost now; large flexibility later. Every
  feature calls `getAIService()` and tolerates a disabled provider gracefully.

## ADR-004 — Private storage buckets + RLS as the security boundary

- **Decision:** Store files in a **private** Supabase bucket (`memories`) with a
  path prefix of the user id, and enforce access with RLS on both tables and
  storage objects (`user_id = auth.uid()` / path-prefix match).
- **Why:** RLS enforces isolation in the database itself, so a bug in application
  code cannot leak another user's data. Private buckets ensure files are never
  publicly reachable; access is mediated by policy or signed URLs.
- **Alternatives considered:** Public bucket with obscure URLs; enforcing access
  only in application code.
- **Why rejected:** "Unguessable URL" is not security. App-layer-only checks fail
  open on the first missed check. RLS fails closed by default.
- **Consequences:** Every table needs correct policies (verified in the migration).
  File access requires signed URLs or server-mediated reads; slightly more work,
  much stronger guarantees.

## ADR-005 — PWA Web Share Target for low-friction capture

- **Decision:** Ship an installable PWA that registers a **Web Share Target**
  (`POST /share`, `multipart/form-data`, accepting title/text/url and files).
- **Why:** The core promise depends on capture being effortless. Registering as a
  share target lets users send content to Remember from any app's native share
  sheet — the lowest-friction capture path on mobile.
- **Alternatives considered:** Manual paste/upload only; a native mobile app;
  browser extensions.
- **Why rejected:** Manual-only capture adds friction that undermines the promise.
  A native app is far more effort and duplicates the web app. Extensions are
  desktop-centric and don't cover mobile share.
- **Consequences:** The manifest declares `share_target`; a `POST /share` route
  handler must be implemented (Phase 1). The service worker must eventually handle
  the share POST for the installed experience.

## ADR-006 — Documentation-first workflow

- **Decision:** Write and maintain documentation (`docs/` + `README`) before and
  alongside implementation. `PROJECT_STATUS.md` is kept current every session.
- **Why:** The project is phased and may be picked up by different people/agents.
  Accurate docs let anyone resume with zero context, prevent architectural drift,
  and make decisions auditable (this ADR file).
- **Alternatives considered:** Code-first with docs added later; no formal docs.
- **Why rejected:** Deferred docs rot and rarely get written. No docs makes
  handoff and consistency impossible on a multi-phase project.
- **Consequences:** A small ongoing writing cost. In return: reliable handoffs,
  a durable rationale trail, and a consistent, calm product direction.

## ADR-007 — OpenRouter as the first real AI provider (Phase 2)

- **Decision:** Implement the first concrete `AIService` (ADR-003) against
  **OpenRouter** (`src/lib/ai/providers/openrouter.ts`), resolved by
  `getAIService()` when `AI_PROVIDER=openrouter` and `OPENROUTER_API_KEY` is set.
  The active model is env-driven (`OPENROUTER_MODEL`, default
  `google/gemini-2.5-flash`). First capability shipped: **image enrichment**
  (OCR + description) folded into `memories.text_content` so images become
  searchable by their contents.
- **Why:** OpenRouter exposes an **OpenAI-compatible** Chat Completions API and
  brokers many vision-capable models behind **one key and one billing account**.
  That lets us change the underlying model with a single env var — zero code
  change, no vendor lock-in — which is exactly the flexibility ADR-003's seam
  exists to preserve. It also keeps secrets in one server-only place.
- **Alternatives considered:** Wiring a single vendor SDK directly (OpenAI,
  Anthropic, or Google); self-hosting an OCR model (e.g. Tesseract / a local
  vision model).
- **Why rejected:** A single-vendor SDK re-introduces the lock-in ADR-003 was
  built to avoid and makes model comparison costly. Self-hosting OCR adds ops
  burden and infra cost unproven at this stage; it can still be added later as
  another provider behind the same interface.
- **Consequences:** Enrichment runs **server-side only**, **after** the memory is
  saved, from a separate non-awaited request (`enrichImageMemory`), so AI never
  blocks or breaks capture and stays a no-op when disabled/unconfigured. Images
  are sent to OpenRouter via short-lived **signed URLs** — a privacy trade-off
  accepted for Phase 2 intelligence and disabled by default. `extractText`
  (documents) and `embed` (pgvector semantic search) are declared on the provider
  but intentionally not implemented yet; they are later Phase 2 steps.
