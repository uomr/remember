# Supabase setup

This folder holds the database foundation for **Remember**.

```
supabase/
  migrations/
    0001_initial_foundation.sql   # profiles, memories, memory_files + RLS + FTS + storage policies
```

## What the migration does

- Creates `profiles`, `memories`, and `memory_files`.
- **Enables RLS on all three tables** with `auth.uid()` policies.
- Adds a generated `tsvector` `search_vector` column on `memories` + a **GIN
  index** for full-text search.
- Adds `updated_at` triggers and a `handle_new_user()` trigger that auto-creates
  a `profiles` row on sign-up.
- Creates the **private** `memories` storage bucket and its path-prefix RLS
  policies.

## How to run the migration

### Option A — Supabase SQL Editor (quickest)

1. Open your project → **SQL Editor** → **New query**.
2. Paste the contents of `migrations/0001_initial_foundation.sql`.
3. Run it. Re-running is safe (uses `if not exists` / `on conflict`), though
   `create policy` will error if a policy already exists — drop it first if you
   re-apply.

### Option B — Supabase CLI

```bash
# from the project root (ProjectSave/Remember)
supabase link --project-ref <your-project-ref>
supabase db push
```

## Create the private storage bucket

The migration attempts to create the bucket via SQL. If you'd rather use the
Dashboard (or the SQL insert was skipped):

1. **Storage → New bucket.**
2. Name it exactly **`memories`**.
3. **Public bucket = OFF** (must stay private).
4. The object-level RLS policies in the migration then restrict access so each
   user can only touch objects under their own `{user-id}/…` path prefix.

## File path convention

Uploaded files use the path pattern:

```
{user-id}/{memory-id}/{file-name}
```

The first segment (`{user-id}`) is what the storage RLS policies check against
`auth.uid()`.

## Verify

- Tables exist: `profiles`, `memories`, `memory_files`.
- RLS is **enabled** on each (Dashboard → Table editor shows the shield, or query
  `pg_tables` / `pg_policies`).
- The `memories_search_vector_idx` GIN index exists.
- The `memories` bucket exists and is **private**.
