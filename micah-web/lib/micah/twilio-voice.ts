/**
 * Twilio Voice helpers — BRAND-STRICT POLICY:
 *
 *   "All spoken output must originate from ElevenLabs Aussie Micah voice
 *    (id=`MICAH_ELEVENLABS_VOICE_ID` from `lib/elevenlabs-tts.ts`) or pre-recorded static MP3 audio approved by
 *    Directive OS. Polly/Olivia, default Twilio system voices, or any other
 *    fallback are forbidden. Fallback to silence is acceptable only when all
 *    assets are unavailable. No other TTS system shall be present in this
 *    pipeline."
 *
 * `<Gather>` still uses `language="en-AU"` for speech-recognition (STT) hints
 * — that's not TTS. The legacy Polly helpers (`micahDirectiveOsSayAttributes`,
 * `playOrPollyOliviaSay`, `gatherPlayOrPollyOliviaSay`) have been deleted.
 *
 * Every branch logs `micahVoiceQA: true` for the audit trail.
 */

import twilio from "twilio";
import { MICAH_ELEVENLABS_VOICE_ID } from "@/lib/elevenlabs-tts";

/** Speech recognition language for `<Gather>` (STT). NOT a TTS attribute. */
export const MICAH_SAY_LANGUAGE = "en-AU";
const MICAH_PRODUCTION_VOICE_ORIGIN = "https://micah.directiveos.com.au";

type TwilioVoice = import("twilio/lib/twiml/VoiceResponse");
type GatherInstance = ReturnType<TwilioVoice["gather"]>;
type VoiceResponseInstance = InstanceType<typeof twilio.twiml.VoiceResponse>;

/** Single source of truth for the static MP3 fallback URL. */
function micahFallbackMp3Url(): string | null {
  const url = process.env.MICAH_FALLBACK_MP3_URL?.trim();
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${MICAH_PRODUCTION_VOICE_ORIGIN}${url}`;
  return null;
}

function logMicahVoiceQaTwilioVerb(opts: {
  event: string;
  usedPlay: boolean;
  mp3Url: string | null | undefined;
  staticMp3Url: string | null;
  intendedTextChars: number;
}): void {
  console.log("[micah/twilio-voice]", {
    micahVoiceQA: true,
    event: opts.event,
    voiceId: MICAH_ELEVENLABS_VOICE_ID,
    usedPlay: opts.usedPlay,
    pipeline: opts.usedPlay
      ? "Twilio <Play> — primary URL (ElevenLabs Aussie Micah MP3 from Supabase)"
      : opts.staticMp3Url
        ? "Twilio <Play> — MICAH_FALLBACK_MP3_URL static asset (pre-recorded Aussie Micah)"
        : "SILENT — both ElevenLabs AND MICAH_FALLBACK_MP3_URL unavailable; brand policy forbids Polly fallback",
    primaryMp3UrlPreview: opts.mp3Url?.trim().slice(0, 160) || null,
    fallbackMp3UrlPreview: opts.staticMp3Url?.slice(0, 160) || null,
    intendedTextChars: opts.intendedTextChars,
    brandPolicy:
      "Aussie Micah ElevenLabs OR static MP3 only — Polly/Olivia/default voices forbidden",
  });
}

/**
 * Emit `<Play>` for `mp3Url` when present; otherwise `<Play>` the
 * `MICAH_FALLBACK_MP3_URL` static asset; otherwise `<Pause>` (silent — logged
 * loudly). NEVER emits `<Say>`. The `intendedText` argument is preserved for
 * logging only — it is never spoken.
 */
export function playOrFallbackMp3(
  vr: VoiceResponseInstance,
  mp3Url: string | null | undefined,
  intendedText: string
): void {
  const u = mp3Url?.trim();
  const fb = micahFallbackMp3Url();
  logMicahVoiceQaTwilioVerb({
    event: "play_or_fallback_voice_response",
    usedPlay: !!u,
    mp3Url,
    staticMp3Url: fb,
    intendedTextChars: intendedText.length,
  });
  if (u) {
    vr.play(u);
    return;
  }
  if (fb) {
    vr.play(fb);
    return;
  }
  console.error(
    "[micah/twilio-voice] SILENT <Pause> — MICAH_FALLBACK_MP3_URL not set and ElevenLabs unavailable. Caller will hear silence. Brand policy forbids Polly. Intended text (NOT spoken):",
    intendedText.slice(0, 200)
  );
  vr.pause({ length: 1 });
}

/** Same as {@link playOrFallbackMp3} for verbs nested under `<Gather>`. */
export function gatherPlayOrFallbackMp3(
  gather: GatherInstance,
  mp3Url: string | null | undefined,
  intendedText: string
): void {
  const u = mp3Url?.trim();
  const fb = micahFallbackMp3Url();
  logMicahVoiceQaTwilioVerb({
    event: "play_or_fallback_gather",
    usedPlay: !!u,
    mp3Url,
    staticMp3Url: fb,
    intendedTextChars: intendedText.length,
  });
  if (u) {
    gather.play(u);
    return;
  }
  if (fb) {
    gather.play(fb);
    return;
  }
  console.error(
    "[micah/twilio-voice] SILENT <Pause> in <Gather> — MICAH_FALLBACK_MP3_URL not set and ElevenLabs unavailable. Caller will hear silence. Brand policy forbids Polly. Intended text (NOT spoken):",
    intendedText.slice(0, 200)
  );
  gather.pause({ length: 1 });
}
