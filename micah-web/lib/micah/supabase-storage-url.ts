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
  let url: string;
  if (base) {
    const segments = objectPath.split("/").filter(Boolean);
    const encodedPath = segments.map((s) => encodeURIComponent(s)).join("/");
    url = `${base}/${encodeURIComponent(bucket)}/${encodedPath}`;
  } else {
    const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    url = data.publicUrl;
  }
  // Surface the exact URL Twilio will be told to <Play> so we can verify the
  // bucket / project / path is correct without guessing.
  console.log(`[micah/storage] public url (bucket="${bucket}"):`, url);
  return url;
}
