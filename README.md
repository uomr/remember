# Remember

> **Save anything. Forget where you saved it. Find it when you need it.**

**Remember** is a privacy-first personal memory PWA. Capture images, documents,
links, and notes with almost zero friction — including straight from your phone's
OS share sheet — and find them instantly with fast full-text search. Your data is
private by default and isolated per-user at the database and storage layer.

> **Status:** Phase 0 — Foundation (in progress). This repository currently
> contains the project scaffold, documentation, database foundation, and clearly
> marked source stubs. Auth screens, capture flow, and the library UI are **not**
> built yet. See [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md).

## Tech stack

| Layer      | Choice                                                         |
| ---------- | -------------------------------------------------------------- |
| Framework  | Next.js (App Router)                                           |
| Language   | TypeScript (strict)                                            |
| Styling    | Tailwind CSS (calm, warm, minimal design tokens)               |
| Backend    | Supabase — Postgres, Auth, Storage                             |
| Security   | Row Level Security (RLS) + private storage buckets             |
| Search     | Postgres full-text search (`tsvector` + GIN) — no AI cost      |
| Capture    | Installable PWA + Web Share Target                             |
| AI         | Isolated abstraction layer, **disabled by default in the MVP** |

## Getting started

### 1. Prerequisites

- Node.js 20+ (`.nvmrc` is provided — run `nvm use`)
- A Supabase project (free tier is fine)

### 2. Install

```bash
npm install
```

### 3. Configure environment

Copy the example env file and fill in your Supabase values:

```bash
cp .env.example .env.local
```

| Variable                        | Scope         | Description                                                       |
| ------------------------------- | ------------- | ----------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Public/client | Your Supabase project URL.                                        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public/client | Supabase anon key (safe to expose; RLS protects data).           |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Server only** | Full-access key. **Never expose to the client.**                |
| `AI_PROVIDER`                   | Server        | AI provider flag. Defaults to `disabled` in the MVP.              |

### 4. Set up the database

Run the SQL migration and create the private storage bucket — see
[`supabase/README.md`](supabase/README.md).

### 5. Run the dev server

```bash
npm run dev        # start Next.js on http://localhost:3000
npm run lint       # eslint
npm run typecheck  # tsc --noEmit (strict)
npm run build      # production build
```

## Deployment overview

- **Frontend:** deploy to **Vercel**. Set the same environment variables in the
  Vercel project settings (public vars + the server-only service role key).
- **Backend:** **Supabase** hosts Postgres, Auth, and Storage. Apply the
  migration in `supabase/migrations/` and create the private `memories` bucket.
- Ensure `SUPABASE_SERVICE_ROLE_KEY` is set **only** as a server-side env var,
  never with a `NEXT_PUBLIC_` prefix.

## Documentation

All project documentation lives in [`docs/`](docs/):

- [`PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) — current state (read this first).
- [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system, data, and security design.
- [`DECISIONS.md`](docs/DECISIONS.md) — architectural decision records.
- [`DATABASE.md`](docs/DATABASE.md) — schema, columns, relationships, RLS.
- [`ROADMAP.md`](docs/ROADMAP.md) — phased plan and feature lists.

## Philosophy

Documentation-first. Phased. Modular — no giant monolith. The UI is calm,
premium, and minimal (no purple gradients, no neon, no card-in-card clutter).
Privacy is a default, not a setting.
