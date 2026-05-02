import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_MODEL = "eleven_multilingual_v2";

/**
 * ElevenLabs TTS → MP3 upload to Supabase public bucket for Twilio `<Play>`.
 * Returns null if env, Supabase, or synthesis fails (caller should use Polly `<Say>`).
 */
export async function elevenLabsTtsPublicMp3Url(
  supabase: SupabaseClient | null,
  text: string,
  callSid: string
): Promise<string | null> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (!apiKey || !voiceId) {
    console.warn("[micah/elevenlabs] ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID missing");
    return null;
  }
  if (!supabase) {
    return null;
  }
  const bucket = process.env.SUPABASE_TTS_BUCKET?.trim();
  if (!bucket) {
    return null;
  }

  const plain = text.trim().slice(0, 4096);
  if (!plain) return null;

  const modelId = process.env.ELEVENLABS_MODEL_ID?.trim() ?? DEFAULT_MODEL;

  try {
    const client = new ElevenLabsClient({ apiKey });
    const stream = await client.textToSpeech.convert(voiceId, {
      text: plain,
      modelId,
      outputFormat: "mp3_44100_128",
    });

    const buf = Buffer.from(await new Response(stream).arrayBuffer());
    const path = `micah-tts/${callSid}/${Date.now()}.mp3`;
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, buf, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    if (upErr) {
      console.error("[micah/elevenlabs] upload:", upErr.message);
      return null;
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl || null;
  } catch (e) {
    console.error("[micah/elevenlabs] TTS:", e);
    return null;
  }
}
