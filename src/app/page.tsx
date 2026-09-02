import { createClient } from '@/lib/supabase/server';
import { listMemories, searchMemories } from '@/lib/memories/queries';
import { CaptureButton } from '@/components/capture/CaptureButton';
import { SearchBar } from '@/components/search/SearchBar';
import { MemoryList } from '@/components/memories/MemoryList';
import { AppHeader } from '@/components/layout/AppHeader';
import { OfflineBanner } from '@/components/layout/OfflineBanner';
import { PWAInstallPrompt } from '@/components/pwa/PWAInstallPrompt';

/**
 * Home — the calm center of the product. Two jobs: help you find something,
 * and help you save something. Route protection (redirect to /sign-in) is
 * handled in middleware, so if we reach here we have a session.
 *
 * Features sticky frosted glass header, orchestrated page-load sequence,
 * and seamless PWA install prompt.
 */
export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const query = searchParams.q?.trim() ?? '';

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { memories, hasMore } = query ? await searchMemories(query) : await listMemories();

  const greetingName = user?.email ? user.email.split('@')[0] : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-content flex-col px-6 pb-16 pt-4">
      {/* Sticky frosted header (P0.4) */}
      <AppHeader greetingName={greetingName} />

      {/* Non-blocking calm offline banner (P1.14) */}
      <OfflineBanner />

      {/* Orchestrated rise-in motion sequence (P1.6) */}
      <section className="space-y-4">
        <div className="animate-rise-in" style={{ animationDelay: '60ms' }}>
          <SearchBar initialQuery={query} />
        </div>
        <div className="animate-rise-in" style={{ animationDelay: '120ms' }}>
          <CaptureButton />
        </div>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
          {query ? 'Results' : 'Recent memories'}
        </h2>
        <MemoryList
          initialMemories={memories}
          initialHasMore={hasMore}
          query={query || undefined}
        />
      </section>

      {/* Behavior-driven PWA install prompt (P1.13) */}
      <PWAInstallPrompt />
    </main>
  );
}

