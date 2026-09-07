'use client';

import { useState, useRef, useEffect } from 'react';
import { signOut } from '@/app/actions/auth';
import { Button } from '@/components/ui/Button';

export function AccountMenu({ greetingName }: { greetingName?: string | null }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Account settings"
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-ink-muted hover:text-ink hover:border-border-strong hover:bg-surface-raised active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 6a3.75 3.75 0 11-7 0 3.75 3.75 0 017 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
          />
        </svg>
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-52 origin-top-right rounded-2xl border border-border bg-surface-raised p-2 shadow-lg backdrop-blur-sm z-30 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="px-3 py-2 border-b border-border/60 mb-1">
            <p className="text-xs text-ink-muted">Signed in as</p>
            <p className="text-sm font-medium text-ink truncate mt-0.5">
              {greetingName || 'Account'}
            </p>
          </div>

          <form action={signOut} className="pt-1">
            <Button
              type="submit"
              variant="ghost"
              className="w-full justify-start text-xs font-medium text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 px-3 py-2 rounded-xl transition-colors"
            >
              <svg
                className="h-4 w-4 mr-2 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.75}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
                />
              </svg>
              Sign out
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
