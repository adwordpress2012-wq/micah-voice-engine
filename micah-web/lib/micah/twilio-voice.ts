/**
 * Twilio voice constants for Micah.
 *
 * HARD RULE: there is no Polly fallback. The Polly helpers (`micahPollyVoice`,
 * `micahSayAttributes`, `micahSayLine`) were removed because they could allow
 * Twilio to fall back to a default ("man") voice when AWS Polly was unavailable.
 *
 * All spoken output now goes through `micahVoice()` in `voice-output.ts`,
 * which uses ElevenLabs Aussie Micah → pre-recorded fallback MP3 → silence.
 *
 * Only the language constant is kept here because Twilio `<Gather language>`
 * still needs an en-AU hint for speech recognition (not for TTS).
 */

export const MICAH_SAY_LANGUAGE = "en-AU";
