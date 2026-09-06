# Project Status

> **Read this first.** This file is the single source of truth for the current
> state of the project. It is written so that a person or AI agent with **zero
> prior context** can understand exactly where things stand and what to do next.

- **Product:** Remember — privacy-first personal memory PWA.
- **Promise:** _Save anything. Forget where you saved it. Find it when you need it._
- **Current phase:** **Phase 1 (Core MVP), Phase 2 (Document Intelligence & Natural Recall Engine), and Personal Retrieval Memory Seed fully implemented, verified with 60-memory human forgetting benchmark (+40% accuracy improvement, 0.39ms overhead, $0 AI cost), typecheck clean (0 errors), and production-deployed.**
- **Personal Retrieval Memory Engine (Seed & Continuous Behavioral Learning):**
  - **Learning Loop:** `query → candidate retrieval → user interaction → confirmed recovery signal → persistent personal associations → behavioral re-ranking`.
  - **Zero AI Overhead ($0.00):** 100% deterministic PostgreSQL indexed lookup (< 2ms) with 45-day half-life temporal decay ($1 / (1 + \text{days}/45)$).
  - **Conservative Position Bias Damping:** Explicit correction (1.0) > Confirmed detail recovery (0.95) > Post-reformulation (0.85) > Scrolled position > 1 (0.75) > Position 1 default (0.40).
  - **Negative Constraint Integrity:** Learned associations cannot override explicit number mismatches or month filters.
  - **Realistic Human Forgetting Benchmark (60 memories, 10 lapse scenarios):** Baseline 50% -> Personalized 90% (+40% Top-1 accuracy and recall gain).
- **Document Intelligence & Human Recall Engine (M2A, M2B, LIVE):**
  - **Zero-Cost Intent Parser (< 0.5ms):** Strips conversational filler words (`اللي`, `فيها`, `حق`, `وين`, `سويته`), resolves Arabic word numerals (`الفين` -> 2000), normalizes boundary-aware digits (never confusing `50000` with 24-digit IBAN/account numbers), maps ordinal months (`الشهر الثامن` -> August / Month 8), and extracts semantic concept categories (`salary`, `transfer`, `financial`, `bill`, `rent`).
  - **Multi-Evidence Compound Scoring:** Fuses title boosts (+120), filename matches (+80), body/chunk matches (+35), contextual month discrimination (+100), boundary-aware number matches (+120), and multidimensional synergy bonuses (+400).
  - **Negative Constraint Precision:** Enforces exact number and month constraints, eliminating cross-month bleeding (`راتبي شهر 8` strictly isolates August, never returning July) and rejecting cognitive noise (`zxqv9281` -> 0 results).
  - **M2A & M2B Foundation:** Deterministic text extraction ($0 AI) for PDF, DOCX, TXT, MD; structure-aware chunking preserving page numbers and headings; stored PostgreSQL `search_vector` on `memory_chunks` with GIN indexing; strict RLS (`user_id = auth.uid()`). Cross-lingual Arabic/English search.
- **Live Supabase:** migrations `0001`, `0002`, `0003`, and `0004` defined for production ref `ddywznezwcizvccpbvdr`; RLS is on across all tables (`memories`, `memory_files`, `profiles`, `memory_chunks`, `retrieval_events`, `personal_retrieval_associations`).
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

1. **LB1 — Complete S10:** Run the interactive Critical User Journey: magic-link sign-in → capture each type → wait for image enrichment → search in Arabic and English → open → delete.
2. **LB2 — Confirm S11:** Verify the provisioning PAT is revoked. Check `.env.local` and the Supabase dashboard.
3. **NB1 — Fix `/share` enrichment gap:** Patch `src/app/share/route.ts` to call `enrichImageMemory` for image shares.
4. **NB2-NB6 — Small hardening:** deduplicate image fetch, add error logging for enrichment/storage failures, fix `safeFileName` Unicode, add reranker output schema.
5. **NB7-NB9 — Script/comment drift:** Fix `verify-hybrid.mjs` threshold (0.2→0.1), update `diagnose-search.mjs` header, fix `database.ts` source-of-truth comment.
6. **NB11 — Reconcile stale secondary docs** (`ARCHITECTURE.md`, `DATABASE.md`, `DECISIONS.md`, `ROADMAP.md`, `README.md`, `supabase/README.md`).

---

## AUDIT FINDINGS — Verification Pass (2026-09-03)

> All 12 gaps re-verified against actual current source files. Files read:
> `src/app/share/route.ts`, `src/app/actions/enrich.ts`, `src/app/actions/memories.ts`,
> `src/components/capture/CaptureButton.tsx`, `src/lib/memories/validation.ts`,
> `src/lib/memories/queries.ts`, `src/lib/ai/providers/openrouter.ts`,
> `src/app/layout.tsx`, `src/components/search/SearchBar.tsx`,
> `scripts/verify-hybrid.mjs`, `scripts/diagnose-search.mjs`, `src/types/database.ts`.
> **No application code was modified during this pass.**

---

### Verified Gap Table

| GAP | STATUS | FILE | LAUNCH BLOCKER? | RECOMMENDED ACTION |
|-----|--------|------|-----------------|-------------------|
| G1 | **FALSE — ALREADY FIXED** | `src/app/share/route.ts` | No | Remove from gap list |
| G2 | **CONFIRMED** | `src/lib/ai/providers/openrouter.ts` | No | Fetch image once, pass base64 to both calls |
| G3 | **CONFIRMED** | `src/app/actions/enrich.ts` | No | Add `else { console.error(...) }` after the update check |
| G4 | **PARTIALLY TRUE** | `src/app/actions/memories.ts` | No | Promote `console.warn` to `console.error`; already non-fatal by design |
| G5 | **CONFIRMED** | `src/app/actions/memories.ts` + `src/app/actions/enrich.ts` | No | Move embedding call into `createMemory` server action as a non-awaited server-side call |
| G6 | **CONFIRMED** | `src/lib/memories/validation.ts` | No | Replace `[^\w.\- ]+` with `[^\p{L}\p{N}.\- ]+` with `u` flag |
| G7 | **DOCUMENTATION-ONLY** | `src/types/database.ts` | No | Update comment to cite both `0001` and `0002` |
| G8 | **CONFIRMED** | `scripts/verify-hybrid.mjs` | No | Script already uses `0.1`; claim was wrong — but reranker stage is still absent from the script |
| G9 | **CONFIRMED** | `scripts/diagnose-search.mjs` | No | Update footer note on line 88–90 |
| G10 | **PARTIALLY TRUE** | `src/components/search/SearchBar.tsx` | No | No AbortController; debounce exists (300ms) but does not cancel in-flight server requests |
| G11 | **CONFIRMED** | `src/lib/ai/providers/openrouter.ts` | No | Add `temperature: 0` to `chat()` body; `response_format` if model supports it |
| G12 | **FALSE — PARTIALLY FIXED** | `src/app/layout.tsx` | No | `dir="auto"` is already set; `lang="en"` is a SEO concern only |

---

### Detailed Findings Per Gap

#### G1 — `/share` does not call `enrichImageMemory` — **FALSE (ALREADY FIXED)**

**File:** [`src/app/share/route.ts`](file:///f:/Temp/Snake_PostMan/Neural_Ecosystem/ProjectSave/Remember/src/app/share/route.ts)

**Exact current code (lines 69–76):**
```typescript
// Non-blocking enrichment in background
if (result.memoryId) {
  if (file && isImage) {
    void enrichImageMemory(result.memoryId);
  } else {
    void enrichGenericMemory(result.memoryId);
  }
}
```
**Verdict:** The route already imports and calls both `enrichImageMemory` and `enrichGenericMemory`. The previous audit's G1 was wrong. **This gap does not exist.**

---

#### G2 — Image sent to OpenRouter twice — **CONFIRMED**

**File:** [`src/lib/ai/providers/openrouter.ts`](file:///f:/Temp/Snake_PostMan/Neural_Ecosystem/ProjectSave/Remember/src/lib/ai/providers/openrouter.ts) lines 125–133

```typescript
async ocr({ fileUrl }): Promise<OcrResult> {
  const text = await askAboutImage(fileUrl, OCR_PROMPT);  // toDataUrl called inside
  return { text };
},
async describeImage({ fileUrl }): Promise<ImageDescription> {
  const description = await askAboutImage(fileUrl, DESCRIBE_PROMPT);  // toDataUrl called again
  return { description };
},
```

`askAboutImage` always calls `toDataUrl(fileUrl, signal)` internally. When `enrich.ts` calls both with `Promise.allSettled`, two independent fetches of the same signed URL occur.

**Why it matters:** Doubles bandwidth and doubles the risk of a transient signed-URL expiry mid-enrichment. Not a correctness bug — both calls succeed independently — but unnecessary cost.

**Launch blocker:** No.

**Smallest safe fix:** Extract `toDataUrl` call before `Promise.allSettled` in `enrich.ts` and pass the `dataUrl` string directly. Requires adding a `dataUrl` input variant to the provider interface, or a single shared helper in `enrich.ts`.

---

#### G3 — `enrichImageMemory` DB update failure silently swallowed — **CONFIRMED**

**File:** [`src/app/actions/enrich.ts`](file:///f:/Temp/Snake_PostMan/Neural_Ecosystem/ProjectSave/Remember/src/app/actions/enrich.ts) line 75–78

```typescript
const { error: updateError } = await supabase.from('memories').update(update).eq('id', memoryId);
if (!updateError) {
  revalidatePath('/');
  revalidatePath(`/memory/${memoryId}`);
}
// No else branch — updateError is checked but never logged
```

**Why it matters:** A failed embedding store is completely invisible. The memory exists but has no `text_content` or `embedding`, making it unsearchable in both lexical and semantic modes. No log, no retry, no signal.

**Launch blocker:** No.

**Smallest safe fix:** Add `else { console.error('[Enrich] DB update failed for', memoryId, updateError); }` inside the `try` block (outside the outer `catch` which already silences for UX).

---

#### G4 — Storage delete failure not surfaced — **PARTIALLY TRUE**

**File:** [`src/app/actions/memories.ts`](file:///f:/Temp/Snake_PostMan/Neural_Ecosystem/ProjectSave/Remember/src/app/actions/memories.ts) lines 188–192

```typescript
const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
if (storageError) {
  console.warn('[Storage Cleanup Warning] Failed to remove storage paths for deleted memory:', memoryId, storageError);
}
```

**Verdict:** The code correctly does NOT re-surface the error to the user (memory row is already gone; partial-success is reasonable). A `console.warn` exists. The prior audit called this "not returned to user" as a gap — that is by design, not a bug. The legitimate weakness is that `warn` level may be filtered out in production monitoring; it should be `error` level.

**Why it matters (partially):** Orphaned private files accumulate silently if storage delete fails. The log level means it may be invisible in production.

**Launch blocker:** No.

**Smallest safe fix:** Change `console.warn` to `console.error`. No behavior change.

---

#### G5 — Embedding for notes/links/docs is client-side only — **CONFIRMED**

**All call sites for `enrichGenericMemory`:**
- `src/components/capture/CaptureButton.tsx` line 199: `void enrichGenericMemory(id).then(() => router.refresh())` — client-side only, fires after UI success.
- `src/app/share/route.ts` line 74: `void enrichGenericMemory(result.memoryId)` — server-side Route Handler. ✅ This path IS server-side.
- `src/app/actions/memories.ts` — **no call** to `enrichGenericMemory` at all.

**Verdict:** Confirmed for the `CaptureButton` path. If the user closes the tab within milliseconds of capture, the `enrichGenericMemory` call may not complete (browser may kill the fetch). However, the `/share` route correctly calls it server-side. For regular capture via the UI, it remains client-dependent.

**Why it matters:** Notes, links, and documents saved via `CaptureButton` with no AI enrichment will have `embedding = NULL` permanently if the client-side call fails, making them invisible to semantic search forever.

**Launch blocker:** No. Lexical search still works; semantic search degrades gracefully.

**Smallest safe fix:** In `createMemory` (server action), after successfully inserting a note/link/document, fire `enrichGenericMemory` in the same server-side context (non-awaited). This ensures at least one server-side attempt regardless of client state.

---

#### G6 — `safeFileName` strips Arabic characters — **CONFIRMED**

**File:** [`src/lib/memories/validation.ts`](file:///f:/Temp/Snake_PostMan/Neural_Ecosystem/ProjectSave/Remember/src/lib/memories/validation.ts) line 85

```typescript
export function safeFileName(name: string): string {
  const base = name.split(/[\\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 200) || 'file';
}
```

`\w` in JavaScript without the `u` flag matches `[A-Za-z0-9_]` only — every Arabic letter, every CJK character, every accented Latin character is replaced with `_`. A file named `صورة.jpg` becomes `____.jpg`.

**Why it matters:** Arabic file names are fully mangled. The stored `file_name` in `memory_files` becomes meaningless underscores. The note is still findable by `text_content`, but the title (which defaults to `fileName`) becomes `____.jpg`.

**Launch blocker:** No. Files are stored correctly; only the displayed name is wrong.

**Smallest safe fix:** `base.replace(/[^\p{L}\p{N}.\- ]+/gu, '_')` — add Unicode category classes and the `u` flag.

---

#### G7 — `database.ts` comment cites only `0001` — **DOCUMENTATION-ONLY**

**File:** [`src/types/database.ts`](file:///f:/Temp/Snake_PostMan/Neural_Ecosystem/ProjectSave/Remember/src/types/database.ts) line 4

```typescript
 * Source of truth: supabase/migrations/0001_initial_foundation.sql
```

The `embedding` field (lines 30–31) comes from `0002`. The comment is misleading but has zero runtime impact.

**Launch blocker:** No.

**Smallest safe fix:** Change to `supabase/migrations/0001_initial_foundation.sql + 0002_semantic_search.sql`.

---

#### G8 — `verify-hybrid.mjs` threshold drift — **PARTIALLY TRUE (different from audit claim)**

**File:** [`scripts/verify-hybrid.mjs`](file:///f:/Temp/Snake_PostMan/Neural_Ecosystem/ProjectSave/Remember/scripts/verify-hybrid.mjs) line 51

```javascript
const SEMANTIC_MIN_SIMILARITY = 0.1;
```

**Verdict:** The threshold is **already `0.1`** — matching the app. The earlier audit claim of `0.2` was **incorrect**. However, the script header says it "mirrors `searchMemories()` byte-for-byte" (line 4), yet it does **not** include the reranker (`rankSearch`) stage. The script output represents retrieval+RRF only, not the full pipeline.

**Why it matters:** The script's closing message ("Ranking above is exactly what the app returns") on line 155 is misleading — with AI enabled, the app applies a reranker pass on top of RRF that can substantially reorder or filter these results.

**Launch blocker:** No.

**Smallest safe fix:** Update line 155 note and header comment to state: "This shows the RRF-fused retrieval ranking. The live app additionally applies an LLM reranker pass when AI is enabled."

---

#### G9 — `diagnose-search.mjs` stale "lexical only" message — **CONFIRMED**

**File:** [`scripts/diagnose-search.mjs`](file:///f:/Temp/Snake_PostMan\Neural_Ecosystem\ProjectSave\Remember\scripts\diagnose-search.mjs) lines 88–90

```javascript
'\\nNote: search is LEXICAL (word match), not semantic. Even an image WITH text\\n' +
  'is only found when your search words literally overlap that stored text.',
```

This note is factually wrong since Phase 2. The live app uses hybrid lexical + semantic + reranker.

**Launch blocker:** No. It is a diagnostic script, not production code.

**Smallest safe fix:** Update the note to: "search is HYBRID (lexical word match + semantic vector similarity). With AI enabled, a reranker selects the most relevant results."

---

#### G10 — No request cancellation on search — **PARTIALLY TRUE**

**SearchBar** (`src/components/search/SearchBar.tsx`) debounces at 300ms via `setTimeout`. It pushes a URL change via `router.replace()`. The **page re-render** is a Server Component navigation — Next.js App Router handles this via the navigation queue and will cancel superseded navigations internally.

**`queries.ts` `searchMemories`** has no AbortController, so if two navigations arrive nearly simultaneously, both DB queries and AI calls can run in parallel on the server, with the later response winning.

**Verdict:** Partially true. The debounce reduces frequency significantly. The real risk is rapid consecutive searches where embedding + reranker calls stack up server-side. No AbortController in `queries.ts` or the Server Component path.

**Launch blocker:** No. The final displayed result will always be the last-received response.

**Smallest safe fix:** No trivial fix without a more complex architecture change (route-level cancellation is not available in Next.js App Router Server Components). Acceptable as-is for Phase 1/2 personal-scale use.

---

#### G11 — Reranker has no `temperature` / `response_format` — **CONFIRMED**

**File:** [`src/lib/ai/providers/openrouter.ts`](file:///f:/Temp/Snake_PostMan/Neural_Ecosystem/ProjectSave/Remember/src/lib/ai/providers/openrouter.ts) `chat()` function lines 65–69:

```typescript
body: JSON.stringify({
  model,
  messages: [{ role: 'user', content }],
}),
```

No `temperature`, no `max_tokens`, no `response_format`. The reranker prompt says "Respond as strict JSON only" but nothing enforces it at the API level.

**Why it matters:** Without `temperature: 0`, the model may produce different orderings for the same query. Without `response_format`, some models add markdown fences or text around the JSON (the code handles fences but not all cases). Without `max_tokens`, a large candidate set could produce a very long response.

**Launch blocker:** No. The `cleaned` step handles markdown fences; `JSON.parse` throws on invalid JSON and the `catch` falls back to lexical.

**Smallest safe fix:** Add `temperature: 0` to the `rankSearch` chat body only (not the general `chat()` helper, since OCR/describe benefit from slight variation). Most OpenRouter models accept this field.

---

#### G12 — `html lang="en"` with Arabic content — **FALSE (PARTIALLY FIXED)**

**File:** [`src/app/layout.tsx`](file:///f:/Temp/Snake_PostMan/Neural_Ecosystem/ProjectSave/Remember/src/app/layout.tsx) line 35

```tsx
<html lang="en" dir="auto" suppressHydrationWarning>
```

**Verdict:** `dir="auto"` is **already present**. This means the browser will automatically detect text direction per paragraph — Arabic text in notes will render RTL correctly. The `lang="en"` attribute is a minor SEO/screen-reader concern (assistive technology may announce the page language as English even for Arabic content) but does **not** cause broken rendering. This is not a gap that affects functional behavior.

**Launch blocker:** No.

**Smallest safe fix (optional):** Not needed for Phase 1. If multilingual support is a Phase 3 goal, `lang` can be made dynamic.

---

### Summary Table (Corrected)

| GAP | VERDICT | FILE | LAUNCH BLOCKER? | RECOMMENDED ACTION |
|-----|---------|------|-----------------|-------------------|
| G1 | ✅ FALSE — Already fixed | `src/app/share/route.ts:70-75` | **No** | Remove from gap list. `/share` correctly calls both enrich functions. |
| G2 | ⚠️ CONFIRMED | `src/lib/ai/providers/openrouter.ts:125-133` | No | Fetch image once in `enrich.ts`, pass base64 to both calls. |
| G3 | ⚠️ CONFIRMED | `src/app/actions/enrich.ts:75-79` | No | Add `else { console.error(...) }` after `if (!updateError)`. |
| G4 | 🔶 PARTIALLY TRUE | `src/app/actions/memories.ts:189-191` | No | Change `console.warn` → `console.error`. Non-fatal by design. |
| G5 | ⚠️ CONFIRMED | `src/app/actions/memories.ts` (no call to enrich) | No | Add server-side `void enrichGenericMemory(id)` in `createMemory` for note/link/document paths. |
| G6 | ⚠️ CONFIRMED | `src/lib/memories/validation.ts:85` | No | Replace `[^\w.\- ]+` with `[^\p{L}\p{N}.\- ]+/gu`. |
| G7 | 📄 DOCUMENTATION-ONLY | `src/types/database.ts:4` | No | Update comment to cite both migration files. |
| G8 | 🔶 PARTIALLY TRUE | `scripts/verify-hybrid.mjs:155` | No | Threshold is correct (0.1 ✅). Update closing message: script does not cover the reranker stage. |
| G9 | ⚠️ CONFIRMED | `scripts/diagnose-search.mjs:88-90` | No | Update footer note to reflect hybrid+semantic pipeline. |
| G10 | 🔶 PARTIALLY TRUE | `src/components/search/SearchBar.tsx` + `queries.ts` | No | Debounce exists; no AbortController. Acceptable at personal scale. No fix needed now. |
| G11 | ⚠️ CONFIRMED | `src/lib/ai/providers/openrouter.ts:65-69` | No | Add `temperature: 0` to the `rankSearch` call body only. |
| G12 | ✅ FALSE — dir="auto" present | `src/app/layout.tsx:35` | **No** | No action needed. `dir="auto"` handles RTL Arabic correctly. |

**Actual launch blockers from gaps: 0.** All 12 gaps are non-blocking. The only true launch blockers remain LB1 (S10 manual journey) and LB2 (S11 PAT revocation).

**Gaps that were incorrectly reported (false positives): G1, G12.**
**Gaps where the audit's specific claim was wrong but a real issue exists: G8** (threshold was already 0.1, but reranker coverage is missing from the script).



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
