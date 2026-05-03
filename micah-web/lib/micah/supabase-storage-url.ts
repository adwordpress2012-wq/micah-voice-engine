import type { SupabaseClient } from "@supabase/supabase-js";

/** `abcdefgh...supabase.co` project ref from project URL. */
export function supabaseProjectRefFromEnv(): string | null {
  const raw = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw?.trim()) return null;
  try {
    const host = new URL(raw.trim()).hostname.toLowerCase();
    const m = /^([^.]+)\.supabase\.co$/i.exec(host);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Canonical public object URL (matches Supabase dashboard format):
 * `https://[PROJECT_REF].supabase.co/storage/v1/object/public/[bucket]/path/to/object.mp3`
 */
export function getCanonicalSupabasePublicObjectUrl(
  bucket: string,
  objectPath: string
): string | null {
  const ref = supabaseProjectRefFromEnv();
  if (!ref || !bucket.trim()) return null;
  const encodedPath = objectPath
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/");
  return `https://${ref}.supabase.co/storage/v1/object/public/${bucket}/${encodedPath}`;
}

/**
 * Public URL for a Storage object so Twilio `<Play>` can fetch MP3s.
 * Prefer canonical `…/storage/v1/object/public/{bucket}/…` when `SUPABASE_URL` is set (audit-friendly).
 *
 * Optional: `SUPABASE_STORAGE_PUBLIC_URL_BASE` = through `/public`, no trailing slash.
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

  const canonical = getCanonicalSupabasePublicObjectUrl(bucket, objectPath);
  if (canonical) return canonical;

  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  return data.publicUrl;
}
