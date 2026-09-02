/**
 * Offline fallback. The service worker serves this cached page for navigations
 * when the network is unavailable, so an installed PWA never shows the browser's
 * dinosaur. Kept static (no data access) so it can be precached.
 */
export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-content flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">You&apos;re offline</h1>
      <p className="mt-3 max-w-sm text-sm text-ink-muted">
        Remember needs a connection to reach your memories. Anything you saved is safe — reconnect
        and it&apos;ll be right here.
      </p>
      <a
        href="/"
        className="mt-8 rounded-xl bg-accent px-5 py-3 text-base font-medium text-white transition-colors hover:bg-accent-hover"
      >
        Try again
      </a>
    </main>
  );
}
