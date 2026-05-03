/**
 * Twilio voice constants for Micah.
 *
 * HARD RULE: the legacy `micahPollyVoice` / `micahSayAttributes` / `micahSayLine`
 * helpers were removed because they read `MICAH_POLLY_VOICE` from env and could
 * therefore route to a male voice (Polly.Russell, "man") if misconfigured.
 *
 * All spoken output now goes through `micahVoice()` in `voice-output.ts`. Its
 * fallback chain is: ElevenLabs Aussie Micah → MICAH_FALLBACK_MP3_URL (if set)
 * → `<Say voice="Polly.Olivia" language="en-AU">` (hardcoded female AU). The
 * Polly.Olivia voice is hardcoded in voice-output.ts so it cannot be overridden
 * to anything male; it's the audible last-resort instead of silence.
 *
 * Only the language constant is kept here because Twilio `<Gather language>`
 * still needs an en-AU hint for speech recognition (not for TTS).
 */

export const MICAH_SAY_LANGUAGE = "en-AU";
