import { createClient } from '@supabase/supabase-js';

/**
 * Admin client for server-side operations that need to bypass RLS
 * Use this ONLY for server-side operations where you've already verified the user
 * WARNING: This bypasses RLS - only use when you've verified user authentication
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set in environment variables');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}











