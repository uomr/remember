'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SearchField } from '@/components/ui/SearchField';
import { track } from '@/lib/analytics';

interface SearchBarProps {
  initialQuery?: string;
  value?: string;
  onChange?: (value: string) => void;
  onClear?: () => void;
  isSearching?: boolean;
}

/**
 * Search bar that talks to human memory, not database syntax.
 * Supports both orchestrated controlled mode (via MemoryLibrary) and
 * standalone URL-reflecting mode.
 */
export function SearchBar({
  initialQuery = '',
  value: controlledValue,
  onChange: controlledOnChange,
  onClear: controlledOnClear,
  isSearching = false,
}: SearchBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [internalValue, setInternalValue] = useState(initialQuery);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;

  // Sync state if initialQuery changes in uncontrolled mode
  useEffect(() => {
    if (!isControlled) {
      setInternalValue(initialQuery);
    }
  }, [initialQuery, isControlled]);

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

  function handleChange(next: string) {
    if (isControlled && controlledOnChange) {
      controlledOnChange(next);
      return;
    }
    setInternalValue(next);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => pushQuery(next), 250);
  }

  function handleClear() {
    if (isControlled && controlledOnClear) {
      controlledOnClear();
      inputRef.current?.focus();
      return;
    }
    setInternalValue('');
    if (debounce.current) clearTimeout(debounce.current);
    pushQuery('');
    inputRef.current?.focus();
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isControlled) {
          if (debounce.current) clearTimeout(debounce.current);
          pushQuery(value);
        }
      }}
    >
      <SearchField
        ref={inputRef}
        aria-label="Search your memories"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onClear={handleClear}
        isSearching={isSearching}
      />
    </form>
  );
}

