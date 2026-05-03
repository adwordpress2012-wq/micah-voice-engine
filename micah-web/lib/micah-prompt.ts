import { buildMicahDirectiveGatherSystemPrompt } from "@/lib/micah/micah-directive-os-persona";

/**
 * Default Micah baseline for any legacy import (same locked persona as voice; main-line rules when `To` unknown).
 * Phone/webchat primary flows use `buildMasterSystemPromptV2` / per-route builders where applicable.
 */
export const MICAH_SYSTEM_PROMPT = buildMicahDirectiveGatherSystemPrompt("");
/**
 * Canonical HTTPS URL for Twilio `<Record>` / `<Gather>` action attributes.
 * When `req` is present (Twilio webhooks), uses `Host` / `x-forwarded-host` first
 * so custom domains (e.g. micah.directiveos.com.au) match the URL Twilio called.
 * Falls back to `NEXT_PUBLIC_APP_URL` when no usable host (e.g. some local runs).
 */
export function buildPublicBaseUrl(req?: Pick<Request, "headers">): string {
  if (req?.headers) {
    const host =
      req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
      req.headers.get("host")?.split(",")[0]?.trim();
    const protoPart =
      req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()?.toLowerCase() ?? "https";
    const proto = protoPart === "http" ? "http" : "https";
    if (host && !/^localhost(:\d+)?$/i.test(host)) {
      return `${proto}://${host}`;
    }
  }

  const explicit = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (explicit) return explicit;

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  throw new Error(
    "Set NEXT_PUBLIC_APP_URL for Twilio callbacks (e.g. https://micah.directiveos.com.au)"
  );
}

/**
 * Twilio `<Gather action="…">` must hit your stable production origin.
 * **Always** use `NEXT_PUBLIC_APP_URL` when set (Fly / Vercel canonical HTTPS).
 * If unset, falls back to request-derived URL and logs a `[Micah-Audit]` warning.
 */
export function resolveVoiceActionBaseUrl(req: Request): string {
  const canonical = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "").trim();
  if (canonical) return canonical;
  const derived = safeBuildPublicBaseUrl(req);
  console.warn(
    "[Micah-Audit] NEXT_PUBLIC_APP_URL unset — Gather action URL is derived from this request, not your canonical app URL:",
    derived
  );
  return derived;
}

/** Never throws — use in voice webhooks so Twilio always gets 200 + valid XML. */
export function safeBuildPublicBaseUrl(req: Request): string {
  try {
    return buildPublicBaseUrl(req);
  } catch {
    const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
    if (fromEnv) return fromEnv;
    try {
      const u = new URL(req.url);
      return `${u.protocol}//${u.host}`.replace(/\/$/, "");
    } catch {
      return "https://micah.directiveos.com.au";
    }
  }
}
