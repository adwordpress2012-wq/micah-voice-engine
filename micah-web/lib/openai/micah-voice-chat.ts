/**
 * OpenAI chat surface for **Micah** voice (`/api/voice/process`).
 *
 * **`OPENAI_API_KEY`** is read only in `app/api/voice/process/route.ts` via `process.env.OPENAI_API_KEY`
 * (never logged in full — use {@link describeOpenAiKeyForDiagnostics} for masked previews).
 *
 * **`buildMicahVoiceSystemPrompt`** here wraps the Directive OS baseline with **Statewide Commercial /
 * Jayson** empathy rules (industrial real estate).
 */

import { maskApiCredential } from "@/lib/micah/mask-api-credential";
import {
  buildMicahVoiceSystemPrompt as micahVoiceSystemPromptCore,
  MICAH_OPENAI_OFFLINE_FALLBACK,
} from "@/lib/micah/micah-voice-persona";

export { MICAH_OPENAI_OFFLINE_FALLBACK } from "@/lib/micah/micah-voice-persona";

export { describeElevenLabsKeyForDiagnostics } from "@/lib/elevenlabs-tts";

/** Appended to the core Micah persona for voice gather chat. */
const STATEWIDE_COMMERCIAL_JAYSON_EMPATHY = `
You are Micah on the line for Jayson at Statewide Commercial — same receptionist persona; when the caller is Jayson (or clearly addressing Jayson) and mentions being sick or sounds unwell, start with one brief, genuine line of empathy (for example: "I'm sorry to hear you're not feeling well, Jayson") before you continue with the commercial or property topic he raised.
Keep that empathy to one short sentence unless Jayson wants to talk more about how he feels.
`.trim();

/** Full system prompt for `/api/voice/process` — core Micah persona plus Jayson / Statewide empathy layer. */
export function buildMicahVoiceSystemPrompt(dialedTo?: string): string {
  return `${micahVoiceSystemPromptCore(dialedTo)}\n\n${STATEWIDE_COMMERCIAL_JAYSON_EMPATHY}`;
}

/** Safe for `/api/voice/diagnostic` and structured logs — never returns the raw key. */
export function describeOpenAiKeyForDiagnostics(): {
  configured: boolean;
  mask: string | null;
  looksLikeOpenAiSkPrefix: boolean;
} {
  const k = process.env.OPENAI_API_KEY?.trim();
  return {
    configured: !!k,
    mask: maskApiCredential(k),
    looksLikeOpenAiSkPrefix: k?.startsWith("sk-") ?? false,
  };
}
