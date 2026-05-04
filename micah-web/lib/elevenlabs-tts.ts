/**
 * Directive OS — ElevenLabs TTS source of truth.
 *
 * - **`ELEVENLABS_API_KEY`**: read only here in {@link convertTextToSpeech} via `process.env` (trimmed).
 * - **Voice ID**: only {@link MICAH_ELEVENLABS_VOICE_ID} — hardcoded in this file; **never** from `process.env`, query params, or DB.
 * - Never log the full API key — use {@link describeElevenLabsKeyForDiagnostics} or `maskApiCredential`.
 */

import { maskApiCredential } from "@/lib/micah/mask-api-credential";

/**
 * Sole ElevenLabs voice id for Micah (young female Aussie Micah). Immutable in source — no env override.
 */
export const MICAH_ELEVENLABS_VOICE_ID = "4Nz4vG2f9omkfcS8r4PJ" as const;

/** Safe for `/api/voice/diagnostic` and logs — never returns the raw key. */
export function describeElevenLabsKeyForDiagnostics(): {
  configured: boolean;
  mask: string | null;
} {
  const k = process.env.ELEVENLABS_API_KEY?.trim();
  return {
    configured: !!k,
    mask: maskApiCredential(k),
  };
}

const DEFAULT_MODEL = "eleven_multilingual_v2";

/** ElevenLabs `voice_settings` — callers may override per utterance (e.g. higher stability for comforting delivery). */
export type ElevenLabsVoiceSettings = {
  stability: number;
  similarity_boost: number;
};

const DEFAULT_VOICE_SETTINGS: ElevenLabsVoiceSettings = {
  stability: 0.5,
  similarity_boost: 0.8,
};

/**
 * Raw MP3 bytes for Micah’s ElevenLabs voice only ({@link MICAH_ELEVENLABS_VOICE_ID}).
 * API key still comes from `ELEVENLABS_API_KEY` (secret).
 */
export async function convertTextToSpeech(
  text: string,
  voiceSettings?: Partial<ElevenLabsVoiceSettings>
): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not set");
  }
  const plain = text.trim().slice(0, 4096);
  if (!plain) {
    throw new Error("empty text for TTS");
  }
  const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL;
  const stability =
    voiceSettings?.stability ?? DEFAULT_VOICE_SETTINGS.stability;
  const similarity_boost =
    voiceSettings?.similarity_boost ??
    DEFAULT_VOICE_SETTINGS.similarity_boost;

  try {
    // `Accept: audio/mpeg` matches ElevenLabs MP3 output (`output_format=mp3_44100_128`).
    // Supabase upload uses `contentType: "audio/mpeg"` — same MIME family as MP3 per RFC 3003.
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${MICAH_ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: plain,
          model_id: modelId,
          voice_settings: { stability, similarity_boost },
        }),
      }
    );
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `ElevenLabs HTTP ${response.status}: ${errText.slice(0, 400)}`
      );
    }
    const ab = await response.arrayBuffer();
    const buf = Buffer.from(ab);
    console.log("[Micah-Audit] ElevenLabs TTS ok", {
      micahVoiceQA: true,
      event: "elevenlabs_tts_ok",
      voiceId: MICAH_ELEVENLABS_VOICE_ID,
      modelId,
      inputChars: plain.length,
      mp3Bytes: buf.length,
    });
    return buf;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Micah-Audit] TTS Failure:", msg);
    throw error;
  }
}
