import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Public URL for a Storage object so Twilio `<Play>` can fetch MP3s.
 * Uses SDK `getPublicUrl` (follows `SUPABASE_URL` project ref) unless overridden for a new project / CDN.
 *
 * Optional: `SUPABASE_STORAGE_PUBLIC_URL_BASE` = origin through `/public` only, no trailing slash.
 * Example: `https://abcdefghijklmnop.supabase.co/storage/v1/object/public`
 */
export function getStorageObjectPublicUrl(
  supabase: SupabaseClient,
  bucket: string,
  objectPath: string
): string {
  const base = process.env.SUPABASE_STORAGE_PUBLIC_URL_BASE?.trim().replace(/\/$/, "");
  if (base) {
    const segments = objectPath.split("/").filter(Boolean);
    const encodedPath = segments.map((s) => encodeURIComponent(s)).join("/");
    return `${base}/${encodeURIComponent(bucket)}/${encodedPath}`;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  return data.publicUrl;
}
