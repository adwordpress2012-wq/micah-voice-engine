/**
 * Micah — spoken output uses ElevenLabs only in TwiML (`<Play>`); this file is LLM persona + sanitisation.
 */

import { buildMicahDirectiveGatherSystemPrompt } from "@/lib/micah/micah-directive-os-persona";

/** System prompt for `/api/voice/process` — full locked persona (pass Twilio `To`). */
export function buildMicahVoiceSystemPrompt(dialedTo?: string): string {
  return buildMicahDirectiveGatherSystemPrompt(dialedTo);
}

/** Follow-up text synthesised via ElevenLabs inside `<Gather>` after each AI turn. */
export const MICAH_GATHER_FOLLOWUP_PROMPT =
  "Is there anything else I can help with?";

/**
 * When OpenAI chat is unavailable, callers still hear Micah stay in character.
 * Override with `MICAH_OPENAI_OFFLINE_FALLBACK` if you need different copy.
 */
export const MICAH_OPENAI_OFFLINE_FALLBACK =
  process.env.MICAH_OPENAI_OFFLINE_FALLBACK?.trim() ||
  "G'day — I'm having a quick moment on the line, but I'm right here with you. How can I help today?";

/** Plain sentences for ElevenLabs / Twilio (no markdown). */
export function sanitizeForMicahSpeech(raw: string): string {
  let t = raw.trim();
  t = t.replace(/\r\n/g, "\n").replace(/\n+/g, " ");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  t = t.replace(/^["'`]+|["'`]+$/g, "");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t.slice(0, 1200);
}

/** Limit caller transcript size before sending to the model (cost + abuse). */
export function clampTranscriptForModel(text: string, maxChars = 2500): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}…`;
}
