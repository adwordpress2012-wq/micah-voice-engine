/**
 * Twilio Voice: Gather uses `en-AU` for speech recognition. Spoken output prefers ElevenLabs `<Play>`,
 * with **Polly.Olivia** + **en-AU** fallback (Directive OS — never implicit male / generic Twilio `<Say>` defaults).
 */

import twilio from "twilio";

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

/** `<Play>` when URL exists; otherwise `<Say voice="Polly.Olivia" language="en-AU">` — never empty audio path. */
export function playOrPollyOliviaSay(
  vr: VoiceResponseInstance,
  mp3Url: string | null | undefined,
  fallbackSayText: string
): void {
  const u = mp3Url?.trim();
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
  if (u) gather.play(u);
  else gather.say(micahDirectiveOsSayAttributes(), fallbackSayText);
}
