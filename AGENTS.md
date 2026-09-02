# AGENTS.md — read this first

You are an AI agent (any model / any IDE) picking up work on **Remember**, a
privacy-first personal-memory PWA. This file exists so you can **resume with zero
lost context and without the user re-supplying anything**.

## Start here (in order)

1. **`docs/PROJECT_STATUS.md`** — current state, what's done, what's next.
2. **`docs/SUPABASE_SETUP.md`** — the live provisioning runbook + append-only
   log. The **resume point is the first unchecked box** in its checklist.
3. **`docs/ARCHITECTURE.md`, `DECISIONS.md`, `DATABASE.md`, `ROADMAP.md`** — the
   "why" behind the design. Don't re-litigate decided things.

## Secrets & credentials policy (IMPORTANT — satisfies "don't re-ask each time")

- **All runtime secrets already live on disk in `Remember/.env.local`**
  (gitignored, persists across model/IDE switches). This holds
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `AI_PROVIDER`, and
  (when set) `SUPABASE_SERVICE_ROLE_KEY`. **Never ask the user to paste these
  again** — read/use the file. (AI file-readers may be blocked from opening
  dotfiles; that's fine — the running app loads them, and you can `echo` a var
  from a shell if you must confirm one exists.)
- A **Supabase Personal Access Token (PAT)** is needed **only once**, for initial
  database provisioning via the Management API. It is stored temporarily as
  `SUPABASE_ACCESS_TOKEN` in `.env.local`, and **revoked after step S11**. The
  application itself never uses a PAT. After provisioning, **no token is ever
  required again.**
- Never write any secret into a committed file, a doc, or chat output.

## Project facts

- Supabase project ref: **`ddywznezwcizvccpbvdr`** (URL
  `https://ddywznezwcizvccpbvdr.supabase.co`). Email/magic-link auth is enabled.
- Stack: Next.js 14 App Router · TypeScript (strict) · Tailwind · Supabase
  (`@supabase/ssr`). Phase 1 (Core MVP) code is **complete and typechecks
  clean**; the only remaining work is **connecting a live database** (see runbook).

## Conventions (do not drift)

- Strict TypeScript, no `any`. Import alias `@/…`.
- Calm design tokens only (surface / ink / accent / border); no purple gradients,
  no neon, no card-in-card. Mobile-first.
- Server Components by default; `'use client'` only when interactive.
- Security is enforced by **Postgres RLS**; middleware is only a UX gate.
- **DO NOT TOUCH without a documented reason:**
  `supabase/migrations/0001_initial_foundation.sql`,
  `src/lib/supabase/{server,client}.ts`, `src/lib/config.ts`, `src/lib/ai/*`,
  `public/manifest.webmanifest`.

## Commands

```
cd Remember
npm install                       # deps (already installed once)
node_modules/.bin/tsc --noEmit    # typecheck (must stay clean)
npm run dev                       # http://localhost:3000
```

## After any change

Update `docs/PROJECT_STATUS.md` (and `docs/SUPABASE_SETUP.md` if provisioning
state changed), then keep this file accurate. Small, safe, documented steps.
