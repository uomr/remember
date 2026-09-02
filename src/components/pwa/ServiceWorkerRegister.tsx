'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker (`/sw.js`) so the app is installable and has an
 * offline shell (network-first navigations with an /offline fallback; SWR for
 * static assets). Fails gracefully where SW is unsupported.
 */
export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Graceful fallback: the app still works without the service worker.
      });
    };

    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
