/**
 * Centralized voice output for Micah. ALL spoken output across every Twilio
 * route MUST go through `micahVoice()` so we can guarantee a single rule:
 *
 * BRAND-STRICT POLICY:
 *   "All spoken output must originate from ElevenLabs Aussie Micah voice
 *    (id=`MICAH_ELEVENLABS_VOICE_ID` from `lib/elevenlabs-tts.ts`) or pre-recorded static MP3 audio approved by
 *    Directive OS. Polly/Olivia, default Twilio system voices, or any other
 *    fallback are forbidden. Fallback to silence is acceptable only when all
 *    assets are unavailable. No other TTS system shall be present in this
 *    pipeline."
 *
 * Fallback chain (in order):
 *   1. ElevenLabs Aussie Micah MP3 (voice ID `MICAH_ELEVENLABS_VOICE_ID` — see `lib/elevenlabs-tts.ts`)
 *   2. Pre-recorded Aussie Micah MP3 at MICAH_FALLBACK_MP3_URL
 *   3. Silent <Pause> — logged loudly. Acceptable only when both (1) and (2)
 *      are unavailable. NEVER falls back to Polly or any other TTS engine.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import twilio from "twilio";
import { MICAH_ELEVENLABS_VOICE_ID } from "@/lib/elevenlabs-tts";
import {
  elevenLabsTtsPublicMp3Url,
  elevenLabsTtsPublicMp3UrlWithTimeout,
} from "@/lib/micah/elevenlabs-tts";
import {
  micahElevenLabsOptsForUtterance,
  textSuggestsEmpatheticTts,
} from "@/lib/micah/micah-empathy-tts";

type TwilioVoiceResponse = InstanceType<typeof twilio.twiml.VoiceResponse>;
type TwilioGather = ReturnType<TwilioVoiceResponse["gather"]>;
/** Twilio builders that support `<Play>` / `<Pause>` under Micah's brand policy. */
export type MicahVoiceTwiMLVerbHost =
  | Pick<TwilioVoiceResponse, "play" | "pause">
  | Pick<TwilioGather, "play" | "pause">;

export type MicahVoiceResult =
  | { kind: "audio"; url: string; text: string }
  | { kind: "fallback-mp3"; url: string; text: string }
  | { kind: "silent"; text: string };

/**
 * Synthesize `text` with Aussie Micah ElevenLabs voice. On any failure, returns
 * a result the caller renders into TwiML — either the `MICAH_FALLBACK_MP3_URL`
 * pre-recorded MP3, or `silent`. Polly / male / default voices are NOT in the
 * chain under any circumstance (brand policy).
 */
export async function micahVoice(opts: {
  text: string;
  callSid: string;
  supabase: SupabaseClient | null;
  label: string;
  /** Skip synthesis and `<Play>` this URL first (e.g. `MICAH_GREETING_MP3_URL`) — instant TwiML. */
  preferredPlayUrl?: string | null;
  /**
   * When set, ElevenLabs+upload is aborted after this many ms (then static MP3 / silent).
   * Omit for full synthesis (e.g. `/api/voice/process`).
   */
  ttsBudgetMs?: number | null;
}): Promise<MicahVoiceResult> {
  const { text, callSid, supabase, label, preferredPlayUrl, ttsBudgetMs } = opts;

  const preferred = preferredPlayUrl?.trim();
  if (preferred) {
    console.warn(`[micah/voice] ${label} <Play> static MP3 (bypasses ElevenLabs)`, {
      micahVoiceQA: true,
      event: "twiml_play_static_mp3",
      callSid,
      mp3Url: preferred,
      utteranceChars: text.length,
      elevenLabsVoiceIdIfSynthesised: MICAH_ELEVENLABS_VOICE_ID,
      brandPolicy:
        "ElevenLabs Aussie Micah OR pre-recorded MP3 only — Polly forbidden. Verify this asset is the Aussie Micah voice.",
    });
    return { kind: "audio", url: preferred, text };
  }

  const elOpts = micahElevenLabsOptsForUtterance(text);
  const empathyTuning = textSuggestsEmpatheticTts(text);

  try {
    const budget = ttsBudgetMs ?? undefined;
    const url =
      budget != null && budget > 0
        ? await elevenLabsTtsPublicMp3UrlWithTimeout(
            supabase,
            text,
            callSid,
            budget,
            elOpts
          )
        : await elevenLabsTtsPublicMp3Url(supabase, text, callSid, elOpts);
    if (url) {
      console.log(`[micah/voice] ${label} ok: ElevenLabs Aussie Micah`, {
        micahVoiceQA: true,
        event: "micah_voice_el_play_url",
        micahElevenLabsVoiceId: MICAH_ELEVENLABS_VOICE_ID,
        callSid,
        empathyTuning,
        mp3Url: url,
        utteranceChars: text.length,
      });
      return { kind: "audio", url, text };
    }
    console.warn(
      `[micah/voice] ${label} ElevenLabs returned null — checking MICAH_FALLBACK_MP3_URL`,
      {
        micahVoiceQA: true,
        event: "micah_voice_el_null_fallback",
        micahElevenLabsVoiceId: MICAH_ELEVENLABS_VOICE_ID,
        callSid,
        empathyTuning,
        reason:
          "EL URL null (check ELEVENLABS_API_KEY, SUPABASE_TTS_BUCKET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL; voice id is hardcoded in lib/elevenlabs-tts.ts)",
        nextHears: process.env.MICAH_FALLBACK_MP3_URL?.trim()
          ? "MICAH_FALLBACK_MP3_URL <Play> (pre-recorded Aussie Micah)"
          : "SILENT <Pause> — brand policy forbids Polly fallback",
      }
    );
  } catch (e) {
    console.error(`[micah/voice] ${label} ElevenLabs error — checking MICAH_FALLBACK_MP3_URL`, {
      micahVoiceQA: true,
      event: "micah_voice_el_error_fallback",
      micahElevenLabsVoiceId: MICAH_ELEVENLABS_VOICE_ID,
      callSid,
      empathyTuning,
      err: e,
    });
  }

  const staticMp3 = process.env.MICAH_FALLBACK_MP3_URL?.trim();
  if (staticMp3) {
    console.warn(`[micah/voice] ${label} fallback: MICAH_FALLBACK_MP3_URL <Play>`, {
      micahVoiceQA: true,
      event: "micah_voice_fallback_mp3_play",
      micahElevenLabsVoiceId: MICAH_ELEVENLABS_VOICE_ID,
      callSid,
      empathyTuning,
      mp3Url: staticMp3,
      whatCallerHears: "pre-recorded MP3 (must be Aussie Micah voice)",
      brandPolicy:
        "ElevenLabs Aussie Micah OR pre-recorded MP3 only — Polly forbidden",
    });
    return { kind: "fallback-mp3", url: staticMp3, text };
  }

  // SILENT — brand policy forbids Polly. Acceptable only when both assets unavailable.
  console.error(
    `[micah/voice] ${label} SILENT — both ElevenLabs and MICAH_FALLBACK_MP3_URL are unavailable. Brand policy forbids Polly fallback. Set MICAH_FALLBACK_MP3_URL to a public Aussie Micah MP3 to prevent silence.`,
    {
      micahVoiceQA: true,
      event: "micah_voice_silent_fallback",
      micahElevenLabsVoiceId: MICAH_ELEVENLABS_VOICE_ID,
      callSid,
      empathyTuning,
      textPreview: text.slice(0, 120),
      remediation:
        "Set MICAH_FALLBACK_MP3_URL to a public URL pointing to a pre-recorded Aussie Micah MP3 (e.g. an Aussie Micah ElevenLabs render of 'Sorry, I'm having trouble right now. Please try again later.' uploaded to your micah-tts bucket).",
    }
  );
  return { kind: "silent", text };
}

/**
 * Apply a `MicahVoiceResult` to a Twilio TwiML builder element (VoiceResponse
 * or Gather). Emits `<Play>` for audio/fallback-mp3 and `<Pause>` for silent.
 * NEVER emits `<Say>` — brand policy forbids Polly/Olivia and any non-Aussie-Micah
 * voice.
 */
export function applyMicahVoice(el: MicahVoiceTwiMLVerbHost, result: MicahVoiceResult): void {
  if (result.kind === "audio" || result.kind === "fallback-mp3") {
    console.log("[micah/voice/apply] TwiML <Play>", {
      micahVoiceQA: true,
      event: "twiml_apply_play",
      kind: result.kind,
      mp3Url: result.url,
      micahElevenLabsVoiceId: MICAH_ELEVENLABS_VOICE_ID,
      textPreview: result.text.slice(0, 100),
    });
    // VoiceResponse.play(url) and Gather.play({}, url) — call signature differs by builder context.
    try {
      (el as { play: (url: string) => unknown }).play(result.url);
    } catch {
      (el as { play: (attrs: object, url: string) => unknown }).play({}, result.url);
    }
    return;
  }
  // SILENT — brand policy forbids any TTS engine other than ElevenLabs Aussie Micah.
  // Caller will hear a short pause. Logged in micahVoice() above with remediation.
  console.warn("[micah/voice/apply] TwiML <Pause> (SILENT — brand policy: no Polly fallback)", {
    micahVoiceQA: true,
    event: "twiml_apply_silent_pause",
    kind: result.kind,
    micahElevenLabsVoiceId: MICAH_ELEVENLABS_VOICE_ID,
    textLen: result.text.length,
    textPreview: result.text.slice(0, 100),
    remediation: "Set MICAH_FALLBACK_MP3_URL to prevent silent fallback.",
  });
  el.pause({ length: 1 });
}
