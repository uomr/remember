import { forwardRef, type InputHTMLAttributes } from 'react';

interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  onClear?: () => void;
  showShortcut?: boolean;
  isSearching?: boolean;
}

/**
 * Minimal, calm search input built on the design tokens.
 * Features auto-direction (dir="auto"), clear action, subtle searching indicator, and focus states.
 */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  {
    className = '',
    placeholder = 'What are you looking for?',
    value,
    onClear,
    showShortcut = true,
    isSearching = false,
    ...props
  },
  ref
) {
  const hasValue = Boolean(value && String(value).length > 0);

  return (
    <div className="relative flex items-center w-full">
      <input
        ref={ref}
        type="search"
        inputMode="search"
        dir="auto"
        placeholder={placeholder}
        value={value}
        className={
          'w-full rounded-2xl border border-border bg-surface-raised px-5 py-4 text-base ' +
          'text-ink placeholder:text-ink-faint shadow-soft transition-colors ' +
          'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 pr-16 ' +
          className
        }
        {...props}
      />
      <div className="absolute right-4 flex items-center gap-2 pointer-events-auto">
        {isSearching ? (
          <div
            className="flex items-center gap-1.5 text-xs text-ink-muted select-none"
            role="status"
            aria-label="Searching memories"
          >
            <span className="h-2 w-2 rounded-full bg-accent animate-pulse" />
            <span className="hidden sm:inline text-[11px] font-medium tracking-tight text-ink-faint">
              Searching…
            </span>
          </div>
        ) : null}

        {hasValue && onClear ? (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear search"
            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint hover:bg-surface-sunken hover:text-ink transition-colors focus-visible:ring-2 focus-visible:ring-accent"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : showShortcut && !isSearching ? (
          <kbd
            aria-hidden="true"
            className="hidden sm:inline-flex h-6 select-none items-center gap-1 rounded border border-border bg-surface px-1.5 font-mono text-[11px] font-medium text-ink-faint opacity-80"
          >
            /
          </kbd>
        ) : null}
      </div>
    </div>
  );
});

