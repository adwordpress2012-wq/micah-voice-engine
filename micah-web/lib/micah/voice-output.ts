/**
 * Centralized voice output for Micah. ALL spoken output across every Twilio
 * route MUST go through `micahVoice()` so we can guarantee a single rule:
 *
 *   The only voice the caller ever hears is Aussie Micah (ElevenLabs voice
 *   `4Nz4vG2f9omkfcS8r4PJ`). If ElevenLabs is unavailable, the call falls
 *   back to a pre-recorded Aussie-Micah MP3 (MICAH_FALLBACK_MP3_URL) or to
 *   silence + redirect — NEVER to Polly, "man", or any default Twilio voice.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { elevenLabsTtsPublicMp3Url } from "@/lib/micah/elevenlabs-tts";

export type MicahVoiceResult =
  | { kind: "audio"; url: string }
  | { kind: "fallback-mp3"; url: string }
  | { kind: "silent" };

/**
 * Synthesize `text` with Aussie Micah ElevenLabs voice and return an MP3 URL.
 * On any failure: returns the pre-recorded fallback MP3 if MICAH_FALLBACK_MP3_URL
 * is set, otherwise `kind: "silent"` (caller should `<Pause>` + `<Redirect>`).
 */
export async function micahVoice(opts: {
  text: string;
  callSid: string;
  supabase: SupabaseClient | null;
  label: string;
}): Promise<MicahVoiceResult> {
  const { text, callSid, supabase, label } = opts;

  try {
    const url = await elevenLabsTtsPublicMp3Url(supabase, text, callSid);
    if (url) {
      console.log(`[micah/voice] ${label} ok: ElevenLabs Aussie Micah`);
      return { kind: "audio", url };
    }
  } catch (e) {
    console.error(`[micah/voice] ${label} ElevenLabs error:`, e);
  }

  const staticMp3 = process.env.MICAH_FALLBACK_MP3_URL?.trim();
  if (staticMp3) {
    console.warn(
      `[micah/voice] ${label} falling back to MICAH_FALLBACK_MP3_URL (pre-recorded Aussie Micah)`
    );
    return { kind: "fallback-mp3", url: staticMp3 };
  }

  console.warn(
    `[micah/voice] ${label} fully unavailable — silent pause + redirect (NO Polly fallback)`
  );
  return { kind: "silent" };
}

/**
 * Apply a `MicahVoiceResult` to a Twilio TwiML builder element (VoiceResponse
 * or Gather). For `silent`, emits a short pause so the call stays open.
 *
 * `el` accepts both VoiceResponse and the nested Gather builder via duck typing.
 */
export function applyMicahVoice(
  el: { play: (urlOrAttrs?: unknown, url?: string) => unknown; pause: (attrs?: { length?: number }) => unknown },
  result: MicahVoiceResult
): void {
  if (result.kind === "audio" || result.kind === "fallback-mp3") {
    // VoiceResponse.play(url) and Gather.play({}, url) — call signature differs by builder context.
    try {
      el.play(result.url);
    } catch {
      el.play({}, result.url);
    }
    return;
  }
  // Silent: short pause keeps the call alive without uttering a wrong voice.
  el.pause({ length: 1 });
}
