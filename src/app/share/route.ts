import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createMemory } from '@/app/actions/memories';
import { enrichImageMemory, enrichGenericMemory, enrichDocumentMemory } from '@/app/actions/enrich';
import { normalizeUrl } from '@/lib/memories/validation';
import { UPLOAD_LIMITS } from '@/lib/config';

/**
 * Web Share Target handler (declared in public/manifest.webmanifest).
 *
 * When the installed PWA is chosen from the OS share sheet, the platform POSTs
 * here as multipart/form-data with any of: `files`, `url`, `text`, `title`.
 * We turn that into a memory and send the user to it — so "share to Remember"
 * is a one-tap capture from anywhere on the phone.
 *
 * Precedence: a shared file wins; then a URL (or a URL found inside text);
 * otherwise the text becomes a note.
 */
export async function POST(request: NextRequest) {
  const { origin } = new URL(request.url);

  // Must be signed in. Middleware also guards this, but check explicitly.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/sign-in`, { status: 303 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.redirect(`${origin}/?shared=error`, { status: 303 });
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  const file: File | undefined = files[0];
  const url = normalizeUrl(String(form.get('url') ?? '')) ?? findUrlInText(String(form.get('text') ?? ''));
  const text = String(form.get('text') ?? '').trim();

  // Build a normalized payload for the shared createMemory action.
  const payload = new FormData();
  let result: Awaited<ReturnType<typeof createMemory>>;
  let isImage = false;

  if (file) {
    isImage = (UPLOAD_LIMITS.allowedImageTypes as readonly string[]).includes(file.type);
    payload.set('type', isImage ? 'image' : 'document');
    payload.set('file', file);
    result = await createMemory(payload);
  } else if (url) {
    payload.set('type', 'link');
    payload.set('url', url);
    result = await createMemory(payload);
  } else if (text) {
    payload.set('type', 'note');
    payload.set('text', text);
    result = await createMemory(payload);
  } else {
    return NextResponse.redirect(`${origin}/?shared=empty`, { status: 303 });
  }

  if (!result.ok) {
    return NextResponse.redirect(`${origin}/?shared=error`, { status: 303 });
  }

  // Non-blocking enrichment in background — never awaited so capture is instant.
  if (result.memoryId) {
    if (file && isImage) {
      void enrichImageMemory(result.memoryId);
    } else if (file && !isImage) {
      // Document: deterministic text extraction (no AI required for extraction).
      void enrichDocumentMemory(result.memoryId);
    } else {
      void enrichGenericMemory(result.memoryId);
    }
  }

  // 303 so the browser follows with a GET (this was a POST navigation).
  return NextResponse.redirect(`${origin}/memory/${result.memoryId}`, { status: 303 });
}

/** Pull the first http(s) URL out of shared text, if any. */
function findUrlInText(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? normalizeUrl(match[0]) : null;
}
