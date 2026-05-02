import { escapeXml } from "@/lib/twiml";

/**
 * Twilio `<Say>` fallback when Cedar TTS is unavailable — sweet, young Australian Polly voice.
 * Override with MICAH_POLLY_VOICE (e.g. Polly.Nicole) if Olivia is unavailable in your region.
 */

export const MICAH_SAY_LANGUAGE = "en-AU";

export function micahPollyVoice(): string {
  return process.env.MICAH_POLLY_VOICE?.trim() || "Polly.Olivia";
}

/** Single `<Say>` line with Micah’s Polly voice + Australian English. */
export function micahSayLine(text: string): string {
  const v = escapeXml(micahPollyVoice());
  const lang = escapeXml(MICAH_SAY_LANGUAGE);
  return `<Say voice="${v}" language="${lang}">${escapeXml(text)}</Say>`;
}
