'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getMemory } from '@/lib/memories/queries';
import { getAIService } from '@/lib/ai';

/**
 * Phase 2 — invisible intelligence.
 *
 * enrichImageMemory runs AFTER an image is saved, from a separate request the
 * capture UI fires without awaiting. This keeps the promise that AI NEVER
 * blocks or breaks capture: if the provider is disabled, slow, or errors, the
 * memory is already safely stored and this function simply does nothing.
 *
 * What it does when AI is enabled: ask the vision model to (a) describe the
 * image and (b) OCR any text, then fold both into the memory's `text_content`.
 * Because the hybrid search already indexes `text_content`, the user can then
 * find a screenshot by what's *in* it — the core "find it by what you remember"
 * promise — with no schema change. A dedicated `memory_metadata` table and
 * pgvector semantic search come in later Phase 2 steps.
 */
export async function enrichImageMemory(memoryId: string): Promise<void> {
  try {
    const ai = getAIService();
    if (!ai.enabled) return; // disabled/unconfigured → no-op, no cost.

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // RLS-guarded read; also mints a short-lived signed URL the model can fetch.
    const memory = await getMemory(memoryId);
    if (!memory || memory.type !== 'image' || !memory.fileUrl) return;

    const userNote = memory.text_content?.trim() ?? '';

    // Run both passes; tolerate either failing on its own.
    const [descRes, ocrRes] = await Promise.allSettled([
      ai.describeImage({ fileUrl: memory.fileUrl }),
      ai.ocr({ fileUrl: memory.fileUrl }),
    ]);

    const description =
      descRes.status === 'fulfilled' ? descRes.value.description.trim() : '';
    const ocrText = ocrRes.status === 'fulfilled' ? ocrRes.value.text.trim() : '';

    // Preserve the user's own note first, then append what the model saw.
    const parts = [userNote, description, ocrText].filter(Boolean);
    const combined = Array.from(new Set(parts)).join('\n\n').trim();

    // The text we index (lexical) and embed (semantic). Fall back to the note.
    const searchText = combined || userNote;

    const update: { text_content?: string; embedding?: string } = {};
    if (combined && combined !== userNote) update.text_content = combined;

    // Semantic fingerprint for meaning-based search (best-effort, independent):
    // handles spelling variants (اسود/أسود), synonyms (جزمة/حذاء) and Arabic↔English
    // without dictionaries. pgvector accepts the JSON-array text form ("[...]").
    if (searchText) {
      try {
        const vector = await ai.embed({ text: searchText });
        if (vector.length > 0) update.embedding = JSON.stringify(vector);
      } catch {
        // Embeddings are optional; lexical search still works without them.
      }
    }

    // Nothing new to store (no text change and no embedding) → leave as-is.
    if (Object.keys(update).length === 0) return;

    const { error: updateError } = await supabase.from('memories').update(update).eq('id', memoryId);
    if (!updateError) {
      revalidatePath('/');
      revalidatePath(`/memory/${memoryId}`);
    }
  } catch {
    // Best-effort by design: never surface an error — capture already succeeded.
  }
}

/**
 * Phase 2 — invisible intelligence for text, links, and documents.
 *
 * Computes and stores a 1536-dimensional semantic embedding for newly created
 * notes, links, and documents so they are immediately discoverable via meaning-based
 * hybrid search without waiting for an offline batch backfill.
 */
export async function enrichGenericMemory(memoryId: string): Promise<void> {
  try {
    const ai = getAIService();
    if (!ai.enabled) return;

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const memory = await getMemory(memoryId);
    if (!memory || memory.type === 'image' || memory.embedding) return;

    const searchableParts = [memory.title, memory.text_content, memory.url].filter(Boolean);
    const searchText = searchableParts.join('\n').trim();
    if (!searchText) return;

    const vector = await ai.embed({ text: searchText });
    if (vector.length > 0) {
      const { error } = await supabase
        .from('memories')
        .update({ embedding: JSON.stringify(vector) })
        .eq('id', memoryId);

      if (!error) {
        revalidatePath('/');
        revalidatePath(`/memory/${memoryId}`);
      }
    }
  } catch {
    // Best-effort by design: never surface errors.
  }
}

