/**
 * Calm skeleton placeholder for MemoryCard.
 * Prevents Layout Shifts (CLS) while memories or search queries are loading.
 */
export function MemoryCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="block overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-soft animate-pulse"
    >
      <div className="aspect-video w-full bg-surface-sunken" />
      <div className="space-y-2.5 p-5">
        <div className="flex items-center gap-2">
          <div className="h-3 w-12 rounded bg-surface-sunken" />
          <div className="h-3 w-16 rounded bg-surface-sunken" />
        </div>
        <div className="h-4 w-3/4 rounded bg-surface-sunken" />
        <div className="h-3 w-1/2 rounded bg-surface-sunken" />
      </div>
    </div>
  );
}
