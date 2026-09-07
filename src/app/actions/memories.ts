'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { STORAGE_BUCKET, buildStoragePath } from '@/lib/config';
import { normalizeUrl, safeFileName, verifyUpload } from '@/lib/memories/validation';
import { listMemories, searchMemories, getMemory, type MemoryPage } from '@/lib/memories/queries';
import { getAIService } from '@/lib/ai';
import { track } from '@/lib/analytics';
import { enrichDocumentMemory, enrichImageMemory } from '@/app/actions/enrich';
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
    const rawName = String(formData.get('fileName') ?? file.name);
    const fileName = safeFileName(rawName);
    const storagePath = buildStoragePath(user.id, memoryId, fileName);
    const effectiveContentType = validation.mimeType || file.type || 'application/octet-stream';

    // 1) Upload bytes to the private bucket first. If this fails we never
    //    create a dangling DB row.
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file, { contentType: effectiveContentType, upsert: false });

    if (uploadError) {
      console.error('[save:uploadError]', uploadError.message);
      return { ok: false, error: GENERIC_SAVE_ERROR };
    }

    // 2) Create the memory row (explicit id so it matches the storage path).
    const { error: memoryError } = await supabase.from('memories').insert({
      id: memoryId,
      user_id: user.id,
      type: validation.memoryType,
      title: fileName,
      text_content: note || null,
      extraction_status:
        validation.memoryType === 'document' || validation.memoryType === 'image'
          ? 'pending'
          : null,
    });

    if (memoryError) {
      console.error('[save:memoryError]', memoryError.message);
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
      file_type: effectiveContentType,
      file_size: file.size,
    });

    if (fileError) {
      console.error('[save:fileError]', fileError.message);
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      await supabase.from('memories').delete().eq('id', memoryId);
      return { ok: false, error: GENERIC_SAVE_ERROR };
    }

    track('memory_created', { memoryType: validation.memoryType });

    // Background enrichment (never blocks capture)
    if (validation.memoryType === 'document') {
      void enrichDocumentMemory(memoryId).catch((err) => {
        console.error('[save:bgDocEnrichError]', err instanceof Error ? err.message : String(err));
      });
    } else if (validation.memoryType === 'image') {
      void enrichImageMemory(memoryId).catch((err) => {
        console.error('[save:bgImageEnrichError]', err instanceof Error ? err.message : String(err));
      });
    }

    revalidatePath('/');
    return { ok: true, memoryId };
  } catch (error) {
    console.error('[save:createMemory:error]', error instanceof Error ? error.message : String(error));
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
        console.error('[delete] Storage cleanup failed for memory:', memoryId, storageError);
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

export interface MemoryStatusUpdate {
  id: string;
  extraction_status: 'pending' | 'done' | 'skipped' | 'failed' | null;
  text_content: string | null;
  title: string | null;
}

/**
 * Check processing status of memories currently pending extraction.
 * Lightweight, cached/indexed read without full joins.
 */
export async function checkMemoryStatuses(memoryIds: string[]): Promise<MemoryStatusUpdate[]> {
  if (!memoryIds || memoryIds.length === 0) return [];
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('memories')
    .select('id, extraction_status, text_content, title')
    .in('id', memoryIds.slice(0, 50));

  if (error || !data) return [];
  return data as MemoryStatusUpdate[];
}

/**
 * Update an existing memory (title, user note/description).
 * Preserves machine visual/OCR descriptions while updating human caption.
 * Updates lexical index immediately and marks embedding for background refresh.
 */
export async function updateMemory(formData: FormData): Promise<ActionResult> {
  const memoryId = String(formData.get('id') ?? '').trim();
  if (!memoryId) {
    return { ok: false, error: 'Memory ID is required.' };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'Your session has expired. Please sign in again.' };
  }

  try {
    const memory = await getMemory(memoryId);
    if (!memory) {
      return { ok: false, error: 'Memory not found or access denied.' };
    }

    const titleInput = formData.get('title');
    const noteInput = formData.get('text');

    const newTitle = titleInput != null ? String(titleInput).trim() : (memory.title ?? '');
    const newNote = noteInput != null ? String(noteInput).trim() : '';

    let updatedTextContent: string | null = null;

    if (memory.type === 'note') {
      if (!newNote) return { ok: false, error: 'Note cannot be empty.' };
      updatedTextContent = newNote;
    } else if (memory.type === 'link') {
      updatedTextContent = newNote || null;
    } else {
      // For image or document: preserve machine description while updating human note
      const existingText = memory.text_content ?? '';
      const existingParts = existingText.split('\n\n').map((p) => p.trim()).filter(Boolean);
      const machineParts = existingParts.slice(1);

      if (newNote) {
        if (machineParts.length > 0) {
          updatedTextContent = [newNote, ...machineParts].join('\n\n');
        } else {
          updatedTextContent = newNote;
        }
      } else {
        updatedTextContent = machineParts.length > 0 ? machineParts.join('\n\n') : null;
      }
    }

    const finalTitle = newTitle || (memory.type === 'note' && updatedTextContent ? titleFromText(updatedTextContent) : memory.title);

    const updatePayload: Record<string, unknown> = {
      title: finalTitle,
      text_content: updatedTextContent,
      updated_at: new Date().toISOString(),
    };

    // Re-generate semantic embedding if AI service is available
    const ai = getAIService();
    if (ai.enabled) {
      const textToEmbed = [finalTitle, updatedTextContent, memory.url]
        .filter(Boolean)
        .join('\n\n')
        .trim();
      if (textToEmbed) {
        try {
          const vector = await ai.embed({ text: textToEmbed });
          if (vector && vector.length > 0) {
            updatePayload.embedding = JSON.stringify(vector);
          }
        } catch {
          // If embed fails, mark stale (null) so lexical search still functions cleanly
          updatePayload.embedding = null;
        }
      }
    } else {
      updatePayload.embedding = null;
    }

    const { error: updateError } = await supabase
      .from('memories')
      .update(updatePayload)
      .eq('id', memoryId);

    if (updateError) {
      console.error('[updateMemory:error]', updateError.message);
      return { ok: false, error: GENERIC_SAVE_ERROR };
    }

    track('memory_edited', { memoryType: memory.type });

    revalidatePath('/');
    revalidatePath(`/memory/${memoryId}`);
    return { ok: true, memoryId };
  } catch (error) {
    console.error('[updateMemory:fatal]', error instanceof Error ? error.message : String(error));
    return { ok: false, error: GENERIC_SAVE_ERROR };
  }
}

