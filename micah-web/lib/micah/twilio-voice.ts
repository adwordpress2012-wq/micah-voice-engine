import { escapeXml } from "@/lib/twiml";

type TwilioVoice = import("twilio/lib/twiml/VoiceResponse");

/**
 * Twilio `<Say>` fallback when Cedar TTS is unavailable — sweet, young Australian Polly voice.
 * Override with MICAH_POLLY_VOICE (e.g. Polly.Nicole) if Olivia is unavailable in your region.
 */

export const MICAH_SAY_LANGUAGE = "en-AU";

/** Polly.Olivia is the AWS Neural en-AU female voice. Nicole is deprecated and causes Twilio to fall back to "man". */
export function micahPollyVoice(): string {
  return process.env.MICAH_POLLY_VOICE?.trim() || "Polly.Olivia";
}

/** Twilio Node SDK `say()` / nested `gather.say()` attributes (env voice string is widened to `SayVoice`). */
export function micahSayAttributes(): TwilioVoice["SayAttributes"] {
  return {
    voice: micahPollyVoice() as TwilioVoice["SayVoice"],
    language: MICAH_SAY_LANGUAGE as TwilioVoice["SayLanguage"],
  };
}

/** Single `<Say>` line with Micah’s Polly voice + Australian English. */
export function micahSayLine(text: string): string {
  const v = escapeXml(micahPollyVoice());
  const lang = escapeXml(MICAH_SAY_LANGUAGE);
  return `<Say voice="${v}" language="${lang}">${escapeXml(text)}</Say>`;
}
