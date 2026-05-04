/**
 * Safe previews for logs and `GET /api/voice/diagnostic` — never returns full secrets.
 */
export function maskApiCredential(value: string | undefined | null): string | null {
  const s = value?.trim();
  if (!s) return null;
  if (s.length <= 8) return "(too short to mask safely)";
  if (s.startsWith("sk-")) return `sk-…${s.slice(-4)}`;
  if (s.startsWith("sk_")) return `sk_…${s.slice(-4)}`;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

/** Supabase URL → hostname only (no path, no keys). */
export function supabaseConfiguredHostname(): string | null {
  const raw = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim()).hostname.toLowerCase();
  } catch {
    return "(invalid SUPABASE_URL)";
  }
}
