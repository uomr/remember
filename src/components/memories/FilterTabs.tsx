'use client';

export type FilterKind = 'all' | 'image' | 'note' | 'link' | 'document';

interface FilterTabsProps {
  currentFilter: FilterKind;
  onSelect: (filter: FilterKind) => void;
  counts: Record<FilterKind, number>;
}

const TABS: { key: FilterKind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'image', label: 'Photos' },
  { key: 'note', label: 'Notes' },
  { key: 'link', label: 'Links' },
  { key: 'document', label: 'Docs' },
];

/**
 * Calm, zero-friction filter pills.
 * Instant client-side filtering without extra database round-trips.
 */
export function FilterTabs({ currentFilter, onSelect, counts }: FilterTabsProps) {
  // Only show tabs if there are memories to filter
  if (counts.all === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="Filter memories by type"
      className="flex items-center gap-1.5 overflow-x-auto pb-1 text-sm no-scrollbar"
    >
      {TABS.map((tab) => {
        const count = counts[tab.key];
        const isActive = currentFilter === tab.key;

        // Skip tabs with zero items (unless it's 'all')
        if (tab.key !== 'all' && count === 0) return null;

        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.key)}
            className={
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ' +
              (isActive
                ? 'bg-ink text-surface shadow-xs'
                : 'border border-border bg-surface-raised text-ink-muted hover:border-border-strong hover:text-ink')
            }
          >
            <span>{tab.label}</span>
            <span
              className={
                'text-[10px] font-mono ' +
                (isActive ? 'text-surface/70' : 'text-ink-faint')
              }
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
