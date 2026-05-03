/**
 * Centralized voice output for Micah. ALL spoken output across every Twilio
 * route MUST go through `micahVoice()` so we can guarantee a single rule:
 *
 * The caller ALWAYS hears Micah — never silence, never a male/default voice.
 *
 * Fallback chain (in order):
 *   1. ElevenLabs Aussie Micah MP3 (voice ID 4Nz4vG2f9omkfcS8r4PJ)
 *   2. Pre-recorded Aussie Micah MP3 at MICAH_FALLBACK_MP3_URL (if set)
 *   3. Twilio <Say> with voice="Polly.Olivia" language="en-AU" — AWS Neural
 *      female Australian voice. Same gender + accent as Aussie Micah, just
 *      a different TTS engine. NOT a male/default voice.
 *
 * There is no silent fallback. The user's hard rule is "audible Micah > silence".
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { elevenLabsTtsPublicMp3Url } from "@/lib/micah/elevenlabs-tts";

export type MicahVoiceResult =
  | { kind: "audio"; url: string; text: string }
  | { kind: "fallback-mp3"; url: string; text: string }
  | { kind: "say"; text: string };

/**
 * Synthesize `text` with Aussie Micah ElevenLabs voice. On any failure, returns
 * a result that the caller renders into TwiML — either a pre-recorded MP3 or a
 * `<Say>` with the female en-AU Polly.Olivia voice. Never returns silence.
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
      return { kind: "audio", url, text };
    }
    console.warn(`[micah/voice] ${label} ElevenLabs returned null (check ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID / SUPABASE_TTS_BUCKET / SUPABASE_SERVICE_ROLE_KEY)`);
  } catch (e) {
    console.error(`[micah/voice] ${label} ElevenLabs error:`, e);
  }

  const staticMp3 = process.env.MICAH_FALLBACK_MP3_URL?.trim();
  if (staticMp3) {
    console.warn(
      `[micah/voice] ${label} falling back to MICAH_FALLBACK_MP3_URL (pre-recorded Aussie Micah)`
    );
    return { kind: "fallback-mp3", url: staticMp3, text };
  }

  console.warn(
    `[micah/voice] ${label} ElevenLabs+MP3 unavailable — using <Say> Polly.Olivia (female en-AU). Set ELEVENLABS_API_KEY + SUPABASE_TTS_BUCKET to restore Aussie Micah.`
  );
  return { kind: "say", text };
}

type SayCapable = {
  play: (urlOrAttrs?: unknown, url?: string) => unknown;
  pause: (attrs?: { length?: number }) => unknown;
  say: (attrs: { voice?: string; language?: string }, text: string) => unknown;
};

/**
 * Apply a `MicahVoiceResult` to a Twilio TwiML builder element (VoiceResponse
 * or Gather). Always emits an audible verb — never a silent pause.
 *
 * The Polly.Olivia `<Say>` fallback is the AWS Neural female Australian voice.
 * It is intentionally NOT silent and NOT male: it's the closest live-TTS match
 * to Aussie Micah when ElevenLabs is unavailable.
 */
export function applyMicahVoice(el: SayCapable, result: MicahVoiceResult): void {
  if (result.kind === "audio" || result.kind === "fallback-mp3") {
    // VoiceResponse.play(url) and Gather.play({}, url) — call signature differs by builder context.
    try {
      el.play(result.url);
    } catch {
      el.play({}, result.url);
    }
    return;
  }
  // Last-resort female en-AU TTS. Polly.Olivia is the AWS Neural Australian
  // English female voice — same gender + accent as Aussie Micah, different engine.
  el.say({ voice: "Polly.Olivia", language: "en-AU" }, result.text);
}
