/**
 * ElevenLabs empathy tuning for Micah — single place to extend keyword triggers (audit-friendly).
 *
 * Default TTS uses API defaults in {@link convertTextToSpeech} (`stability: 0.5`, `similarity_boost: 0.8`).
 * When utterance text matches {@link textSuggestsEmpatheticTts}, use steadier settings for illness / urgency / distress.
 */

import type { ElevenLabsVoiceSettings } from "@/lib/elevenlabs-tts";
import type { ElevenLabsTtsPublicOpts } from "@/lib/micah/elevenlabs-tts";

/** Canonical empathetic delivery (Directive OS Micah receptionist spec). */
export const MICAH_EMPATHY_ELEVENLABS: Partial<ElevenLabsVoiceSettings> = {
  stability: 0.78,
  similarity_boost: 0.82,
};

/**
 * Word-boundary triggers: illness, urgency, distress, hospital context.
 * Extend this pattern as product adds more empathy cases — keep reviews in AGENTS.md sync.
 */
const EMPATHY_PATTERN =
  /\b(sick|unwell|ill(?:ness)?|not\s+feeling\s+well|under\s+the\s+weather|poorly|urgent|urgently|emergency|emergencies|in\s+pain|hospital|hospitali[sz]ed|crisis|frightened|worried|distressed|anxious|panic(?:ked|king)?|asap|straight\s+away|right\s+away)\b/i;

export function textSuggestsEmpatheticTts(text: string): boolean {
  return EMPATHY_PATTERN.test(text);
}

/** Pass as the last argument to {@link elevenLabsTtsPublicMp3Url} / {@link elevenLabsTtsPublicMp3UrlWithTimeout}. */
export function micahElevenLabsOptsForUtterance(
  text: string
): ElevenLabsTtsPublicOpts | undefined {
  return textSuggestsEmpatheticTts(text)
    ? { voiceSettings: MICAH_EMPATHY_ELEVENLABS }
    : undefined;
}
