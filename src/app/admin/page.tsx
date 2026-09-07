import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminUser } from '@/lib/auth/admin';
import { fetchAdminDashboardData } from '@/lib/admin/data';
import { formatFileSize, formatMemoryDate } from '@/lib/format';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const auth = await getAdminUser();

  if (auth.status === 401) {
    redirect('/sign-in?redirect=/admin');
  }

  if (auth.status === 403 || !auth.authorized) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-content flex-col items-center justify-center px-6 py-16 text-center animate-rise-in">
        <div className="rounded-3xl border border-danger/30 bg-danger-soft/40 p-8 max-w-md shadow-elevated">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-danger/10 text-danger">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-ink mb-2">Access Restricted</h1>
          <p className="text-sm text-ink-muted leading-relaxed mb-6">
            The Admin Console is strictly reserved for authorized system owners. Your account ({auth.user?.email || 'unidentified'}) is not on the admin allowlist.
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover transition-colors shadow-soft"
          >
            ← Back to Memories
          </Link>
        </div>
      </main>
    );
  }

  const data = await fetchAdminDashboardData();
  const { metrics, users, recentEvents, searchIntelligence, systemHealth } = data;

  return (
    <main className="mx-auto min-h-dvh max-w-6xl px-6 py-10 animate-rise-in">
      {/* Top Header */}
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <Link
              href="/"
              className="text-xs font-medium text-accent hover:text-accent-hover rounded transition-colors"
            >
              ← Back to App
            </Link>
            <span className="text-ink-faint text-xs">/</span>
            <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-accent">
              Admin Console v1
            </span>
          </div>
          <h1 className="text-2xl font-bold text-ink mt-2">Executive Observability</h1>
          <p className="text-xs text-ink-muted mt-1">
            System owner telemetry, search intelligence & operational health
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-medium text-ink">{auth.user?.email}</p>
            <p className="text-[11px] text-accent font-mono uppercase tracking-wide">Owner Session</p>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* 1. Overview KPIs */}
      <section className="space-y-4 mb-12">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint">
          System Overview & Metrics
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {/* Total Users */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-soft">
            <p className="text-xs font-medium text-ink-muted">Total Users</p>
            <p className="text-2xl font-bold text-ink mt-1.5">{metrics.totalUsers}</p>
            <div className="flex items-center gap-2 mt-2 text-[11px] text-ink-faint">
              <span>Today: <strong className="text-ink font-semibold">+{metrics.newUsersToday}</strong></span>
              <span>·</span>
              <span>7d: <strong className="text-ink font-semibold">+{metrics.newUsers7d}</strong></span>
            </div>
          </div>

          {/* Active Users */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-soft">
            <p className="text-xs font-medium text-ink-muted">Active Users (7d / 30d)</p>
            <p className="text-2xl font-bold text-ink mt-1.5">{metrics.activeUsers7d}</p>
            <div className="flex items-center gap-2 mt-2 text-[11px] text-ink-faint">
              <span>Today: <strong className="text-ink font-semibold">{metrics.activeUsersToday}</strong></span>
              <span>·</span>
              <span>30d: <strong className="text-ink font-semibold">{metrics.activeUsers30d}</strong></span>
            </div>
          </div>

          {/* Total Memories */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-soft">
            <p className="text-xs font-medium text-ink-muted">Total Memories</p>
            <p className="text-2xl font-bold text-ink mt-1.5">{metrics.totalMemories}</p>
            <div className="flex items-center gap-2 mt-2 text-[11px] text-ink-faint">
              <span>Created today: <strong className="text-ink font-semibold">+{metrics.memoriesCreatedToday}</strong></span>
            </div>
          </div>

          {/* Storage Usage */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-soft">
            <p className="text-xs font-medium text-ink-muted">Storage Footprint</p>
            <p className="text-2xl font-bold text-ink mt-1.5">
              {formatFileSize(metrics.totalStorageBytes) || '0 KB'}
            </p>
            <p className="text-[11px] text-ink-faint mt-2">Private Supabase Storage</p>
          </div>

          {/* Searches Today */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-soft">
            <p className="text-xs font-medium text-ink-muted">Searches Today</p>
            <p className="text-2xl font-bold text-ink mt-1.5">{metrics.searchesToday}</p>
            <div className="flex items-center gap-2 mt-2 text-[11px] text-ink-faint">
              <span>Zero-result: <strong className="text-ink font-semibold">{metrics.zeroResultSearches}</strong></span>
            </div>
          </div>

          {/* Search Latency */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-soft">
            <p className="text-xs font-medium text-ink-muted">Avg Search Latency</p>
            <p className="text-2xl font-bold text-ink mt-1.5">{metrics.averageSearchLatencyMs} ms</p>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-2 font-medium">
              Sub-50ms local intent & indexes
            </p>
          </div>

          {/* AI Calls & Cost */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-soft">
            <p className="text-xs font-medium text-ink-muted">AI Calls & Cost</p>
            <p className="text-2xl font-bold text-ink mt-1.5">${metrics.estimatedAiCostUsd}</p>
            <p className="text-[11px] text-ink-faint mt-2">
              ~{metrics.aiCalls} calls (Vision + Embeddings)
            </p>
          </div>

          {/* Processing Pipeline */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-soft">
            <p className="text-xs font-medium text-ink-muted">Pipeline Health</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1.5">
              {systemHealth.processingDone} done
            </p>
            <div className="flex items-center gap-2 mt-2 text-[11px] text-ink-faint">
              <span>Pending: <strong>{systemHealth.processingPending}</strong></span>
              <span>·</span>
              <span className={metrics.processingFailures > 0 ? 'text-danger font-bold' : ''}>
                Failed: {metrics.processingFailures}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Search Intelligence & Zero-Result Analysis */}
      <section className="space-y-4 mb-12">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint">
            Search Intelligence
          </h2>
          <span className="text-xs text-ink-muted">
            Success Rate: <strong className="text-ink font-semibold">{searchIntelligence.searchSuccessRate}%</strong>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top Searches */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-soft">
            <h3 className="text-sm font-semibold text-ink mb-3">Top Queries</h3>
            {searchIntelligence.topSearches.length === 0 ? (
              <p className="text-xs text-ink-muted py-6 text-center">No searches logged yet today.</p>
            ) : (
              <div className="space-y-2">
                {searchIntelligence.topSearches.map((s, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0">
                    <span dir="auto" className="text-ink font-medium truncate max-w-[80%]">{s.query}</span>
                    <span className="rounded bg-surface px-2 py-0.5 text-ink-faint font-mono">{s.count} searches</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Zero-Result Searches */}
          <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-soft">
            <h3 className="text-sm font-semibold text-ink mb-3">Zero-Result Queries (Dropoff Risk)</h3>
            {searchIntelligence.zeroResultSearches.length === 0 ? (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 py-6 text-center font-medium">
                Zero dropoffs. 100% of user searches resolved relevant memories.
              </p>
            ) : (
              <div className="space-y-2">
                {searchIntelligence.zeroResultSearches.map((z, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs py-1.5 border-b border-border/50 last:border-0">
                    <span dir="auto" className="text-danger font-medium truncate max-w-[70%]">{z.query}</span>
                    <span className="text-ink-faint text-[11px]">{formatMemoryDate(z.lastSearched)} ({z.count}x)</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 3. User Management */}
      <section className="space-y-4 mb-12">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint">
          Registered Users ({users.length})
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-border bg-surface-raised shadow-soft">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-surface text-ink-faint uppercase font-medium">
              <tr>
                <th className="px-5 py-3">User Identifier</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Memories</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Last Active</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 text-ink">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-surface-sunken/40 transition-colors">
                  <td className="px-5 py-3.5 font-medium truncate max-w-xs">{u.email}</td>
                  <td className="px-4 py-3.5">
                    {u.role === 'owner' ? (
                      <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                        Owner
                      </span>
                    ) : (
                      <span className="rounded-md bg-surface px-2 py-0.5 text-[10px] font-medium text-ink-muted">
                        User
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 font-semibold">{u.memoryCount}</td>
                  <td className="px-4 py-3.5 text-ink-muted">{formatMemoryDate(u.createdAt)}</td>
                  <td className="px-4 py-3.5 text-ink-muted">
                    {u.lastSignInAt ? formatMemoryDate(u.lastSignInAt) : 'Never'}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`inline-flex items-center gap-1 text-[11px] ${u.status === 'active' ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-ink-faint'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${u.status === 'active' ? 'bg-emerald-500' : 'bg-ink-faint'}`} />
                      {u.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 4. Chronological Activity Telemetry */}
      <section className="space-y-4 mb-12">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint">
          Live Activity Feed (Latest Telemetry)
        </h2>
        <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-soft">
          {recentEvents.length === 0 ? (
            <div className="py-8 text-center text-xs text-ink-muted">
              <p>No telemetry events recorded yet.</p>
              <p className="text-ink-faint mt-1">Events stream here non-blockingly as users capture, edit, and search.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentEvents.map((ev) => (
                <div key={ev.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2.5 last:border-0 text-xs">
                  <div className="flex items-center gap-2.5">
                    <span className="rounded-md bg-surface px-2 py-1 text-[11px] font-mono text-ink">
                      {ev.eventType}
                    </span>
                    <span className="text-ink-muted font-medium">{ev.userEmail || 'anonymous'}</span>
                    {ev.query ? (
                      <span dir="auto" className="text-accent italic font-normal">
                        &ldquo;{ev.query}&rdquo;
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[11px] text-ink-faint">{formatMemoryDate(ev.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 5. System Health & Deployment Telemetry */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint">
          Service Health & Infrastructure
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-soft">
            <h3 className="text-xs font-semibold uppercase text-ink-faint mb-3">AI Intelligence Service</h3>
            <div className="space-y-1.5 text-xs text-ink">
              <p className="flex justify-between">
                <span className="text-ink-muted">Configured:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {systemHealth.aiServiceConfigured ? 'Active (OpenRouter)' : 'Disabled'}
                </span>
              </p>
              <p className="flex justify-between">
                <span className="text-ink-muted">Model:</span>
                <span className="font-mono text-[11px] truncate max-w-[160px]">{systemHealth.aiModel}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-ink-muted">Role:</span>
                <span>On-Demand Background Only ($0 Direct Search)</span>
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-soft">
            <h3 className="text-xs font-semibold uppercase text-ink-faint mb-3">Database & Storage</h3>
            <div className="space-y-1.5 text-xs text-ink">
              <p className="flex justify-between">
                <span className="text-ink-muted">PostgreSQL:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">Operational</span>
              </p>
              <p className="flex justify-between">
                <span className="text-ink-muted">RLS Security:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">Enforced</span>
              </p>
              <p className="flex justify-between">
                <span className="text-ink-muted">Storage Bucket:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">Private (memories)</span>
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-soft">
            <h3 className="text-xs font-semibold uppercase text-ink-faint mb-3">Runtime & Deployment</h3>
            <div className="space-y-1.5 text-xs text-ink">
              <p className="flex justify-between">
                <span className="text-ink-muted">Host:</span>
                <span className="font-mono text-[11px]">Oracle Cloud (80.225.68.223)</span>
              </p>
              <p className="flex justify-between">
                <span className="text-ink-muted">Node.js:</span>
                <span className="font-mono text-[11px]">{systemHealth.buildInfo.nodeVersion}</span>
              </p>
              <p className="flex justify-between">
                <span className="text-ink-muted">Process Uptime:</span>
                <span>{Math.round(systemHealth.buildInfo.uptimeSeconds / 60)} minutes</span>
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
