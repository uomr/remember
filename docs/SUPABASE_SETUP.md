# Supabase Provisioning Runbook & Handoff Log

> **Purpose.** This is the single source of truth for connecting **Remember** to
> a live Supabase project. It is written so that if this session (or the IDE/AI)
> stops at any point, **another agent can read this file and resume from the
> exact next unchecked step** — with zero re-work and no lost context.
>
> **Golden rules for whoever continues:**
>
> 1. Do the steps **in order**. Each has a checkbox and a status in the
>    **PROVISIONING LOG** at the bottom. Trust the log over assumptions.
> 2. **Secrets NEVER go in git.** Real keys/tokens live only in
>    `Remember/.env.local` (gitignored). Do not paste them into this file, any
>    doc, or any commit. This file records _what was done_, never the secret
>    values.
> 3. After each completed step, tick its box here and append a dated line to the
>    PROVISIONING LOG. Then update `docs/PROJECT_STATUS.md` if state changed.
> 4. If a step fails, record the error verbatim in the LOG and stop — do not
>    improvise around a half-applied migration.

---

## 0. What the app actually needs (derived from code)

| Variable | Used by | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `src/lib/supabase/{server,client,middleware}.ts` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same | public anon key (safe for browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | `src/lib/supabase/server.ts` (`createServiceRoleClient`) | **server-only secret**; not used by any current feature but the factory reads it |
| `AI_PROVIDER` | `src/lib/config.ts` | keep `disabled` for the MVP |

Nothing else is required to run Phase 1. The migration to apply is
`supabase/migrations/0001_initial_foundation.sql` (tables + RLS + FTS + triggers
+ private `memories` storage bucket + storage policies).

---

## 1. What I need from you (pick ONE path)

### PATH A — Autonomous (recommended; I do all the DB work)

Give me these (paste the token in chat; I will store it **only** in `.env.local`
and never commit it):

1. **Project ref** — the ID in your project URL `https://<REF>.supabase.co`.
   (Create an empty project first in the Supabase dashboard — no tables needed.)
2. **Supabase Personal Access Token (PAT)** — from
   `https://supabase.com/dashboard/account/tokens`. I use it against the
   **Management API** to run the migration, read the API keys, and set the auth
   redirect URLs. **Revoke it after we finish** (I'll remind you).
3. **App origin(s)** for the auth redirect allow-list. Default assumed:
   `http://localhost:3000`. Add a production URL later if/when you deploy.
4. (Optional) An **email address** to receive the magic-link during the live test.

With that, I will (via `https://api.supabase.com`):
- `POST /v1/projects/{ref}/database/query` → run migration `0001`.
- `GET  /v1/projects/{ref}/api-keys` → read anon + service_role keys.
- `PATCH /v1/projects/{ref}/config/auth` → enable email, set `site_url` +
  `uri_allow_list` (include `<origin>/auth/callback`).
- Write `Remember/.env.local`, then typecheck + run a verification pass.

### PATH B — You keep the token (fallback; you run the SQL)

If you'd rather not share a PAT:
1. In the dashboard, open **SQL Editor** and run the full contents of
   `supabase/migrations/0001_initial_foundation.sql`.
2. **Storage → Buckets**: confirm a **private** bucket named `memories` exists
   (the migration creates it; if not, create it with Public = OFF).
3. **Authentication → URL Configuration**: set Site URL to your origin and add
   `<origin>/auth/callback` to the redirect allow-list. Enable the **Email**
   provider (magic link).
4. Paste me **Project URL**, **anon key**, and **service_role key** — I'll write
   `.env.local` and run the verification pass. (Or fill `.env.local` yourself
   from `.env.example` and just tell me it's done.)

---

## 2. Ordered provisioning checklist (resume point = first unchecked box)

- [x] **S1. Credentials received** — Path A: ref `ddywznezwcizvccpbvdr` + PAT (redacted) + origin `http://localhost:3000`.
- [x] **S2. Migration `0001` applied** — via `scripts/provision-supabase.mjs`.
- [x] **S3. RLS verified enabled** — `memories`/`memory_files`/`profiles` all `relrowsecurity=true`; 16 policies (public+storage). Live REST check on `/rest/v1/memories` with anon returned `[]`.
- [x] **S4. Full-text index** `memories_search_vector_idx` (GIN) exists.
- [x] **S5. Private `memories` storage bucket** exists, `public=false`.
- [x] **S6. Auth configured** — Email enabled; `site_url=http://localhost:3000`, `uri_allow_list=http://localhost:3000,http://localhost:3000/**`.
- [x] **S7. `.env.local` written** — URL + anon + `AI_PROVIDER=disabled` + `SUPABASE_SERVICE_ROLE_KEY` (sb_secret_…). Gitignored.
- [x] **S8. Typecheck passes** (`node_modules/.bin/tsc --noEmit` → exit 0).
- [x] **S9. App boots** (`npm run dev`, Ready) and `/` redirects to `/sign-in` when signed out (verified: served `app/sign-in/page.js`).
- [ ] **S10. Critical User Journey** — needs the user to click the magic-link email: sign in → capture → see it → search → open → delete.
- [ ] **S11. PAT** — token line removed from `.env.local`; **user must still REVOKE the PAT** at `https://supabase.com/dashboard/account/tokens`.

---

## 3. Exact commands / requests (so any agent can reproduce)

> Replace `{ref}` with the project ref. The PAT goes in the `Authorization`
> header only — read it from `.env.local` (`SUPABASE_ACCESS_TOKEN`), never inline
> it into a committed file.

**Apply the migration (Management API):**
`POST https://api.supabase.com/v1/projects/{ref}/database/query`
Header: `Authorization: Bearer <PAT>`
Body: `{ "query": "<full contents of supabase/migrations/0001_initial_foundation.sql>" }`

**Read API keys:**
`GET https://api.supabase.com/v1/projects/{ref}/api-keys`  → find `anon` and `service_role`.

**Configure auth:**
`PATCH https://api.supabase.com/v1/projects/{ref}/config/auth`
Body (example): `{ "site_url": "http://localhost:3000", "uri_allow_list": "http://localhost:3000/**", "external_email_enabled": true, "mailer_otp_enabled": true }`

**Verify RLS blocks anonymous reads (from the app machine):**
`GET {SUPABASE_URL}/rest/v1/memories?select=*` with header `apikey: <anon>` →
must return `[]` (no session) — proving RLS is on.

**Local verification:**
```
cd Remember
node_modules/.bin/tsc --noEmit
npm run dev   # then open http://localhost:3000
```

`.env.local` template (values filled at S7 — DO NOT COMMIT):
```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
AI_PROVIDER=disabled
# Temporary, only while provisioning via Management API; remove after S11:
SUPABASE_ACCESS_TOKEN=<personal access token>
```

---

## 4. Rollback / safety notes

- The migration is mostly idempotent (`if not exists` / `on conflict`), **except
  `create policy`** which errors if the policy already exists. If re-applying,
  drop the specific policy first or ignore "already exists" policy errors.
- If S2 partially fails, do **not** blindly re-run — inspect which objects exist
  (`select tablename from pg_tables where schemaname='public';` and
  `select policyname from pg_policies;`) and record findings in the LOG.
- Never expose `service_role` to the browser. Only `NEXT_PUBLIC_*` reaches the
  client (enforced by Next.js env rules).

---

## PROVISIONING LOG (append-only; newest at bottom)

- `2026-08-30` — Runbook created. Phase 1 code complete and typechecking clean.
  **State: awaiting credentials (S1).** No Supabase project connected yet;
  `.env.local` does not exist. Next action: obtain Path A (ref + PAT + origin)
  or Path B (URL + anon + service_role), then start at **S2**.
- `2026-08-30` — Received **project ref `ddywznezwcizvccpbvdr`** and a valid
  **publishable (anon) key**. Verified via `GET /auth/v1/settings` (200 OK):
  **Email provider enabled** (`email:true`), signups allowed
  (`disable_signup:false`), `mailer_autoconfirm:false`. Wrote `Remember/.env.local`
  with URL + anon key + `AI_PROVIDER=disabled` (service_role + PAT left as
  commented placeholders; both gitignored). **S1 = partial:** still need a way to
  run DDL — either a **PAT** (Path A → Management API) or the user runs the
  migration in the SQL Editor (Path B). **Blocked at S2 pending that choice.**
  Note: `site_url`/redirect allow-list for `/auth/callback` not yet verified (S6).
- `2026-08-30` — User chose Path A and supplied a PAT (hidden from the agent by
  the platform's secret redaction — good). Built one-time provisioner
  **`scripts/provision-supabase.mjs`** that reads `SUPABASE_ACCESS_TOKEN` from
  env or `.env.local` and performs S2→S7 via the Management API (never prints
  secrets). **Resume point:** get the PAT into the local environment, then run
  `node scripts/provision-supabase.mjs` from `Remember/`. Either add
  `SUPABASE_ACCESS_TOKEN=<PAT>` to `.env.local`, or run with the env var inline.
  After it prints `DONE`, continue at **S8** (typecheck/boot/journey), then
  **S11** (remove the token + revoke the PAT).
- `2026-08-30` — **Provisioning succeeded.** Script output: S2 OK; S3 RLS all
  true + 16 policies; S4 index present; S5 bucket private; S6 auth OK; S7
  stored `SUPABASE_SERVICE_ROLE_KEY` (sb_secret_…). Verified live: anon
  `GET /rest/v1/memories` → `[]`; `tsc --noEmit` → exit 0; `npm run dev` Ready.
  **Bug found & fixed:** `middleware.ts` was at the project root, which Next.js
  **ignores when a `src/` dir exists**, so `/` served the home page to anon.
  Moved it to **`src/middleware.ts`** and deleted the root copy; re-tested `/`
  → now serves `app/sign-in/page.js` (redirect working). Removed the
  `SUPABASE_ACCESS_TOKEN` line from `.env.local` (remaining vars: URL, anon,
  AI_PROVIDER, service_role). **State: S1–S9 done.** Remaining: **S10** (user
  clicks magic-link email and runs the full journey) and **S11** (user REVOKES
  the PAT in the dashboard). The dev server may still be running on :3000.
