# Project Status

> **Read this first.** This file is the single source of truth for the current
> state of the project. It is written so that a person or AI agent with **zero
> prior context** can understand exactly where things stand and what to do next.

- **Product:** Remember — privacy-first personal memory PWA.
- **Promise:** _Save anything. Forget where you saved it. Find it when you need it._
- **Current phase:** **Phase 1 (Core MVP) feature-complete & backend-proven (40/40); Phase 2 (Intelligence) in progress — image OCR + bilingual description via OpenRouter, and now MEANING-BASED (semantic) search: every memory carries a pgvector embedding and search fuses lexical + semantic recall. Typecheck clean. The interactive magic-link journey (S10) is still the only manual Phase-1 check left.**
- **Semantic search (Phase 2, LIVE):** migration `0002_semantic_search.sql` adds pgvector, `memories.embedding vector(1536)` (OpenAI `text-embedding-3-small`), an HNSW cosine index, and the RLS-safe `match_memories()` RPC. Enrichment stores an embedding; existing rows were backfilled (6/6). `searchMemories` now uses a **three-stage intelligent pipeline**: lexical + vector candidate retrieval → RRF candidate fusion → an intent-aware language-model reranker that reads the candidate evidence and returns only genuinely relevant memories. This fixes cosine-noise failures seen live: `جزمة` now returns only the two footwear images (never `JJJJ`), while `حذاء اسود` / `شوز اسود` returns only the actually black shoe. If the AI judge fails, the app conservatively falls back to exact lexical results rather than exposing weak semantic noise.
- **AI (Phase 2):** OFF by default. Enable by adding to `.env.local`: `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY=sk-or-…` (optional `OPENROUTER_MODEL`, default `google/gemini-2.5-flash`). With those set, saving an image triggers non-blocking OCR + description that make it text-searchable. No key → the app behaves exactly as before.
- **Live Supabase:** migrations `0001` and `0002` are applied; RLS is on, the storage bucket is private, email auth is configured, and `match_memories()` is verified live. Backend verification previously completed end-to-end with `npm run verify:backend` (two throwaway users, 40 assertions). See `docs/SUPABASE_SETUP.md`.
- **Stack:** Next.js (App Router) · TypeScript (strict) · Tailwind CSS · Supabase (Postgres/Auth/Storage/RLS) · PWA

---

## Completed

**Phase 0 — Foundation**

- Repository scaffold, tooling, design tokens, the six mandatory docs.
- Database foundation `supabase/migrations/0001_initial_foundation.sql`
  (`profiles`, `memories`, `memory_files`), RLS on every table, generated
  `tsvector` full-text `search_vector` + GIN index, triggers, private
  `memories` storage bucket + storage RLS.
- PWA manifest + placeholder service worker, modular `src/` skeleton, typed
  Supabase client/server factories, `config`, AI abstraction (disabled),
  analytics stub, UI primitives.

**Phase 1 — Core MVP**

- **Authentication (magic link / OTP):**
  - `src/lib/supabase/middleware.ts` (`updateSession`) refreshes the session on
    every request and gates protected routes; root `middleware.ts` wires it with
    a static-asset/PWA matcher.
  - `src/app/sign-in/page.tsx` + `src/components/auth/SignInForm.tsx` —
    passwordless email sign-in with loading / sent / error states.
  - `src/app/auth/callback/route.ts` — exchanges the code for a session, safe
    relative-redirect only, friendly error bounce to `/sign-in?error=auth`.
  - `src/app/actions/auth.ts` (`signOut`) + `src/components/auth/SignOutButton.tsx`.
- **Capture flow:**
  - `src/app/actions/memories.ts` — `createMemory(formData)` for note / link /
    image / document, with server-side validation, private Storage upload,
    orphan-safe rollback, and `deleteMemory(id)` that also removes Storage
    objects. Never fakes success.
  - **Optional note/caption on image & document uploads:** the capture sheet now
    shows an optional "Add a note" field for files; when provided it is stored in
    `text_content` (indexed by the hybrid search) and rendered as a caption on the
    detail page. Fills the gap where an uploaded image was only findable by its
    file name — directly serves the PRD "find it by what you remember" promise.
    Kept optional so capture stays fast (no forced naming).
  - `src/lib/memories/validation.ts` — type/size checks, URL normalization,
    safe file names.
  - `src/components/capture/CaptureButton.tsx` — calm modal capture sheet
    (type picker + per-type forms) with full loading/success/error handling.
- **Library, detail, search:**
  - `src/lib/memories/queries.ts` — RLS-guarded `listMemories`,
    `searchMemories` (**hybrid**: prefix full-text over `search_vector` OR-ed with
    a per-term Unicode-safe `ilike` substring pass over title/url/text_content),
    `getMemory`, with short-lived signed URLs for private files.
  - `src/components/memories/{MemoryCard,MemoryList,DeleteMemoryButton}.tsx`,
    `src/components/search/SearchBar.tsx` (URL-synced, debounced), and a
    rewritten `src/app/page.tsx` home (greeting, search, capture, recent).
  - `src/app/memory/[id]/page.tsx` — detail view per type + delete.
  - `src/lib/format.ts` — date/size formatting helpers.
  - Empty states for both "no memories yet" and "no search results".
- Content-free analytics events wired (`memory_created`, `memory_deleted`,
  `search_started`).
- **Upload security — magic-byte validation:** `src/lib/memories/signatures.ts`
  reads a file's real leading bytes and reconciles them with the declared MIME
  type; `verifyUpload` (in `validation.ts`) composes the MIME/size gate with the
  signature check and is used by `createMemory` (so the `/share` route inherits
  it). Closes PRD §29 "don't trust MIME types blindly."
- **Installable PWA polish:** on-brand `public/icons/icon.svg` +
  `icon-maskable.svg` masters, rasterized to the PNG set
  (192 / 512 / maskable-512 / apple-touch-180 / favicon-32) by
  `scripts/generate-icons.mjs` (`npm run icons`, `sharp` devDep). `/offline`
  fallback page + a network-first service worker (`public/sw.js`) with an offline
  navigation fallback and stale-while-revalidate for static assets. Icons wired
  into `metadata.icons` in `src/app/layout.tsx`.

## In progress

- Interactive magic-link sign-in journey (S10): a human clicks the emailed link
  and confirms sign in → capture → see → search → open → delete in the browser.
  The backend half of this journey is already proven headlessly (see below).

## Verified live

`npm run verify:backend` (`scripts/verify-backend.mjs`) provisions two throwaway
users and exercises the real app logic against the live Supabase project, then
deletes everything it created. Last run: **40 passed, 0 failed.** It proves:

- **RLS isolation** — user B cannot list, fetch-by-id, search, delete, or spoof
  into user A's memories/profiles; storage RLS blocks cross-prefix read/write and
  signed-URL minting.
- **Storage** — private bucket rejects the public URL; signed URLs serve the
  exact bytes; delete cascades to `memory_files` with no orphaned objects.
- **Search (regression-guarded)** — the hybrid predicate finds words *inside* a
  URL path (`black shoes`) and a file name (`invoice`), handles Arabic
  (`أسود`, `الحذاء الأسود`), stays precise (nonsense → 0), and is inert against
  injected PostgREST operators / SQL-ish input. Drift guards fail loudly if
  `queries.ts` and the harness diverge.

## Not built yet (deferred by design)

- Advanced service worker features (Workbox, background sync). → Phase 2.
  (A hand-rolled network-first + SWR worker already ships — see below.)
- Document text extraction (`extractText` for PDF/DOCX) + auto-titles +
  `memory_metadata` (extracted tags/entities). → Phase 2/3.
- Link title/preview enrichment (currently uses the hostname).

_Done:_ OCR + bilingual image description, and **semantic search** (pgvector
`embedding` + `match_memories()` RPC + hybrid RRF in `searchMemories`) now ship —
see the semantic-search session summary below.

## Known bugs

- None open. The three bugs a prior "no known bugs — verified" claim had missed
  were found by live testing and are now fixed **and** re-verified live:
  1. **Search ignored words inside URLs/file names** — Postgres tokenizes
     `example.com/black-shoes` as one token, so full-text alone returned 0 for
     `black shoes`. Fixed by the hybrid substring pass in `queries.ts`.
  2. **Arabic (any non-Latin) search returned nothing** — the old builder used
     `replace(/[^\w]/g,'')`, which strips every Arabic character, leaving an
     empty query. Fixed by a `\p{L}\p{N}` Unicode tokenizer.
  3. **`/offline` was auth-gated (307)** — the service worker could not cache it,
     so offline navigations had no fallback. Fixed by adding `/offline` to
     `PUBLIC_PATHS` in `src/lib/supabase/middleware.ts` (holds no user data;
     confirmed prerendered as static in `next build`).

## Technical debt

- Supabase types are hand-written in `src/types/database.ts`; consider
  `supabase gen types typescript` and wiring the `Database` generic.

_Resolved:_ `public/sw.js` is now a real network-first + SWR service worker;
upload validation now sniffs magic bytes (`src/lib/memories/signatures.ts`);
app icons are now a real generated set (`public/icons/`, `npm run icons`);
search now matches inside URLs/file names and works for Arabic (hybrid predicate
in `queries.ts`); `/offline` is reachable without auth; the backend is covered by
a permanent live harness (`npm run verify:backend`).

## Important next steps

1. Complete the remaining manual **Critical User Journey**: magic-link sign-in → capture each type → wait for image enrichment → search in Arabic and English → open → delete.
2. Add automated tests around the complete hybrid pipeline, especially `rankSearch`, RLS-scoped `match_memories`, timeout/fallback behavior, pagination beyond the 100-candidate pool, and malformed model JSON.
3. Reconcile stale secondary docs (`ARCHITECTURE.md`, `DATABASE.md`, `DECISIONS.md`, `ROADMAP.md`, `README.md`, `supabase/README.md`) with migration `0002` and the live AI/search implementation; this status file and `COMPLETE_TECHNICAL_HANDOFF_AND_AUDIT.md` describe the current implementation.
4. Address the concrete audit risks recorded in the Arabic handoff: reranker cost/latency and evidence size, background enrichment durability, storage-delete error handling, script drift, generated database types, and missing document extraction.
5. Confirm the one-time provisioning PAT has been revoked (S11). Never restore it unless another administrative migration must be applied, and remove/revoke it immediately afterward.

---

## LAST SESSION SUMMARY

**What happened:** Audited the previous session's "no known bugs — verified"
claim by testing against the live database instead of trusting it. Found **three
real bugs**, fixed all three, and then **re-verified live** — the fixes are now
proven by an automated harness, not asserted.

**Bugs found and fixed (all re-verified live):**

1. **Search couldn't match words inside URLs / file names.** Postgres treats
   `example.com/black-shoes` as one full-text token, so `black shoes` returned
   zero — the exact behavior the PRD's core promise depends on. Rebuilt
   `searchMemories` in `src/lib/memories/queries.ts` as a single-round-trip
   **hybrid**: full-text over `search_vector` OR-ed with a per-term
   (AND-of-ORs) `ilike` substring pass over title/url/text_content.
2. **Arabic search was completely dead.** The old builder stripped every Arabic
   character (`replace(/[^\w]/g,'')` → empty query → 0 rows). Replaced with a
   `\p{L}\p{N}` Unicode tokenizer that also acts as the injection boundary
   (drops every PostgREST/`ilike`-structural character).
3. **`/offline` was behind auth (307).** The service worker couldn't cache it,
   leaving no offline fallback. Added `/offline` to `PUBLIC_PATHS` in
   `src/lib/supabase/middleware.ts`; it exposes no user data and now prerenders
   as static in `next build`.

**Verification (this session, all live/real):**
- `npm run verify:backend` → **40 passed, 0 failed** against the live Supabase backend (two throwaway users, includes the three
  regression cases above + full RLS/storage isolation, self-cleaning).
- `npm run typecheck` → 0 errors.
- `npm run build` → success; `/offline` shown as `○ (Static)`.

**Files created:** `scripts/verify-backend.mjs` (permanent Node 20 verification
harness; mirrors the app's search predicate with drift guards).

**Files modified:** `src/lib/memories/queries.ts` (hybrid search + Unicode
tokenizer); `src/lib/supabase/middleware.ts` (`/offline` public);
`package.json` (`verify:backend` script); `docs/PROJECT_STATUS.md`,
`docs/ROADMAP.md`. Security: leaked provisioning PAT removed from `.env.local`.

**DO NOT TOUCH (stable):** `supabase/migrations/0001_initial_foundation.sql`
(schema + RLS), `src/lib/supabase/{server,client}.ts`,
`public/manifest.webmanifest`. When editing `src/lib/memories/queries.ts`, keep
`scripts/verify-backend.mjs` in sync — its drift guards will fail the run
otherwise (by design). NOTE: `src/lib/config.ts` and `src/lib/ai/*` were
**intentionally extended** this session (Phase 2 / ADR-007) — the AI seam is now
a live plug-in point, not frozen; keep changes additive and disabled-by-default.

---

## LAST SESSION SUMMARY (Phase 2 kickoff)

**What happened:** (1) Fixed a real gap the user hit in the capture flow, then
(2) started Phase 2 by wiring **OpenRouter** as the first real AI provider.

**Capture fix:** image/document uploads had no way to attach text. Added an
optional "Add a note" field (`CaptureButton.tsx`), stored it in `text_content`
(`memories.ts`), and rendered it as a caption on the detail page
(`memory/[id]/page.tsx`). Images are now findable by the user's own words.

**Phase 2 — image intelligence (OpenRouter, ADR-007):**
- `src/lib/config.ts` — added `AI_CONFIG` (provider/key/model/baseUrl/timeout,
  all env-driven) + `isAIConfigured()`.
- `src/lib/ai/providers/openrouter.ts` — new OpenAI-compatible provider:
  `ocr()` + `describeImage()` via a vision model; `extractText()`/`embed()`
  declared but intentionally deferred.
- `src/lib/ai/index.ts` — `getAIService()` now returns the OpenRouter provider
  when `AI_PROVIDER=openrouter` and a key is present; otherwise the safe no-op.
- `src/app/actions/enrich.ts` — new `enrichImageMemory(id)`: after an image is
  saved, best-effort OCR + description folded into `text_content`. Runs from a
  **separate, non-awaited** request fired by `CaptureButton`, so AI never blocks
  or breaks capture and is a pure no-op when disabled/unconfigured.

**Verification:** `node_modules/.bin/tsc --noEmit` → **0 errors**. Live backend
harness re-confirmed earlier this session: **40/40**. AI paths are guarded so the
app runs identically with no key.

**Files created:** `src/lib/ai/providers/openrouter.ts`, `src/app/actions/enrich.ts`.
**Files modified:** `src/lib/config.ts`, `src/lib/ai/index.ts`,
`src/components/capture/CaptureButton.tsx`, `src/app/actions/memories.ts`,
`src/app/memory/[id]/page.tsx`, `docs/{DECISIONS,ROADMAP,PROJECT_STATUS}.md`.

**NEXT RECOMMENDED STEP:**
1. To try AI: add `AI_PROVIDER=openrouter` + `OPENROUTER_API_KEY=sk-or-…` to
   `.env.local`, restart `npm run dev`, save an image, then search for a word
   that appears *inside* it.
2. Finish Phase 1: run the interactive **Critical User Journey** (S10) via the magic-link email, and confirm the old provisioning PAT is revoked (S11 — the app never needs it at runtime).
3. **Historical plan, partly completed:** document text extraction (`extractText`), auto-titles, and `memory_metadata` remain open; pgvector semantic search is now implemented by an embedding column on `memories` rather than a separate `search_embeddings` table.

---

## LAST SESSION SUMMARY (bilingual enrichment + backfill)

**Problem observed:** searching an image by an Arabic word (e.g. `شعار`) returned
"Nothing matched". Root causes found by inspecting the live DB: (1) existing
images had **no enriched text at all** (2 of 3 had 0 chars, 1 had only an 8-char
note) — enrichment only runs on *new* uploads and had never populated them; and
(2) the describe prompt produced **English-only** text, so an Arabic lexical
search could never match even after enrichment. AI itself was verified working
(`scripts/test-openrouter.mjs` → 200 OK, model transcribed the test image).

**Changes:**
- `src/lib/ai/providers/openrouter.ts` — `DESCRIBE_PROMPT` is now **bilingual**:
  the model returns an English line + an Arabic (العربية) line + a `Keywords:`
  line in BOTH languages, so the hybrid lexical search matches human queries in
  either language. Additive; AI still disabled-by-default.
- `scripts/backfill-enrich.mjs` — new one-off backfill that re-enriches EXISTING
  image memories (mirrors the app enrichment path: signed URL → base64 →
  describe + OCR → fold into `text_content`). `--all` re-does every image;
  default only touches under-enriched ones. Self-contained, reads `.env.local`,
  never prints the key.
- `scripts/diagnose-search.mjs`, `scripts/search-check.mjs` — read-only helpers
  to inspect which memories carry searchable text and to run the app's exact
  search predicate for a given query.

**Verified live:** backfill enriched all 3 images (`enriched=3, failed=0`).
Re-running the app's search predicate now returns: `شعار`→3, `logo`→3,
`قطع غيار`→3, `auto parts`→3, `gear`→2 (all were 0 before). `tsc --noEmit` clean.

**Historical note, now superseded:** at the end of that earlier session search was still lexical. Since then, migration `0002_semantic_search.sql` was applied, existing rows were backfilled with 1536-dimensional embeddings (**6 embedded, 0 skipped, 0 failed**), the live `match_memories()` RPC was verified, and `searchMemories` became lexical + vector retrieval fused with RRF and finalized by the intent-aware OpenRouter `rankSearch` judge. Current live Arabic checks: `جزمة` selected only the two footwear images; `حذاء اسود` and `شوز اسود` each selected only the black-shoe image. This paragraph is retained solely as history and must not be read as current status.
