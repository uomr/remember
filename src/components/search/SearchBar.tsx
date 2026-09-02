'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SearchField } from '@/components/ui/SearchField';
import { track } from '@/lib/analytics';

/**
 * Search bar that talks to human memory, not database syntax. It reflects the
 * query into the URL (?q=) so results are shareable/bookmarkable and the page
 * can render them server-side. Typing is debounced to avoid a request per
 * keystroke.
 */
export function SearchBar({ initialQuery = '' }: { initialQuery?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync state if initialQuery changes
  useEffect(() => {
    setValue(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  // Keyboard shortcut: Press "/" to focus search if not in an input/textarea
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function pushQuery(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next.trim()) {
      params.set('q', next.trim());
      track('search_started');
    } else {
      params.delete('q');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function onChange(next: string) {
    setValue(next);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => pushQuery(next), 300);
  }

  function handleClear() {
    setValue('');
    if (debounce.current) clearTimeout(debounce.current);
    pushQuery('');
    inputRef.current?.focus();
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (debounce.current) clearTimeout(debounce.current);
        pushQuery(value);
      }}
    >
      <SearchField
        ref={inputRef}
        aria-label="Search your memories"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClear={handleClear}
      />
    </form>
  );
}

