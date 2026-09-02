'use client';

import { useEffect, useState } from 'react';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

interface AppHeaderProps {
  greetingName?: string | null;
}

/**
 * Sticky frosted header with Fraunces brand mark and ThemeToggle.
 * Reads scroll position to toggle backdrop blur and subtle border.
 */
export function AppHeader({ greetingName }: AppHeaderProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={
        'sticky top-0 z-20 -mx-6 mb-8 px-6 py-4 transition-colors duration-150 ease-out animate-rise-in ' +
        (scrolled
          ? 'bg-surface border-b border-border shadow-xs'
          : 'bg-transparent border-b border-transparent')
      }
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs text-ink-muted">
            Welcome back{greetingName ? `, ${greetingName}` : ''}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
            <h1 className="font-brand-logo text-xl sm:text-2xl tracking-tight text-ink">
              Remember
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
