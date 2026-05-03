import { escapeXml } from "@/lib/twiml";

type TwilioVoice = import("twilio/lib/twiml/VoiceResponse");

/**
 * Twilio `<Say>` fallback used only when ElevenLabs is unavailable.
 * Hard rule: ALWAYS a female en-AU voice. Male/neutral overrides are rejected.
 */

export const MICAH_SAY_LANGUAGE = "en-AU";

/** Whitelist of female en-AU Polly voices. Anything else falls back to Polly.Olivia. */
const FEMALE_AU_POLLY_VOICES = new Set([
  "Polly.Olivia",   // Neural en-AU female (preferred)
  "Polly.Nicole",   // Standard en-AU female (deprecated, kept as escape hatch)
]);

/** Polly.Olivia is the AWS Neural en-AU female voice. Any non-female-AU override is rejected. */
export function micahPollyVoice(): string {
  const override = process.env.MICAH_POLLY_VOICE?.trim();
  if (override && FEMALE_AU_POLLY_VOICES.has(override)) {
    return override;
  }
  if (override) {
    console.warn(
      `[micah/voice] MICAH_POLLY_VOICE="${override}" rejected — not a female en-AU voice. Forcing Polly.Olivia.`
    );
  }
  return "Polly.Olivia";
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
