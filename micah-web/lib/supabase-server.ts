import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getServiceSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY");
  }
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}

/**
 * Returns null if env is missing — never throws (does not call `getServiceSupabase()`).
 * Uses the same module cache as `getServiceSupabase` when credentials exist.
 */
export function getServiceSupabaseOrNull(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }
  if (cached) return cached;
  try {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return cached;
  } catch (e) {
    console.error("getServiceSupabaseOrNull createClient:", e);
    return null;
  }
}
