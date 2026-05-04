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
import { micahDirectiveOsSayAttributes } from "@/lib/micah/twilio-voice";

type TwilioVoiceResponse = InstanceType<typeof twilio.twiml.VoiceResponse>;
type TwilioGather = ReturnType<TwilioVoiceResponse["gather"]>;
/** Twilio builders that support `<Play>` / `<Say>` under Micah’s fallback rules. */
export type MicahVoiceTwiMLVerbHost = Pick<TwilioVoiceResponse, "play" | "say"> | Pick<TwilioGather, "play" | "say">;

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
  /** Skip synthesis and `<Play>` this URL first (e.g. `MICAH_GREETING_MP3_URL`) — instant TwiML. */
  preferredPlayUrl?: string | null;
  /**
   * When set, ElevenLabs+upload is aborted after this many ms (then Polly / fallback MP3 / `<Say>`).
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
      note: "Verify this asset is female Aussie Micah; a wrong file here sounds like a wrong voice on the main line.",
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
      `[micah/voice] ${label} ElevenLabs returned null — caller will hear fallback (not silence)`,
      {
        micahVoiceQA: true,
        event: "micah_voice_el_null_fallback",
        micahElevenLabsVoiceId: MICAH_ELEVENLABS_VOICE_ID,
        callSid,
        empathyTuning,
        reason:
          "EL URL null (check ELEVENLABS_API_KEY, SUPABASE_TTS_BUCKET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL; voice id is hardcoded in lib/elevenlabs-tts.ts)",
        nextHears: process.env.MICAH_FALLBACK_MP3_URL?.trim()
          ? "MICAH_FALLBACK_MP3_URL Play"
          : "Polly.Olivia en-AU Say of script",
      }
    );
  } catch (e) {
    console.error(`[micah/voice] ${label} ElevenLabs error — caller will hear fallback (not silence)`, {
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
    console.warn(`[micah/voice] ${label} fallback: MICAH_FALLBACK_MP3_URL Play`, {
      micahVoiceQA: true,
      event: "micah_voice_fallback_mp3_play",
      micahElevenLabsVoiceId: MICAH_ELEVENLABS_VOICE_ID,
      callSid,
      empathyTuning,
      mp3Url: staticMp3,
      whatCallerHears: "pre-recorded MP3 (must be female Aussie Micah)",
      elevenLabsVoiceIdIfSynthesised: MICAH_ELEVENLABS_VOICE_ID,
      note: "If this file is wrong, callers hear the wrong voice — EL was skipped.",
    });
    return { kind: "fallback-mp3", url: staticMp3, text };
  }

  console.warn(`[micah/voice] ${label} fallback: Polly.Olivia <Say> en-AU`, {
    micahVoiceQA: true,
    event: "micah_voice_polly_olivia_say",
    micahElevenLabsVoiceId: MICAH_ELEVENLABS_VOICE_ID,
    pollyVoice: "Polly.Olivia",
    pollyLanguage: "en-AU",
    callSid,
    empathyTuning,
    whatCallerHears: "Polly.Olivia reads script (female Australian; EL unavailable)",
    textPreview: text.slice(0, 120),
  });
  return { kind: "say", text };
}

/**
 * Apply a `MicahVoiceResult` to a Twilio TwiML builder element (VoiceResponse
 * or Gather). Always emits an audible verb — never a silent pause.
 *
 * The Polly.Olivia `<Say>` fallback is the AWS Neural female Australian voice.
 * It is intentionally NOT silent and NOT male: it's the closest live-TTS match
 * to Aussie Micah when ElevenLabs is unavailable.
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
      el.play(result.url);
    } catch {
      el.play({}, result.url);
    }
    return;
  }
  console.log("[micah/voice/apply] TwiML <Say> Polly.Olivia en-AU", {
    micahVoiceQA: true,
    event: "twiml_apply_say_polly_olivia",
    kind: result.kind,
    pollyVoice: "Polly.Olivia",
    pollyLanguage: "en-AU",
    micahElevenLabsVoiceId: MICAH_ELEVENLABS_VOICE_ID,
    textLen: result.text.length,
    textPreview: result.text.slice(0, 100),
  });
  // Last-resort female en-AU TTS. Polly.Olivia is the AWS Neural Australian
  // English female voice — same gender + accent as Aussie Micah, different engine.
  el.say(micahDirectiveOsSayAttributes(), result.text);
}
