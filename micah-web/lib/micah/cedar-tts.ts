import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MICAH_OPENAI_VOICE, MICAH_SPEECH_SPEED } from "@/lib/micah/master-prompt-v2";
import { getStorageObjectPublicUrl } from "@/lib/micah/supabase-storage-url";

/**
 * OpenAI Speech — voice \`cedar\`, speed exactly 1.0.
 * Uploads MP3 to Supabase Storage for Twilio \`<Play>\`; returns null if bucket unset or upload fails (caller falls back to \`<Say>\`).
 */
export async function cedarTtsPublicMp3Url(
  openai: OpenAI,
  supabase: SupabaseClient | null,
  text: string,
  callSid: string
): Promise<string | null> {
  if (!supabase) {
    return null;
  }
  const bucket = process.env.SUPABASE_TTS_BUCKET?.trim();
  if (!bucket) {
    return null;
  }

  const plain = text.trim().slice(0, 4096);
  if (!plain) return null;

  // `tts-1` / `tts-1-hd` support explicit `speed`; keep cedar + 1.0 as required.
  const model = process.env.OPENAI_TTS_MODEL ?? "tts-1-hd";

  try {
    const speech = await openai.audio.speech.create({
      model,
      voice: MICAH_OPENAI_VOICE,
      speed: MICAH_SPEECH_SPEED,
      input: plain,
      response_format: "mp3",
    });

    const buf = Buffer.from(await speech.arrayBuffer());
    const path = `voice/${callSid}/${Date.now()}.mp3`;
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, buf, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    if (upErr) {
      console.error("cedar TTS upload:", upErr.message);
      return null;
    }

    return getStorageObjectPublicUrl(supabase, bucket, path);
  } catch (e) {
    console.error("cedar TTS:", e);
    return null;
  }
}
