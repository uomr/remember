# Database

Postgres schema for **Remember**, hosted on Supabase. The authoritative source
is the migration at
[`../supabase/migrations/0001_initial_foundation.sql`](../supabase/migrations/0001_initial_foundation.sql).
**Row Level Security (RLS) is enabled on every table**, and every policy is keyed
on `auth.uid()` so a user can only ever touch their own rows.

## Entity relationships

```
auth.users (Supabase-managed)
   │ 1
   ├──────────────► profiles         (id = auth.users.id)
   │ 1           1
   └──────────────► memories         (memories.user_id = auth.users.id)
                        │ 1
                        └────────────► memory_files  (memory_files.memory_id → memories.id, ON DELETE CASCADE)
```

---

## Table: `profiles`

**Purpose:** One row per user, created automatically on sign-up. Holds
user-facing profile data separate from the private `auth.users` table.

| Column         | Type          | Notes                                             |
| -------------- | ------------- | ------------------------------------------------- |
| `id`           | `uuid`        | **PK**, references `auth.users(id)` on delete cascade. Equals `auth.uid()`. |
| `display_name` | `text`        | Optional display name.                            |
| `created_at`   | `timestamptz` | Default `now()`.                                  |
| `updated_at`   | `timestamptz` | Maintained by the `updated_at` trigger.           |

**RLS:** `SELECT/INSERT/UPDATE/DELETE` allowed only where `id = auth.uid()`.

**Automation:** `handle_new_user()` inserts a `profiles` row after each new
`auth.users` record.

---

## Table: `memories`

**Purpose:** The core record — a single saved "memory" of one of four types.
Search runs against this table.

| Column          | Type          | Notes                                                                 |
| --------------- | ------------- | --------------------------------------------------------------------- |
| `id`            | `uuid`        | **PK**, `default gen_random_uuid()`.                                  |
| `user_id`       | `uuid`        | **NOT NULL**, references `auth.users(id)` on delete cascade.          |
| `type`          | `text`        | **CHECK** in (`image`, `document`, `link`, `note`).                   |
| `title`         | `text`        | Optional short title.                                                 |
| `text_content`  | `text`        | Optional body / note text / extracted text.                          |
| `url`           | `text`        | Optional link URL (for `link` memories).                             |
| `search_vector` | `tsvector`    | **Generated** (stored) from `title`, `text_content`, `url`. **GIN** indexed. |
| `created_at`    | `timestamptz` | Default `now()`.                                                      |
| `updated_at`    | `timestamptz` | Maintained by the `updated_at` trigger.                              |

**Full-text search:** `search_vector` is a generated column
(`to_tsvector('english', coalesce(title,'') || ' ' || coalesce(text_content,'') || ' ' || coalesce(url,''))`)
with a **GIN index** (`memories_search_vector_idx`). This delivers ranked,
stemmed keyword search with zero AI cost. Also indexed: `(user_id, created_at)`
for fast per-user listing.

**RLS:** all four operations allowed only where `user_id = auth.uid()`.

---

## Table: `memory_files`

**Purpose:** Files attached to a memory (the actual bytes live in the private
`memories` storage bucket; this table stores metadata + the storage path).

| Column         | Type          | Notes                                                          |
| -------------- | ------------- | -------------------------------------------------------------- |
| `id`           | `uuid`        | **PK**, `default gen_random_uuid()`.                           |
| `memory_id`    | `uuid`        | References `memories(id)` **ON DELETE CASCADE**.               |
| `user_id`      | `uuid`        | **NOT NULL**, references `auth.users(id)`. Denormalized for RLS. |
| `storage_path` | `text`        | Path in the bucket: `{user-id}/{memory-id}/{file-name}`.       |
| `file_name`    | `text`        | Original file name.                                            |
| `file_type`    | `text`        | MIME type (validated server-side).                             |
| `file_size`    | `bigint`      | Size in bytes (validated server-side).                         |
| `created_at`   | `timestamptz` | Default `now()`.                                               |

**RLS:** all four operations allowed only where `user_id = auth.uid()`.

---

## Storage

- **Bucket `memories`** — **private** (no public access).
- **Path pattern:** `{user-id}/{memory-id}/{file-name}`.
- **Storage RLS:** a user may read/write only objects whose first path segment
  (`storage.foldername(name)[1]`) equals their `auth.uid()`. Policy SQL is
  included in the migration.

---

## Future tables (NOT YET CREATED)

These are documented for planning only; no migration creates them in Phase 0.

- **`memory_metadata`** — flexible per-memory metadata (e.g. AI-extracted tags,
  detected entities, source app). Deferred to Phase 2.
- **`search_embeddings`** — vector embeddings using the **pgvector** extension,
  to enable semantic/hybrid search alongside the existing `tsvector` FTS.
  Deferred to Phase 2 (see ADR-002).
