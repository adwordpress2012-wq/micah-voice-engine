/**
 * Directive OS — ElevenLabs TTS source of truth.
 * Voice ID is **never** read from `process.env` (no accidental “neutral” swaps).
 */

export const AUSSIE_MICAH_VOICE_ID = "4Nz4vG2f9omkfcS8r4PJ";

const DEFAULT_MODEL = "eleven_multilingual_v2";

/**
 * Raw MP3 bytes for Micah’s Aussie voice (`AUSSIE_MICAH_VOICE_ID` only).
 * API key still comes from `ELEVENLABS_API_KEY` (secret).
 */
export async function convertTextToSpeech(text: string): Promise<Buffer> {
  const voiceId = AUSSIE_MICAH_VOICE_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not set");
  }
  const plain = text.trim().slice(0, 4096);
  if (!plain) {
    throw new Error("empty text for TTS");
  }
  const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL;

  try {
    // `Accept: audio/mpeg` matches ElevenLabs MP3 output (`output_format=mp3_44100_128`).
    // Supabase upload uses `contentType: "audio/mpeg"` — same MIME family as MP3 per RFC 3003.
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
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
          voice_settings: { stability: 0.5, similarity_boost: 0.8 },
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
    return Buffer.from(ab);
  } catch (error) {
    console.error("[Micah-Audit] TTS Failure:", error);
    throw error;
  }
}
