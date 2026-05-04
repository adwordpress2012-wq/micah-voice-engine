/**
 * Spoken lines for Twilio `<Say>` — every helper returns a non-empty string (defaults are literals).
 * Optional env overrides are trimmed and capped for spoken line length.
 */

import { getMicahAgencyName } from "@/lib/micah/micah-directive-os-persona";

const MAX_SAY_CHARS = 500;

function safeTrim(s: string | undefined): string {
  const t = s?.trim() ?? "";
  return t.length > 0 ? t.slice(0, MAX_SAY_CHARS) : "";
}

/**
 * Gather opening inside `<Gather>` — canonical Micah greeting when `MICAH_AGENCY_NAME` is **Directive OS** (default):
 * "G'day! You've reached Directive OS, I'm Micah. How can I help you today?"
 * Override entirely with `MICAH_GATHER_GREETING` if needed.
 */
export function micahGatherOpeningSay(): string {
  const custom = safeTrim(process.env.MICAH_GATHER_GREETING);
  if (custom) return custom;
  const a = getMicahAgencyName();
  return `G'day! You've reached ${a}, I'm Micah. How can I help you today?`;
}

/** Short line before `<Connect><Stream>` — hear Micah immediately while Realtime links. */
export function micahRealtimePreconnectSay(): string {
  const custom = safeTrim(process.env.MICAH_REALTIME_PRECONNECT_SAY);
  if (custom) return custom;
  const a = getMicahAgencyName();
  return `G'day! You've reached ${a}, I'm Micah — one moment while I connect.`;
}

/** Gather fallback when gather times out (same as previous hard-coded copy). */
export function micahGatherTimeoutSay(): string {
  return (
    safeTrim(process.env.MICAH_GATHER_TIMEOUT_SAY) ||
    "I'll hang up for now — feel free to call back when you're ready. Bye!"
  );
}
