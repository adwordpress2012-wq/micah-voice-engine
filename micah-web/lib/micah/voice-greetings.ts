/**
 * Spoken lines for Twilio `<Say>` — every helper returns a non-empty string (defaults are literals).
 * Optional env overrides are trimmed and capped for spoken line length.
 */

import { MICAH_DOS_SBA_GREETING_TEXT } from "@/lib/micah/micah-directive-os-persona";

export { MICAH_DOS_SBA_GREETING_TEXT } from "@/lib/micah/micah-directive-os-persona";

const MAX_SAY_CHARS = 500;

function safeTrim(s: string | undefined): string {
  const t = s?.trim() ?? "";
  return t.length > 0 ? t.slice(0, MAX_SAY_CHARS) : "";
}

/** Gather opening inside `<Gather>` - locked DOS SBA greeting. */
export function micahGatherOpeningSay(): string {
  return MICAH_DOS_SBA_GREETING_TEXT;
}

/** Short line before `<Connect><Stream>` — hear Micah immediately while Realtime links. */
export function micahRealtimePreconnectSay(): string {
  return MICAH_DOS_SBA_GREETING_TEXT;
}

/** Gather fallback when gather times out (same as previous hard-coded copy). */
export function micahGatherTimeoutSay(): string {
  return (
    safeTrim(process.env.MICAH_GATHER_TIMEOUT_SAY) ||
    "I'll hang up for now — feel free to call back when you're ready. Bye!"
  );
}
