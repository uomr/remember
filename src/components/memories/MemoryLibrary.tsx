'use client';

import { useState, useEffect, useRef, useMemo, useTransition } from 'react';
import type { MemoryWithFile } from '@/lib/memories/queries';
import { loadMoreMemories } from '@/app/actions/memories';
import { logRetrievalEventAction } from '@/app/actions/retrieval';
import { SearchBar } from '@/components/search/SearchBar';
import { FilterTabs, type FilterKind } from './FilterTabs';
import { MemoryCard } from './MemoryCard';
import { MemoryCardSkeleton } from './MemoryCardSkeleton';
import { Button } from '@/components/ui/Button';

interface MemoryLibraryProps {
  initialMemories: MemoryWithFile[];
  initialHasMore: boolean;
  initialQuery?: string;
  children?: React.ReactNode;
}

/**
 * Orchestrated memory library container.
 *
 * Provides:
 * - Progressive two-tier search (fast lexical < 40ms -> deep background semantic).
 * - Quiet "Searching…" indicator inside the search field without page freezing or blank screens.
 * - Race condition immunity: latest query sequence counter guarantees stale responses are discarded.
 * - Instant 0ms clear back to recent memories without server roundtrips.
 * - Client-side URL synchronization (?q=) via replaceState without triggering RSC re-renders.
 * - Zero-friction category filtering tabs.
 * - Non-invasive personal retrieval learning signals.
 */
export function MemoryLibrary({
  initialMemories,
  initialHasMore,
  initialQuery = '',
  children,
}: MemoryLibraryProps) {
  const [query, setQuery] = useState(initialQuery);
  const [memories, setMemories] = useState(initialMemories);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [filter, setFilter] = useState<FilterKind>('all');
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const querySeq = useRef<number>(0);
  const abortController = useRef<AbortController | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionId = useRef<string>(
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sess_${Date.now()}`,
  );
  const lastSearchedQuery = useRef<string>('');
  const prevQueriesRef = useRef<string[]>([]);

  // Sync state if server initialMemories update (e.g., after save/refresh)
  useEffect(() => {
    if (!query) {
      setMemories(initialMemories);
      setHasMore(initialHasMore);
    }
  }, [initialMemories, initialHasMore, query]);

  // Cleanup timers and abort controllers on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (abortController.current) abortController.current.abort();
    };
  }, []);

  function handleQueryChange(next: string) {
    setQuery(next);
    setError(null);

    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    const trimmed = next.trim();

    // Instant clear when input is empty
    if (!trimmed) {
      if (abortController.current) abortController.current.abort();
      querySeq.current++;
      setMemories(initialMemories);
      setHasMore(initialHasMore);
      setIsSearching(false);
      try {
        window.history.replaceState(null, '', window.location.pathname);
      } catch {
        // Ignore in restricted environments
      }
      return;
    }

    setIsSearching(true);

    if (lastSearchedQuery.current && lastSearchedQuery.current !== trimmed) {
      if (!prevQueriesRef.current.includes(lastSearchedQuery.current)) {
        prevQueriesRef.current.push(lastSearchedQuery.current);
      }
    }
    lastSearchedQuery.current = trimmed;

    debounceTimer.current = setTimeout(async () => {
      const thisSeq = ++querySeq.current;

      if (abortController.current) abortController.current.abort();
      const controller = new AbortController();
      abortController.current = controller;

      try {
        // -------------------------------------------------------------
        // TIER 1: Fast Lexical Search (~20-40ms)
        // -------------------------------------------------------------
        const fastRes = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}&tier=fast`,
          { signal: controller.signal },
        );

        if (!fastRes.ok) throw new Error('Search failed');
        const fastData = await fastRes.json();

        if (thisSeq !== querySeq.current) return;

        setMemories(fastData.memories ?? []);
        setHasMore(Boolean(fastData.hasMore));

        const fastHits = fastData.memories?.length ?? 0;
        const hasArabic = /[\u0600-\u06FF]/.test(trimmed);

        // If fast results are exact and dense (>= 3 hits) and not Arabic, finish immediately!
        if (fastHits >= 3 && !hasArabic) {
          setIsSearching(false);
          try {
            window.history.replaceState(
              null,
              '',
              `?q=${encodeURIComponent(trimmed)}`,
            );
          } catch {
            // Ignore
          }
          return;
        }

        // -------------------------------------------------------------
        // TIER 2: Deep Semantic & Cross-Language Retrieval (Background)
        // -------------------------------------------------------------
        const fastIdsStr = (fastData.fastIds || []).join(',');
        const deepRes = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}&tier=deep&fastIds=${encodeURIComponent(fastIdsStr)}`,
          { signal: controller.signal },
        );

        if (!deepRes.ok) throw new Error('Deep search failed');
        const deepData = await deepRes.json();

        if (thisSeq !== querySeq.current) return;

        if (deepData.memories && deepData.memories.length > 0) {
          setMemories(deepData.memories);
          setHasMore(Boolean(deepData.hasMore));
        }

        setIsSearching(false);
        try {
          window.history.replaceState(
            null,
            '',
            `?q=${encodeURIComponent(trimmed)}`,
          );
        } catch {
          // Ignore
        }
      } catch (err: unknown) {
        if ((err as Error)?.name === 'AbortError') return;
        if (thisSeq === querySeq.current) {
          setIsSearching(false);
        }
      }
    }, 200);
  }

  function handleClear() {
    setQuery('');
    setError(null);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (abortController.current) abortController.current.abort();
    querySeq.current++;
    setMemories(initialMemories);
    setHasMore(initialHasMore);
    setIsSearching(false);
    try {
      window.history.replaceState(null, '', window.location.pathname);
    } catch {
      // Ignore
    }
  }

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
        const page = await loadMoreMemories(query, memories.length);
        setMemories((prev) => [...prev, ...page.memories]);
        setHasMore(page.hasMore);
      } catch {
        setError("We couldn't load more right now. Please try again.");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Search Bar with quiet micro-status and fast progressive retrieval */}
      <div className="animate-rise-in" style={{ animationDelay: '60ms' }}>
        <SearchBar
          value={query}
          onChange={handleQueryChange}
          onClear={handleClear}
          isSearching={isSearching}
        />
      </div>

      {children}

      <section className="mt-8 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            {query ? 'Search results' : 'Recent memories'}
          </h2>
          {isSearching ? (
            <span className="text-xs text-ink-muted animate-pulse font-medium">
              Searching…
            </span>
          ) : null}
        </div>

        {/* Category Filter Pills */}
        <FilterTabs
          currentFilter={filter}
          onSelect={setFilter}
          counts={counts}
        />

        {/* Memory Grid or Empty State */}
        {memories.length === 0 ? (
          query && !isSearching ? (
            <div className="rounded-2xl border border-border bg-surface-raised p-10 text-center animate-rise-in">
              <svg
                className="mx-auto h-16 w-16 text-ink-faint mb-3 opacity-70"
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
              <p className="text-base font-medium text-ink">Nothing matched “{query}”.</p>
              <p className="mt-1.5 text-sm text-ink-muted">Try fewer or different words.</p>
            </div>
          ) : !query ? (
            <div className="rounded-2xl border border-border bg-surface-raised p-10 text-center animate-rise-in">
              <svg
                className="mx-auto h-16 w-16 text-ink-faint mb-3 opacity-70"
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
              <p className="text-base font-medium text-ink">Your memory is empty.</p>
              <p className="mt-1.5 text-sm text-ink-muted max-w-sm mx-auto">
                Save something you might need later — a screenshot, a receipt, a link, a note.
              </p>
            </div>
          ) : null
        ) : (
          <div className={isSearching ? 'opacity-80 transition-opacity duration-150' : 'transition-opacity duration-150'}>
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
                {visibleMemories.map((memory, index) => (
                  <li key={memory.id}>
                    <MemoryCard
                      memory={memory}
                      searchContext={
                        query.trim()
                          ? {
                              query: query.trim(),
                              position: index + 1,
                              sessionId: sessionId.current,
                            }
                          : undefined
                      }
                      onClick={() => {
                        if (query.trim()) {
                          void logRetrievalEventAction({
                            memoryId: memory.id,
                            rawQuery: query.trim(),
                            eventType: 'search_result_open',
                            position: index + 1,
                            sessionId: sessionId.current,
                            isReformulation: prevQueriesRef.current.length > 0,
                          });
                        }
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
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
          <div className="flex justify-center pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={loadMore}
              disabled={pending}
            >
              {pending ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
