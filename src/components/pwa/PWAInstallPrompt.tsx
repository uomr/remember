'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/Button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Calm, behavior-driven PWA install prompt.
 * Only triggers after the user's second successful capture (proven intent),
 * never on first visit. Respects dismissal for 14 days.
 */
export function PWAInstallPrompt() {
  const [mounted, setMounted] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setMounted(true);
    function handleBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // Check if user has completed >= 2 captures
    function checkIntent() {
      try {
        const dismissed = localStorage.getItem('remember_pwa_dismissed');
        if (dismissed && Date.now() - parseInt(dismissed, 10) < 14 * 24 * 60 * 60 * 1000) {
          return;
        }
        const captures = parseInt(localStorage.getItem('remember_captures_count') || '0', 10);
        if (captures >= 2) {
          setVisible(true);
        }
      } catch {
        // Ignore storage access error
      }
    }

    checkIntent();
    window.addEventListener('remember_captured', checkIntent);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('remember_captured', checkIntent);
    };
  }, []);

  if (!visible || !deferredPrompt) return null;

  async function handleInstall() {
    if (!deferredPrompt) return;
    setVisible(false);
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  }

  function handleDismiss() {
    setVisible(false);
    try {
      localStorage.setItem('remember_pwa_dismissed', String(Date.now()));
    } catch {
      // Ignore storage error
    }
  }

  if (!mounted || !visible || !deferredPrompt) return null;

  return createPortal(
    <div
      role="dialog"
      aria-label="Install Remember App"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 backdrop-blur-sm p-0 sm:items-center sm:p-6 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-content rounded-t-2xl bg-surface-raised p-6 shadow-2xl border border-border sm:rounded-2xl animate-in slide-in-from-bottom duration-280">
        <div className="flex items-start gap-4 mb-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-192.png"
            alt="Remember icon"
            className="h-12 w-12 rounded-xl shadow-xs border border-border"
          />
          <div>
            <h3 className="font-semibold text-lg text-ink">Add Remember to home screen</h3>
            <p className="text-sm text-ink-muted mt-0.5">
              Access your memories instantly, even when offline.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={handleDismiss} className="px-4 py-2 text-sm">
            Not now
          </Button>
          <Button type="button" onClick={handleInstall} className="px-5 py-2 text-sm">
            Add
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
