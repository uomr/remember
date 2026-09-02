'use client';

import { useEffect, useState } from 'react';

/**
 * Non-blocking calm offline banner.
 * Gracefully collapses when connection is active.
 */
export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    setIsOffline(!navigator.onLine);

    function onOnline() {
      setIsOffline(false);
    }
    function onOffline() {
      setIsOffline(true);
    }

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      dir="auto"
      role="status"
      className="mb-4 rounded-xl border border-border bg-surface-sunken px-4 py-2 text-center text-xs font-medium text-ink-muted transition-all duration-300 animate-in fade-in"
    >
      You&apos;re offline — showing saved memories · غير متصل — تُعرض الذكريات المحفوظة
    </div>
  );
}
