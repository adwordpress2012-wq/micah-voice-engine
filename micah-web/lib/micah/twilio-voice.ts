/**
 * Twilio Voice: Gather uses `en-AU` for speech recognition. Spoken output prefers ElevenLabs `<Play>`,
 * with **Polly.Olivia** + **en-AU** fallback (Directive OS — never implicit male / generic Twilio `<Say>` defaults).
 *
 * Every branch logs **`micahVoiceQA`** (see Directive OS `AGENTS.md` — Cursor session paste).
 */

import twilio from "twilio";
import { MICAH_ELEVENLABS_VOICE_ID } from "@/lib/elevenlabs-tts";

/** Speech recognition language for `<Gather>` (STT). */
export const MICAH_SAY_LANGUAGE = "en-AU";

type TwilioVoice = import("twilio/lib/twiml/VoiceResponse");
type GatherInstance = ReturnType<TwilioVoice["gather"]>;

/** Explicit Australian female Polly voice — used whenever `<Play>` URL is unavailable. */
export function micahDirectiveOsSayAttributes(): TwilioVoice["SayAttributes"] {
  return {
    voice: "Polly.Olivia",
    language: MICAH_SAY_LANGUAGE as TwilioVoice["SayLanguage"],
  };
}

type VoiceResponseInstance = InstanceType<typeof twilio.twiml.VoiceResponse>;

function logMicahVoiceQaTwilioVerb(opts: {
  event: string;
  usedPlay: boolean;
  mp3Url: string | null | undefined;
  fallbackSayChars: number;
}): void {
  const u = opts.mp3Url?.trim() ?? "";
  console.log("[micah/twilio-voice]", {
    micahVoiceQA: true,
    event: opts.event,
    voiceId: MICAH_ELEVENLABS_VOICE_ID,
    usedPlay: opts.usedPlay,
    pollyVoice: opts.usedPlay ? null : "Polly.Olivia",
    pollyLanguage: opts.usedPlay ? null : MICAH_SAY_LANGUAGE,
    pipeline: opts.usedPlay
      ? "Twilio <Play> — URL from caller (EL→Supabase MP3 or static asset); EL voice id in app is hardcoded only"
      : "Twilio <Say> — Polly.Olivia + en-AU via micahDirectiveOsSayAttributes() only",
    mp3UrlPreview: u ? u.slice(0, 160) : null,
    fallbackSayChars: opts.fallbackSayChars,
  });
}

/** `<Play>` when URL exists; otherwise `<Say voice="Polly.Olivia" language="en-AU">` — never empty audio path. */
export function playOrPollyOliviaSay(
  vr: VoiceResponseInstance,
  mp3Url: string | null | undefined,
  fallbackSayText: string
): void {
  const u = mp3Url?.trim();
  logMicahVoiceQaTwilioVerb({
    event: "play_or_polly_olivia_voice_response",
    usedPlay: !!u,
    mp3Url,
    fallbackSayChars: fallbackSayText.length,
  });
  if (u) vr.play(u);
  else vr.say(micahDirectiveOsSayAttributes(), fallbackSayText);
}

/** Same as {@link playOrPollyOliviaSay} for verbs nested under `<Gather>`. */
export function gatherPlayOrPollyOliviaSay(
  gather: GatherInstance,
  mp3Url: string | null | undefined,
  fallbackSayText: string
): void {
  const u = mp3Url?.trim();
  logMicahVoiceQaTwilioVerb({
    event: "play_or_polly_olivia_gather",
    usedPlay: !!u,
    mp3Url,
    fallbackSayChars: fallbackSayText.length,
  });
  if (u) gather.play(u);
  else gather.say(micahDirectiveOsSayAttributes(), fallbackSayText);
}
