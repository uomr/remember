'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Sign the current user out and return them to the sign-in screen.
 * Server Action — safe to call from a form; the session cookies are cleared
 * server-side by @supabase/ssr.
 */
export async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect('/sign-in');
}
