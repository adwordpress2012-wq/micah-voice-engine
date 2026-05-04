/**
 * OpenAI chat surface for **Micah** voice (`/api/voice/process`).
 *
 * **`OPENAI_API_KEY`** is read only in `app/api/voice/process/route.ts` via `process.env.OPENAI_API_KEY`
 * (never logged in full — use {@link describeOpenAiKeyForDiagnostics} for masked previews).
 *
 * Builds a **BookOS-ready** system prompt: dynamic **`agencyName`** / **`serviceArea`** (see
 * {@link MicahPromptContext}), residential + small-business reception knowledge, and a scoped
 * Jayson health empathy block only when relevant.
 */

import { maskApiCredential } from "@/lib/micah/mask-api-credential";
import {
  buildMicahDirectiveGatherSystemPrompt,
  type MicahPromptContext,
} from "@/lib/micah/micah-directive-os-persona";
import { MICAH_OPENAI_OFFLINE_FALLBACK } from "@/lib/micah/micah-voice-persona";

export type { MicahPromptContext } from "@/lib/micah/micah-directive-os-persona";
export { MICAH_OPENAI_OFFLINE_FALLBACK } from "@/lib/micah/micah-voice-persona";

export { describeElevenLabsKeyForDiagnostics } from "@/lib/elevenlabs-tts";

/**
 * Only when the caller is clearly referring to **Jayson** being sick / unwell — ignore for everyone else.
 */
const JAYSON_HEALTH_EMPATHY_LAYER = `
**Jayson — health (apply ONLY when applicable):** If and only if the caller identifies as Jayson, addresses Jayson directly, or explicitly says Jayson is sick, unwell, or not feeling well, begin with one brief, genuine line of empathy naming Jayson (for example: "I'm sorry to hear you're not feeling well, Jayson") before continuing with their property or business question. Do not use this empathy layer for any other caller or topic. For all other callers, remain the standard professional Aussie Micah receptionist only.
`.trim();

/**
 * Full system prompt for `/api/voice/process`.
 * Pass {@link MicahPromptContext} to override env-driven agency/service area for multi-tenant demos.
 */
export function buildMicahVoiceSystemPrompt(
  dialedTo?: string,
  ctx?: MicahPromptContext
): string {
  return `${buildMicahDirectiveGatherSystemPrompt(dialedTo, ctx)}\n\n${JAYSON_HEALTH_EMPATHY_LAYER}`;
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
