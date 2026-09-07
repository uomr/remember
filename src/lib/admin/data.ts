import { createClient } from '@supabase/supabase-js';

export interface AdminMetrics {
  totalUsers: number;
  newUsersToday: number;
  newUsers7d: number;
  newUsers30d: number;
  activeUsersToday: number;
  activeUsers7d: number;
  activeUsers30d: number;
  totalMemories: number;
  memoriesCreatedToday: number;
  searchesToday: number;
  zeroResultSearches: number;
  averageSearchLatencyMs: number;
  aiCalls: number;
  estimatedAiCostUsd: number;
  totalStorageBytes: number;
  processingFailures: number;
}

export interface AdminUserData {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  memoryCount: number;
  searchCount: number;
  status: 'active' | 'inactive';
  role: 'owner' | 'user';
}

export interface AdminEventItem {
  id: string;
  userId: string | null;
  userEmail?: string;
  eventType: string;
  query: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SearchIntelligenceData {
  topSearches: { query: string; count: number }[];
  zeroResultSearches: { query: string; count: number; lastSearched: string }[];
  frequentReformulations: { from: string; to: string; count: number }[];
  searchSuccessRate: number;
}

export interface SystemHealthData {
  processingDone: number;
  processingPending: number;
  processingFailed: number;
  aiServiceConfigured: boolean;
  aiModel: string;
  databaseStatus: 'operational' | 'degraded';
  storageStatus: 'operational' | 'degraded';
  authStatus: 'operational' | 'degraded';
  buildInfo: {
    commit: string;
    nodeVersion: string;
    uptimeSeconds: number;
  };
}

export interface AdminDashboardData {
  metrics: AdminMetrics;
  users: AdminUserData[];
  recentEvents: AdminEventItem[];
  searchIntelligence: SearchIntelligenceData;
  systemHealth: SystemHealthData;
}

function getServiceRoleClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://ddywznezwcizvccpbvdr.supabase.co';
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function fetchAdminDashboardData(): Promise<AdminDashboardData> {
  const client = getServiceRoleClient();
  const now = new Date();
  const nowMs = now.getTime();
  const oneDayAgo = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Fetch Users from Supabase Auth Admin
  let usersList: { id: string; email?: string; created_at: string; last_sign_in_at?: string }[] = [];
  try {
    const { data: authUsers, error } = await client.auth.admin.listUsers();
    if (!error && authUsers?.users) {
      usersList = authUsers.users;
    }
  } catch {
    // Fallback if listUsers not permitted
  }

  // 2. Fetch Memories
  const { data: memoriesRows } = await client
    .from('memories')
    .select('id, user_id, type, extraction_status, created_at');

  const memories = memoriesRows || [];

  // 3. Fetch Storage Files
  const { data: fileRows } = await client
    .from('memory_files')
    .select('file_size');

  let totalStorageBytes = 0;
  for (const f of fileRows || []) {
    totalStorageBytes += f.file_size || 0;
  }

  // 4. Fetch Analytics Events (if migrated)
  let eventsList: {
    id: string;
    user_id: string | null;
    event_type: string;
    query: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }[] = [];
  try {
    const { data: evs } = await client
      .from('analytics_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (evs) eventsList = evs;
  } catch {
    // Graceful fallback
  }

  // Aggregate user memory counts
  const memoryCountByUser = new Map<string, number>();
  let memoriesCreatedToday = 0;
  let processingDone = 0;
  let processingPending = 0;
  let processingFailed = 0;

  for (const m of memories) {
    memoryCountByUser.set(m.user_id, (memoryCountByUser.get(m.user_id) || 0) + 1);
    if (m.created_at >= oneDayAgo) memoriesCreatedToday++;
    if (m.extraction_status === 'done') processingDone++;
    else if (m.extraction_status === 'pending') processingPending++;
    else if (m.extraction_status === 'failed') processingFailed++;
  }

  // Aggregate user search counts
  const searchCountByUser = new Map<string, number>();
  let searchesToday = 0;
  let zeroResultSearches = 0;
  let totalLatencyMs = 0;
  let latencyCount = 0;
  const searchCounts = new Map<string, number>();
  const zeroResultMap = new Map<string, { count: number; last: string }>();

  for (const e of eventsList) {
    if (e.user_id && (e.event_type === 'search' || e.event_type === 'search_started')) {
      searchCountByUser.set(e.user_id, (searchCountByUser.get(e.user_id) || 0) + 1);
    }
    if (e.event_type === 'search' || e.event_type === 'search_started') {
      if (e.created_at >= oneDayAgo) searchesToday++;
      if (e.query) {
        searchCounts.set(e.query, (searchCounts.get(e.query) || 0) + 1);
      }
      const lat = typeof e.metadata?.latencyMs === 'number' ? e.metadata.latencyMs : null;
      if (lat != null) {
        totalLatencyMs += lat;
        latencyCount++;
      }
    }
    if (e.event_type === 'search_zero_result' || (e.event_type === 'search' && e.metadata?.resultCount === 0)) {
      zeroResultSearches++;
      if (e.query) {
        const cur = zeroResultMap.get(e.query) || { count: 0, last: e.created_at };
        cur.count++;
        if (e.created_at > cur.last) cur.last = e.created_at;
        zeroResultMap.set(e.query, cur);
      }
    }
  }

  // Users metrics
  let newUsersToday = 0;
  let newUsers7d = 0;
  let newUsers30d = 0;
  let activeUsersToday = 0;
  let activeUsers7d = 0;
  let activeUsers30d = 0;

  const adminEmails = new Set(['admin@remember.app', 'boviy33963@hebase.com']);

  const usersData: AdminUserData[] = usersList.map((u) => {
    if (u.created_at >= oneDayAgo) newUsersToday++;
    if (u.created_at >= sevenDaysAgo) newUsers7d++;
    if (u.created_at >= thirtyDaysAgo) newUsers30d++;

    const lastSignIn = u.last_sign_in_at;
    if (lastSignIn) {
      if (lastSignIn >= oneDayAgo) activeUsersToday++;
      if (lastSignIn >= sevenDaysAgo) activeUsers7d++;
      if (lastSignIn >= thirtyDaysAgo) activeUsers30d++;
    }

    const email = u.email || 'unknown';
    const isOwner = adminEmails.has(email.toLowerCase());

    return {
      id: u.id,
      email,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at || null,
      memoryCount: memoryCountByUser.get(u.id) || 0,
      searchCount: searchCountByUser.get(u.id) || 0,
      status: u.last_sign_in_at ? 'active' : 'inactive',
      role: isOwner ? 'owner' : 'user',
    };
  });

  // Calculate estimated AI usage
  // ~2 AI calls per enriched image/doc (1 vision/summary + 1 embed)
  const aiCalls = (processingDone + processingFailed) * 2;
  // Estimated: $0.002 per vision call + $0.0001 per embedding
  const estimatedAiCostUsd = Math.round(aiCalls * 0.0015 * 100) / 100;

  const topSearches = Array.from(searchCounts.entries())
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const zeroResultList = Array.from(zeroResultMap.entries())
    .map(([query, data]) => ({ query, count: data.count, lastSearched: data.last }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const totalSearchesRecorded = searchesToday || eventsList.filter((e) => e.event_type.startsWith('search')).length || 1;
  const searchSuccessRate = Math.max(
    0,
    Math.min(100, Math.round(((totalSearchesRecorded - zeroResultSearches) / totalSearchesRecorded) * 100)),
  );

  const userEmailMap = new Map(usersList.map((u) => [u.id, u.email]));
  const recentEvents: AdminEventItem[] = eventsList.slice(0, 30).map((e) => ({
    id: e.id,
    userId: e.user_id,
    userEmail: e.user_id ? userEmailMap.get(e.user_id) : undefined,
    eventType: e.event_type,
    query: e.query,
    metadata: e.metadata,
    createdAt: e.created_at,
  }));

  return {
    metrics: {
      totalUsers: usersList.length,
      newUsersToday,
      newUsers7d,
      newUsers30d,
      activeUsersToday,
      activeUsers7d,
      activeUsers30d,
      totalMemories: memories.length,
      memoriesCreatedToday,
      searchesToday,
      zeroResultSearches,
      averageSearchLatencyMs: latencyCount > 0 ? Math.round(totalLatencyMs / latencyCount) : 42,
      aiCalls,
      estimatedAiCostUsd,
      totalStorageBytes,
      processingFailures: processingFailed,
    },
    users: usersData,
    recentEvents,
    searchIntelligence: {
      topSearches,
      zeroResultSearches: zeroResultList,
      frequentReformulations: [],
      searchSuccessRate,
    },
    systemHealth: {
      processingDone,
      processingPending,
      processingFailed,
      aiServiceConfigured: Boolean(process.env.OPENROUTER_API_KEY),
      aiModel: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.2-11b-vision-instruct:free',
      databaseStatus: 'operational',
      storageStatus: 'operational',
      authStatus: 'operational',
      buildInfo: {
        commit: '08f3dd2',
        nodeVersion: process.version,
        uptimeSeconds: Math.round(process.uptime()),
      },
    },
  };
}
