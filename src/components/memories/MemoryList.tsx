'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { loadMoreMemories } from '@/app/actions/memories';
import type { MemoryWithFile } from '@/lib/memories/queries';
import { Button } from '@/components/ui/Button';
import { MemoryCard } from './MemoryCard';
import { MemoryCardSkeleton } from './MemoryCardSkeleton';
import { FilterTabs, type FilterKind } from './FilterTabs';

/**
 * The memory library. Renders a calm responsive grid with zero-friction filter tabs,
 * paginated "Load more" (offset-based), or a warm empty state.
 */
export function MemoryList({
  initialMemories,
  initialHasMore,
  query,
}: {
  initialMemories: MemoryWithFile[];
  initialHasMore: boolean;
  /** Present when the list is the result of a search (changes empty copy). */
  query?: string;
}) {
  const [memories, setMemories] = useState(initialMemories);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [filter, setFilter] = useState<FilterKind>('all');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Reset when the server sends a new initial page (new search / after save).
  useEffect(() => {
    setMemories(initialMemories);
    setHasMore(initialHasMore);
    setError(null);
  }, [initialMemories, initialHasMore]);

  const counts = useMemo<Record<FilterKind, number>>(() => {
    return {
      all: memories.length,
      image: memories.filter((m) => m.type === 'image').length,
      note: memories.filter((m) => m.type === 'note').length,
      link: memories.filter((m) => m.type === 'link').length,
      document: memories.filter((m) => m.type === 'document').length,
    };
  }, [memories]);

  const visibleMemories = useMemo(() => {
    if (filter === 'all') return memories;
    return memories.filter((m) => m.type === filter);
  }, [memories, filter]);

  function loadMore() {
    setError(null);
    startTransition(async () => {
      try {
        const page = await loadMoreMemories(query ?? '', memories.length);
        setMemories((prev) => [...prev, ...page.memories]);
        setHasMore(page.hasMore);
      } catch {
        setError("We couldn't load more right now. Please try again.");
      }
    });
  }

  if (memories.length === 0) {
    return query ? (
      <div className="rounded-2xl border border-border bg-surface-raised p-10 text-center animate-rise-in">
        <svg
          className="mx-auto h-20 w-20 text-ink-faint mb-4 opacity-80"
          fill="none"
          viewBox="0 0 48 48"
          stroke="currentColor"
          strokeWidth={1.25}
          aria-hidden="true"
        >
          <circle cx="21" cy="21" r="13" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M31 31l10 10" />
          <path strokeDasharray="2 3" strokeLinecap="round" d="M12 40c4 3 10 3 14 0" />
        </svg>
        <p className="text-lg font-medium text-ink">Nothing matched “{query}”.</p>
        <p className="mt-2 text-sm text-ink-muted">Try fewer or different words.</p>
      </div>
    ) : (
      <div className="rounded-2xl border border-border bg-surface-raised p-10 text-center animate-rise-in">
        <svg
          className="mx-auto h-20 w-20 text-ink-faint mb-4 opacity-80"
          fill="none"
          viewBox="0 0 48 48"
          stroke="currentColor"
          strokeWidth={1.25}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 17l16-8 16 8-16 8-16-8z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 17v16l16 8V25" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M40 17v16l-16 8" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 13l16 8" />
        </svg>
        <p className="text-lg font-medium text-ink">Your memory is empty.</p>
        <p className="mt-2 text-sm text-ink-muted max-w-sm mx-auto">
          Save something you might need later — a screenshot, a receipt, a link, a note.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Zero-friction quick filter pills */}
      <FilterTabs
        currentFilter={filter}
        onSelect={setFilter}
        counts={counts}
      />

      {visibleMemories.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface-raised p-8 text-center animate-rise-in">
          <p className="text-base text-ink">No {filter} memories found.</p>
          <Button
            type="button"
            variant="ghost"
            className="mt-3 text-sm"
            onClick={() => setFilter('all')}
          >
            Show all ({counts.all})
          </Button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {visibleMemories.map((memory, i) => (
            <li key={memory.id}>
              <MemoryCard
                memory={memory}
                className={i < 6 ? 'animate-rise-in' : ''}
                style={i < 6 ? { animationDelay: `${Math.min(180 + i * 40, 380)}ms` } : undefined}
              />
            </li>
          ))}
        </ul>
      )}

      {pending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <MemoryCardSkeleton />
          <MemoryCardSkeleton />
        </div>
      ) : null}

      {error ? (
        <p className="text-center text-sm text-ink-muted" role="alert">
          {error}
        </p>
      ) : null}

      {hasMore && filter === 'all' ? (
        <div className="flex justify-center">
          <Button type="button" variant="ghost" onClick={loadMore} disabled={pending}>
            {pending ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

