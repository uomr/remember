import { UPLOAD_LIMITS } from '@/lib/config';
import { verifySignature } from '@/lib/memories/signatures';
import type { MemoryType } from '@/types/database';

/**
 * Server-side upload validation. We never trust the client: type and size are
 * re-checked here before anything touches Storage. The declared MIME type is a
 * signal, not proof, so `verifyUpload` also sniffs the file's real magic bytes
 * (see src/lib/memories/signatures.ts) before it is accepted.
 */

export interface FileValidationResult {
  ok: boolean;
  /** Which memory kind this file maps to, when valid. */
  memoryType?: Extract<MemoryType, 'image' | 'document'>;
  /** Human-language reason, when invalid. */
  reason?: string;
}

const {
  maxImageSize,
  maxDocumentSize,
  allowedImageTypes,
  allowedDocumentTypes,
} = UPLOAD_LIMITS;

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

export function validateUpload(file: File): FileValidationResult {
  const type = file.type;

  if ((allowedImageTypes as readonly string[]).includes(type)) {
    if (file.size > maxImageSize) {
      return { ok: false, reason: `Images must be ${formatMb(maxImageSize)} or smaller.` };
    }
    return { ok: true, memoryType: 'image' };
  }

  if ((allowedDocumentTypes as readonly string[]).includes(type)) {
    if (file.size > maxDocumentSize) {
      return { ok: false, reason: `Documents must be ${formatMb(maxDocumentSize)} or smaller.` };
    }
    return { ok: true, memoryType: 'document' };
  }

  return { ok: false, reason: "That file type isn't supported yet." };
}

/**
 * Full upload check: the synchronous MIME/size gate above, then a magic-byte
 * signature verification that reads the file's real leading bytes. Use this
 * (not `validateUpload` alone) anywhere a file is about to be persisted.
 */
export async function verifyUpload(file: File): Promise<FileValidationResult> {
  const basic = validateUpload(file);
  if (!basic.ok) return basic;

  const signature = await verifySignature(file, file.type);
  if (!signature.ok) {
    return { ok: false, reason: signature.reason ?? "That file's contents don't match its type." };
  }

  return basic;
}

/** Normalize a user-provided URL, returning null if it isn't a valid http(s) URL. */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Strip path separators so a user file name can't escape its storage folder.
 *  Uses `\p{L}\p{N}` (Unicode letters + digits) instead of `\w` so Arabic,
 *  CJK and accented characters are preserved rather than replaced with `_`. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\\/]/).pop() ?? 'file';
  // The `u` flag enables Unicode property escapes (\p{L} = any letter, \p{N} = any digit).
  return base.replace(/[^\p{L}\p{N}.\- ]+/gu, '_').slice(0, 200) || 'file';
}
