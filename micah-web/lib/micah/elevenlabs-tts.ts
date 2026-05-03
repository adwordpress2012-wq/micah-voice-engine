import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStorageObjectPublicUrl } from "@/lib/micah/supabase-storage-url";

const DEFAULT_MODEL = "eleven_multilingual_v2";

/** Drain Web `ReadableStream` bytes without relying on `Response(stream)` (Node/Web compatible). */
async function readableStreamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/**
 * ElevenLabs TTS → MP3 upload via **service-role** Supabase client (`SUPABASE_SERVICE_ROLE_KEY`).
 * Bucket name: **only** `SUPABASE_TTS_BUCKET`. Public URL: `getPublicUrl` or `SUPABASE_STORAGE_PUBLIC_URL_BASE`.
 */
export async function elevenLabsTtsPublicMp3Url(
  supabase: SupabaseClient | null,
  text: string,
  callSid: string
): Promise<string | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    console.warn("[micah/elevenlabs] SUPABASE_SERVICE_ROLE_KEY missing — cannot upload to Storage");
    return null;
  }
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  // Accept ELEVENLABS_VOICE_ID or AUSSIE_MICAH; fall back to the Aussie Micah voice ID.
  const voiceId =
    process.env.ELEVENLABS_VOICE_ID?.trim() ||
    process.env.AUSSIE_MICAH?.trim() ||
    "4Nz4vG2f9omkfcS8r4PJ";
  if (!apiKey) {
    console.warn("[micah/elevenlabs] ELEVENLABS_API_KEY missing");
    return null;
  }
  console.log("[micah/elevenlabs] using voice:", voiceId);
  if (!supabase) {
    return null;
  }
  const bucket = process.env.SUPABASE_TTS_BUCKET?.trim();
  if (!bucket) {
    console.warn("[micah/elevenlabs] SUPABASE_TTS_BUCKET missing");
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

    const buf = await readableStreamToBuffer(stream);
    if (!buf.length) {
      console.warn("[micah/elevenlabs] empty audio stream");
      return null;
    }
    const path = `voice/${callSid}/${Date.now()}.mp3`;
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, buf, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    if (upErr) {
      console.error("[micah/elevenlabs] upload:", upErr.message);
      return null;
    }

    return getStorageObjectPublicUrl(supabase, bucket, path);
  } catch (e) {
    console.error("[micah/elevenlabs] TTS:", e);
    return null;
  }
}
