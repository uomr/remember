import { createClient } from '@/lib/supabase/server';

export interface AdminAuthResult {
  authorized: boolean;
  user: {
    id: string;
    email?: string;
  } | null;
  status: 200 | 401 | 403;
}

/**
 * Robust, server-enforced authorization gate for Admin v1.
 *
 * Rules:
 * 1. Must be authenticated with an active session (status 401 if unauthenticated).
 * 2. User's email or user ID must match configured ADMIN_EMAILS / ADMIN_USER_IDS,
 *    or app_metadata.role === 'admin' (status 403 if not authorized).
 * 3. Never trust client headers or client-provided metadata.
 */
export async function getAdminUser(): Promise<AdminAuthResult> {
  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { authorized: false, user: null, status: 401 };
  }

  // Configured authorized admin emails
  const defaultAdmins = ['admin@remember.app', 'boviy33963@hebase.com'];
  const envEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const allowedEmails = new Set([...defaultAdmins, ...envEmails]);

  const envIds = (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const allowedIds = new Set(envIds);

  const userEmail = (user.email || '').toLowerCase();
  const isEmailAdmin = allowedEmails.has(userEmail);
  const isIdAdmin = allowedIds.has(user.id);
  const isRoleAdmin =
    user.app_metadata?.role === 'admin' || user.user_metadata?.role === 'admin';

  if (isEmailAdmin || isIdAdmin || isRoleAdmin) {
    return {
      authorized: true,
      user: { id: user.id, email: user.email },
      status: 200,
    };
  }

  return {
    authorized: false,
    user: { id: user.id, email: user.email },
    status: 403,
  };
}
