import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  searchMemoriesFast,
  searchMemoriesDeep,
  searchMemories,
  PAGE_SIZE,
} from '@/lib/memories/queries';

export const dynamic = 'force-dynamic';

/**
 * Two-tier progressive search API endpoint.
 *
 * Tier 1 (fast):
 *   GET /api/search?q=...&tier=fast
 *   Returns PostgreSQL index matches (URL + Lexical + Chunks) in ~20-40ms.
 *
 * Tier 2 (deep):
 *   GET /api/search?q=...&tier=deep&fastIds=id1,id2...
 *   Executes semantic pgvector embeddings + cross-lingual intent + AI judge.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const tier = searchParams.get('tier') ?? 'fast';
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);
  const limit = parseInt(searchParams.get('limit') ?? String(PAGE_SIZE), 10);

  if (!q) {
    return NextResponse.json({
      memories: [],
      hasMore: false,
      fastIds: [],
      tier,
    });
  }

  if (tier === 'fast') {
    const result = await searchMemoriesFast(q, offset, limit);
    return NextResponse.json({
      memories: result.memories,
      hasMore: result.hasMore,
      fastIds: result.fastIds,
      tier: 'fast',
    });
  }

  if (tier === 'deep') {
    const rawFastIds = searchParams.get('fastIds');
    const fastIds = rawFastIds ? rawFastIds.split(',').filter(Boolean) : [];
    const result = await searchMemoriesDeep(q, offset, limit, fastIds);
    return NextResponse.json({
      memories: result.memories,
      hasMore: result.hasMore,
      tier: 'deep',
    });
  }

  // Fallback to unified search
  const result = await searchMemories(q, offset, limit);
  return NextResponse.json({
    memories: result.memories,
    hasMore: result.hasMore,
    tier: 'unified',
  });
}
