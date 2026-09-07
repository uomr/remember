import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { STORAGE_BUCKET } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * Stable, authenticated media proxy route.
 *
 * Provides a permanent, cacheable URL (/api/media/[id]) for private memory files.
 *
 * Security:
 * - Requires an authenticated Supabase session.
 * - RLS on `memories` and `memory_files` enforces that users can ONLY access files
 *   belonging to their own account.
 * - Direct public access to the Supabase Storage bucket remains completely blocked.
 *
 * Caching & Performance:
 * - Supports responsive thumbnails via `?w=400` powered by Sharp (WebP 80% quality).
 * - Preserves original files untouched in private storage forever.
 * - Emits `ETag` and `Cache-Control: private, max-age=86400, stale-while-revalidate=604800`.
 * - Responds with `304 Not Modified` when `If-None-Match` matches.
 * - Prevents the browser from re-downloading images during search, filtering, and page navigation.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const memoryId = params.id;
  if (!memoryId) {
    return new NextResponse('Memory ID required', { status: 400 });
  }

  const supabase = createClient();

  // 1. Verify caller session & retrieve memory file with RLS verification
  const { data: fileData, error: fileError } = await supabase
    .from('memory_files')
    .select('id, memory_id, storage_path, file_type, file_size, file_name, memories!inner(id, user_id)')
    .eq('memory_id', memoryId)
    .maybeSingle();

  if (fileError || !fileData) {
    return new NextResponse('File not found or unauthorized', { status: 404 });
  }

  const searchParams = request.nextUrl.searchParams;
  const requestedWidth = parseInt(searchParams.get('w') || '0', 10);
  const isImage = (fileData.file_type || '').startsWith('image/');
  const shouldResize = isImage && requestedWidth > 0 && requestedWidth <= 800;

  const etag = shouldResize ? `"${fileData.id}-w${requestedWidth}"` : `"${fileData.id}"`;
  const ifNoneMatch = request.headers.get('if-none-match');

  // 2. HTTP Cache Validation: If-None-Match -> 304 Not Modified
  if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === `W/${etag}`)) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        'ETag': etag,
        'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800',
      },
    });
  }

  // 3. Download the file from private Supabase Storage
  const adminClient = createServiceRoleClient();
  const { data: blob, error: downloadError } = await adminClient.storage
    .from(STORAGE_BUCKET)
    .download(fileData.storage_path);

  if (downloadError || !blob) {
    return new NextResponse('Error retrieving media from storage', { status: 502 });
  }

  const rawBuffer = Buffer.from(await blob.arrayBuffer());

  let responseBuffer: Buffer = rawBuffer;
  let contentType = fileData.file_type || 'application/octet-stream';

  if (shouldResize) {
    try {
      responseBuffer = await sharp(rawBuffer)
        .resize({ width: requestedWidth, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      contentType = 'image/webp';
    } catch {
      // Fallback gracefully to original bytes if sharp fails
      responseBuffer = rawBuffer;
    }
  }

  return new NextResponse(new Uint8Array(responseBuffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(responseBuffer.byteLength),
      'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800',
      'ETag': etag,
    },
  });
}

