---
name: supabase-postgres-security-architect
description: >-
  Definitive security, database architecture, and performance guidelines for Supabase,
  PostgreSQL, Row Level Security (RLS), private Storage policies, pgvector indexing,
  and migration lifecycles. Use when creating/altering tables, writing RLS policies,
  optimizing queries, or auditing database safety.
---

# Supabase & PostgreSQL Security Architecture Guide

## 1. Row Level Security (RLS) Mandate

Every table storing user or tenant data **MUST** have Row Level Security enabled.

```sql
-- 1. Enable RLS
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;

-- 2. Granular CRUD Policies
CREATE POLICY "Users can view their own memories"
  ON public.memories FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own memories"
  ON public.memories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own memories"
  ON public.memories FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own memories"
  ON public.memories FOR DELETE
  USING (auth.uid() = user_id);
```

### Security Definer vs Invoker Functions
- **`SECURITY INVOKER` (Default for user queries/RPCs):** Enforces RLS policies of the caller. Use for all search/retrieval RPCs like `match_memories`.
- **`SECURITY DEFINER` (Administrative/Triggers):** Runs with creator privileges. **Must always** set an explicit `search_path = public` to prevent search-path injection attacks.

---

## 2. Private Storage Buckets & Policies

1. **Bucket Configuration:** Always create sensitive buckets with `public = false`.
2. **Deterministic Prefixing:** Organize files by `user_id/memory_id/file_name`.
3. **Storage RLS Policies:**
   ```sql
   -- Allow users to upload only into their own folder prefix
   CREATE POLICY "User storage upload isolation"
     ON storage.objects FOR INSERT
     TO authenticated
     WITH CHECK (
       bucket_id = 'memories' AND
       (storage.foldername(name))[1] = auth.uid()::text
     );

   -- Allow users to read/download only from their own folder prefix
   CREATE POLICY "User storage read isolation"
     ON storage.objects FOR SELECT
     TO authenticated
     USING (
       bucket_id = 'memories' AND
       (storage.foldername(name))[1] = auth.uid()::text
     );
   ```
4. **Signed URLs:** Generate short-lived signed URLs (e.g. 1 hour TTL) on the server for private asset rendering.

---

## 3. Database Indexes & Performance

1. **Foreign Key Indexes:** Always create indexes on foreign keys (`user_id`, `memory_id`) to accelerate join queries and cascade deletes.
2. **Compound Timeline Indexes:** `CREATE INDEX idx_memories_user_created ON memories(user_id, created_at DESC);`
3. **Full-Text Search (GIN):** `CREATE INDEX idx_memories_fts ON memories USING GIN(search_vector);`
4. **Vector Search (HNSW):**
   ```sql
   CREATE INDEX idx_memories_vector_hnsw ON memories 
   USING hnsw (embedding vector_cosine_ops)
   WITH (m = 16, ef_construction = 64);
   ```

---

## 4. Transactional Integrity & Orphan Prevention

- **Cascade Deletes:** Always configure `ON DELETE CASCADE` for child tables (`memory_files`, `profiles`).
- **Two-Phase Delete Pattern:**
  1. Retrieve storage paths associated with the memory.
  2. Delete database record within transaction/RLS scope.
  3. Batch remove files from storage bucket via Supabase Storage API.
  4. Log and alert on any storage removal errors to prevent orphaned objects.
