/**
 * OpenAI chat surface for **Micah** voice (`/api/voice/process`).
 *
 * **`OPENAI_API_KEY`** is read in `app/api/voice/process/route.ts` via `process.env.OPENAI_API_KEY`
 * (never logged in full — use {@link describeOpenAiKeyForDiagnostics} for masked previews).
 *
 * **Micah v3 Modular Persona:** {@link buildMicahDirectiveGatherSystemPrompt} supplies the locked
 * receptionist template (`[AGENCY_NAME]`, `[PRINCIPAL_NAME]`, `[SERVICE_AREA]`), plus a Jayson
 * Ocampo health override below. Model defaults: {@link MICAH_VOICE_CHAT_MODEL},
 * {@link MICAH_VOICE_CHAT_TEMPERATURE}.
 */

import { maskApiCredential } from "@/lib/micah/mask-api-credential";
import {
  buildMicahDirectiveGatherSystemPrompt,
  getMicahAgencyName,
  type MicahPromptContext,
} from "@/lib/micah/micah-directive-os-persona";
import { MICAH_OPENAI_OFFLINE_FALLBACK } from "@/lib/micah/micah-voice-persona";

export type { MicahPromptContext } from "@/lib/micah/micah-directive-os-persona";
export { MICAH_OPENAI_OFFLINE_FALLBACK } from "@/lib/micah/micah-voice-persona";

export { describeElevenLabsKeyForDiagnostics } from "@/lib/elevenlabs-tts";

/** Default chat model for Micah voice (`OPENAI_CHAT_MODEL` overrides in the route). */
export const MICAH_VOICE_CHAT_MODEL = "gpt-4o";

/** Default sampling temperature for Micah voice (`/api/voice/process`). */
export const MICAH_VOICE_CHAT_TEMPERATURE = 0.7;

/**
 * CRITICAL OVERRIDE — Jayson Ocampo: if the caller is (or is calling about) Jayson Ocampo and
 * sounds sick or unwell, respond with immediate empathy and tell him to rest before any business.
 */
const JAYSON_OCAMPO_HEALTH_OVERRIDE = `
**CRITICAL — Jayson Ocampo (health):** If the caller identifies as **Jayson Ocampo**, says they are Jayson Ocampo, or is clearly speaking as Jayson, **and** they sound sick, unwell, under the weather, or not feeling well: you must **immediately** offer genuine empathy by name, **tell him to rest and take care of himself first**, and only **after** that gentle human check-in, move on lightly to how you can help at [AGENCY_NAME] if he wishes. Do not rush into property or business before that rest-and-care beat. If the caller is anyone else, or Jayson is well, ignore this block entirely.
`.trim();

/**
 * Full system prompt for `/api/voice/process` — **Micah v3 Modular Persona** plus Jayson override.
 * Pass {@link MicahPromptContext} to override env-driven agency / service area / principal for multi-tenant demos.
 */
export function buildMicahVoiceSystemPrompt(
  dialedTo?: string,
  ctx?: MicahPromptContext
): string {
  const agency = ctx?.agencyName?.trim() || getMicahAgencyName();
  const modular = buildMicahDirectiveGatherSystemPrompt(dialedTo, ctx);
  const jaysonLayer = JAYSON_OCAMPO_HEALTH_OVERRIDE.replaceAll("[AGENCY_NAME]", agency);
  return `${modular}\n\n${jaysonLayer}`;
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
