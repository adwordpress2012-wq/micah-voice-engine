import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStorageObjectPublicUrl } from "@/lib/micah/supabase-storage-url";

const DEFAULT_MODEL = "eleven_multilingual_v2";

/**
 * HARD-CODED Aussie Micah voice ID. This is the source of truth — env vars are
 * accepted ONLY as overrides, never as the default. Empty / missing env values
 * are bypassed entirely so the call never fails just because an env var is unset.
 */
export const AUSSIE_MICAH_VOICE_ID = "4Nz4vG2f9omkfcS8r4PJ";

/**
 * Hard cap on ElevenLabs synthesis time. If TTS doesn't return within this
 * window, the caller is NOT left waiting in silence — micahVoice() falls back
 * to <Say voice="Polly.Olivia"> immediately. Tunable via MICAH_ELEVENLABS_TIMEOUT_MS.
 */
const ELEVENLABS_TIMEOUT_MS = (() => {
  const n = Number(process.env.MICAH_ELEVENLABS_TIMEOUT_MS?.trim());
  return Number.isFinite(n) && n > 0 ? n : 1500;
})();

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
  // VOICE: Aussie Micah is the source of truth. Env vars are honoured ONLY if
  // they contain a non-empty string; otherwise the hard-coded constant is used.
  // An empty/missing ELEVENLABS_VOICE_ID never causes a fallback to silence.
  const voiceId =
    process.env.ELEVENLABS_VOICE_ID?.trim() ||
    process.env.AUSSIE_MICAH?.trim() ||
    AUSSIE_MICAH_VOICE_ID;
  console.log("[micah/elevenlabs] using voice:", voiceId);

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    console.warn("[micah/elevenlabs] SUPABASE_SERVICE_ROLE_KEY missing — cannot upload to Storage");
    return null;
  }
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[micah/elevenlabs] ELEVENLABS_API_KEY missing");
    return null;
  }
  if (!supabase) {
    console.warn("[micah/elevenlabs] supabase client null — SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
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

  let buf: Buffer;
  try {
    const client = new ElevenLabsClient({ apiKey });
    // Hard timeout: if ElevenLabs doesn't return audio within ELEVENLABS_TIMEOUT_MS
    // (default 1500ms), abort and let the caller fall back to Polly.Olivia.
    // The user must hear a voice quickly — silence is the worse failure mode.
    const synthAndDrain = (async () => {
      const stream = await client.textToSpeech.convert(voiceId, {
        text: plain,
        modelId,
        outputFormat: "mp3_44100_128",
      });
      return readableStreamToBuffer(stream);
    })();

    buf = await Promise.race([
      synthAndDrain,
      new Promise<Buffer>((_, reject) =>
        setTimeout(
          () => reject(new Error(`ElevenLabs timeout after ${ELEVENLABS_TIMEOUT_MS}ms`)),
          ELEVENLABS_TIMEOUT_MS
        )
      ),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error(`[micah/elevenlabs] TTS API failed (voiceId=${voiceId}, model=${modelId}, timeout=${ELEVENLABS_TIMEOUT_MS}ms):`, msg);
    return null;
  }

  if (!buf.length) {
    console.warn("[micah/elevenlabs] ElevenLabs returned an empty audio stream");
    return null;
  }

  const path = `voice/${callSid}/${Date.now()}.mp3`;
  try {
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, buf, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    if (upErr) {
      // Surface the exact Supabase error so missing-bucket / RLS / permissions
      // problems are visible in Vercel logs without guessing.
      console.error(
        `[micah/elevenlabs] Supabase upload FAILED (bucket="${bucket}", path="${path}"): ${upErr.message}`
      );
      console.error(
        "[micah/elevenlabs] Common causes: bucket does not exist; RLS blocks service role; bucket not public; SUPABASE_URL points to wrong project."
      );
      return null;
    }
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error(`[micah/elevenlabs] Supabase upload threw (bucket="${bucket}"):`, msg);
    return null;
  }

  return getStorageObjectPublicUrl(supabase, bucket, path);
}
