'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { STORAGE_BUCKET, buildStoragePath } from '@/lib/config';
import { normalizeUrl, safeFileName, verifyUpload } from '@/lib/memories/validation';
import { listMemories, searchMemories, type MemoryPage } from '@/lib/memories/queries';
import { track } from '@/lib/analytics';
import type { MemoryType } from '@/types/database';

/**
 * Result contract shared by capture actions. We NEVER fake success: `ok` is
 * only true once the row (and any file) is actually persisted. Errors are
 * human-language strings safe to show directly.
 */
export interface ActionResult {
  ok: boolean;
  error?: string;
  memoryId?: string;
}

const GENERIC_SAVE_ERROR =
  "We couldn't save this right now. Nothing was lost — please try again.";

/** Derive a short, human title from note text (first line, trimmed). */
function titleFromText(text: string): string | null {
  const firstLine = text.trim().split('\n')[0]?.trim() ?? '';
  if (!firstLine) return null;
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

/**
 * Create a memory. Handles all four MVP types from one FormData payload so the
 * capture UI has a single entry point. Authorization is enforced by RLS (the
 * insert carries the authenticated user_id), but we also resolve the user here
 * and never trust a client-provided id.
 */
export async function createMemory(formData: FormData): Promise<ActionResult> {
  const type = String(formData.get('type') ?? '') as MemoryType;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'Your session has expired. Please sign in again.' };
  }

  try {
    if (type === 'note') {
      const text = String(formData.get('text') ?? '').trim();
      if (!text) return { ok: false, error: 'Write something to remember first.' };

      const { data, error } = await supabase
        .from('memories')
        .insert({ user_id: user.id, type, text_content: text, title: titleFromText(text) })
        .select('id')
        .single();

      if (error || !data) return { ok: false, error: GENERIC_SAVE_ERROR };
      track('memory_created', { memoryType: 'note' });
      revalidatePath('/');
      return { ok: true, memoryId: data.id };
    }

    if (type === 'link') {
      const url = normalizeUrl(String(formData.get('url') ?? ''));
      if (!url) return { ok: false, error: 'That doesn’t look like a valid link.' };

      let title: string | null = null;
      try {
        title = new URL(url).hostname.replace(/^www\./, '');
      } catch {
        title = null;
      }

      const { data, error } = await supabase
        .from('memories')
        .insert({ user_id: user.id, type, url, title })
        .select('id')
        .single();

      if (error || !data) return { ok: false, error: GENERIC_SAVE_ERROR };
      track('memory_created', { memoryType: 'link' });
      revalidatePath('/');
      return { ok: true, memoryId: data.id };
    }

    // image | document → file upload
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: 'Choose a file to save.' };
    }

    const validation = await verifyUpload(file);
    if (!validation.ok || !validation.memoryType) {
      return { ok: false, error: validation.reason ?? "That file can't be saved." };
    }

    // Optional caption/note for the file. When present it becomes the memory's
    // searchable text_content (the hybrid search indexes it) and a friendlier
    // title than the raw file name — so a screenshot can be found later by what
    // the user remembers about it. Absent → we fall back to the file name.
    const note = String(formData.get('text') ?? '').trim();

    const memoryId = randomUUID();
    const fileName = safeFileName(file.name);
    const storagePath = buildStoragePath(user.id, memoryId, fileName);

    // 1) Upload bytes to the private bucket first. If this fails we never
    //    create a dangling DB row.
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file, { contentType: file.type, upsert: false });

    if (uploadError) return { ok: false, error: GENERIC_SAVE_ERROR };

    // 2) Create the memory row (explicit id so it matches the storage path).
    const { error: memoryError } = await supabase.from('memories').insert({
      id: memoryId,
      user_id: user.id,
      type: validation.memoryType,
      title: fileName,
      text_content: note || null,
    });

    if (memoryError) {
      // Roll back the uploaded object so no orphaned file remains.
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      return { ok: false, error: GENERIC_SAVE_ERROR };
    }

    // 3) Record file metadata.
    const { error: fileError } = await supabase.from('memory_files').insert({
      memory_id: memoryId,
      user_id: user.id,
      storage_path: storagePath,
      file_name: fileName,
      file_type: file.type || null,
      file_size: file.size,
    });

    if (fileError) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      await supabase.from('memories').delete().eq('id', memoryId);
      return { ok: false, error: GENERIC_SAVE_ERROR };
    }

    track('memory_created', { memoryType: validation.memoryType });
    revalidatePath('/');
    return { ok: true, memoryId };
  } catch {
    return { ok: false, error: GENERIC_SAVE_ERROR };
  }
}

/**
 * Delete a memory and everything attached to it. The DB cascade removes
 * memory_files rows, but Storage objects are NOT cascaded — we remove them
 * explicitly here so no private file is left behind (see DATABASE.md deletion).
 */
export async function deleteMemory(memoryId: string): Promise<ActionResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'Your session has expired. Please sign in again.' };
  }

  try {
    // Collect storage paths first (RLS guarantees these belong to the user).
    const { data: files } = await supabase
      .from('memory_files')
      .select('storage_path')
      .eq('memory_id', memoryId);

    const { error } = await supabase.from('memories').delete().eq('id', memoryId);
    if (error) {
      return { ok: false, error: "We couldn't delete this right now. Please try again." };
    }

    const paths = (files ?? []).map((f) => f.storage_path);
    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
      if (storageError) {
        console.warn('[Storage Cleanup Warning] Failed to remove storage paths for deleted memory:', memoryId, storageError);
      }
    }

    track('memory_deleted');
    revalidatePath('/');
    return { ok: true };
  } catch {
    return { ok: false, error: "We couldn't delete this right now. Please try again." };
  }
}

/**
 * Fetch the next page of memories for the "Load more" control. Delegates to the
 * RLS-guarded read layer; an empty `query` returns the full timeline, otherwise
 * it pages the search results. Signed file URLs are freshly minted per page.
 */
export async function loadMoreMemories(query: string, offset: number): Promise<MemoryPage> {
  const trimmed = query.trim();
  return trimmed ? searchMemories(trimmed, offset) : listMemories(offset);
}
