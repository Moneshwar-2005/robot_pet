import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { getSupabaseEnv } from './env';

const envResult = getSupabaseEnv();

export const isSupabaseConfigured: boolean = envResult.isConfigured;
export const supabaseEnvErrors: readonly string[] = Object.freeze([...envResult.errors]);

/**
 * Centralized, typed Supabase client singleton for Kuro.
 * When environment variables are missing or malformed, this is null so the module
 * remains completely safe to import without throwing runtime exceptions or using dummy keys.
 */
export const supabase: SupabaseClient<Database> | null =
  envResult.isConfigured && envResult.supabaseUrl && envResult.supabasePublishableKey
    ? createClient<Database>(envResult.supabaseUrl, envResult.supabasePublishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

/**
 * Safe accessor for callers requiring an active Supabase client.
 * Throws a clean, non-sensitive configuration error if the client is unconfigured.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (!supabase) {
    throw new Error(
      'Supabase client is not configured. Verify that VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are configured in your environment.'
    );
  }
  return supabase;
}
