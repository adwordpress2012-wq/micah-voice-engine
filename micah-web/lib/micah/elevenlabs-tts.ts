import type { SupabaseClient } from "@supabase/supabase-js";
import {
  convertTextToSpeech,
  MICAH_ELEVENLABS_VOICE_ID,
  type ElevenLabsVoiceSettings,
} from "@/lib/elevenlabs-tts";
import {
  getCanonicalSupabasePublicObjectUrl,
  getStorageObjectPublicUrl,
} from "@/lib/micah/supabase-storage-url";

/** Re-export — voice id is fixed in source; never from env. */
export {
  MICAH_ELEVENLABS_VOICE_ID,
  convertTextToSpeech,
  type ElevenLabsVoiceSettings,
} from "@/lib/elevenlabs-tts";

/** Optional synthesis overrides for {@link elevenLabsTtsPublicMp3Url} / {@link elevenLabsTtsPublicMp3UrlWithTimeout}. */
export type ElevenLabsTtsPublicOpts = {
  voiceSettings?: Partial<ElevenLabsVoiceSettings>;
};

/**
 * Default bucket name (`micah-tts`) — public URLs follow
 * `https://[PROJECT_REF].supabase.co/storage/v1/object/public/micah-tts/…`.
 */
export const MICAH_TTS_BUCKET_NAME_DEFAULT = "micah-tts";

/**
 * Public `<Play>` URL for uploaded MP3s — **canonical** Supabase format first:
 * `https://[PROJECT_REF].supabase.co/storage/v1/object/public/{bucket}/path.mp3`
 */
export function micahTtsStoragePublicUrl(
  supabase: SupabaseClient,
  bucket: string,
  objectPath: string
): string {
  const canonical = getCanonicalSupabasePublicObjectUrl(bucket, objectPath);
  if (canonical) return canonical;
  return getStorageObjectPublicUrl(supabase, bucket, objectPath);
}

const DEFAULT_MODEL = "eleven_multilingual_v2";

/**
 * Wall-clock budget for ElevenLabs + Supabase upload per attempt.
 * Default **1500ms** — then callers fall back to MICAH_FALLBACK_MP3_URL (or
 * silent <Pause> if unset). Brand policy forbids Polly fallback.
 * Override with `ELEVENLABS_TTS_TIMEOUT_MS` for slower networks (e.g. `8000`).
 */
export function defaultElevenLabsTtsTimeoutMs(): number {
  const raw = process.env.ELEVENLABS_TTS_TIMEOUT_MS?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1_500;
}

/** True when Supabase upload + ElevenLabs API key exist. */
export function canUseElevenLabsTts(supabase: SupabaseClient | null): boolean {
  if (!supabase) return false;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return false;
  if (!process.env.SUPABASE_TTS_BUCKET?.trim()) return false;
  if (!process.env.ELEVENLABS_API_KEY?.trim()) return false;
  return true;
}

/** Why `<Play>` cannot run — log when callers hear only silence. */
export function micahTtsBlockedReasons(): string[] {
  const reasons: string[] = [];
  if (!process.env.SUPABASE_URL?.trim() && !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()) {
    reasons.push("no SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    reasons.push("no SUPABASE_SERVICE_ROLE_KEY");
  }
  if (!process.env.SUPABASE_TTS_BUCKET?.trim()) reasons.push("no SUPABASE_TTS_BUCKET");
  if (!process.env.ELEVENLABS_API_KEY?.trim()) reasons.push("no ELEVENLABS_API_KEY");
  return reasons;
}

/**
 * Same as {@link elevenLabsTtsPublicMp3Url} but aborts after `timeoutMs` so Twilio never waits past serverless limits.
 * Returns `null` on timeout — caller should fall back to `MICAH_FALLBACK_MP3_URL <Play>` or silent `<Pause>`
 * (see `voice-output.ts` / `twilio-voice.ts`). Brand policy forbids Polly fallback.
 */
export async function elevenLabsTtsPublicMp3UrlWithTimeout(
  supabase: SupabaseClient | null,
  text: string,
  callSid: string,
  timeoutMs: number,
  opts?: ElevenLabsTtsPublicOpts
): Promise<string | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      console.warn(`[micah/elevenlabs] TTS timed out after ${timeoutMs}ms`, {
        micahVoiceQA: true,
        event: "elevenlabs_tts_timeout",
        elevenLabsVoiceId: MICAH_ELEVENLABS_VOICE_ID,
        nextVoice: "MICAH_FALLBACK_MP3_URL <Play> if set, else silent <Pause> (brand policy: no Polly)",
      });
      resolve(null);
    }, timeoutMs);
    void elevenLabsTtsPublicMp3Url(supabase, text, callSid, opts).then(
      (url) => {
        clearTimeout(t);
        resolve(url);
      },
      (e) => {
        clearTimeout(t);
        console.warn("[micah/elevenlabs] TTS promise rejected:", e);
        resolve(null);
      }
    );
  });
}

/**
 * Twilio fetches `<Play>` URLs from its network — if Storage is private, Play fails and callers hear silence.
 * `MICAH_SKIP_PLAY_URL_CHECK=1` skips this (saves ~50ms).
 */
async function warnIfPlayUrlReadableByTwilio(publicUrl: string): Promise<void> {
  if (process.env.MICAH_SKIP_PLAY_URL_CHECK === "1") return;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6000);
  try {
    let res = await fetch(publicUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: ac.signal,
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(publicUrl, {
        method: "GET",
        headers: { Range: "bytes=0-1" },
        redirect: "follow",
        signal: ac.signal,
      });
    }
    if (!res.ok) {
      console.error(
        "[micah/elevenlabs] Storage MP3 not publicly readable — Twilio <Play> will usually fail. Make the TTS bucket public (anon SELECT) or fix SUPABASE_STORAGE_PUBLIC_URL_BASE.",
        { status: res.status, urlPreview: publicUrl.slice(0, 160) }
      );
      return;
    }
    console.log("[micah/elevenlabs] Play URL HEAD ok for Twilio", {
      status: res.status,
      contentType: res.headers.get("content-type"),
    });
  } catch (e) {
    console.warn("[micah/elevenlabs] Play URL reachability check failed:", e);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ElevenLabs TTS → MP3 upload via **service-role** Supabase client (`SUPABASE_SERVICE_ROLE_KEY`).
 * Uses {@link convertTextToSpeech} with hardcoded {@link MICAH_ELEVENLABS_VOICE_ID} only.
 */
export async function elevenLabsTtsPublicMp3Url(
  supabase: SupabaseClient | null,
  text: string,
  callSid: string,
  opts?: ElevenLabsTtsPublicOpts
): Promise<string | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    console.warn("[micah/elevenlabs] SUPABASE_SERVICE_ROLE_KEY missing — cannot upload to Storage");
    return null;
  }
  if (!process.env.ELEVENLABS_API_KEY?.trim()) {
    console.warn("[micah/elevenlabs] ELEVENLABS_API_KEY missing");
    return null;
  }
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
    const buf = await convertTextToSpeech(plain, opts?.voiceSettings);
    if (!buf.length) {
      console.warn("[micah/elevenlabs] empty audio buffer");
      return null;
    }
    const path = `voice/${callSid}/${Date.now()}.mp3`;
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, buf, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    if (upErr) {
      console.error("[micah/elevenlabs] Supabase upload failed:", {
        message: upErr.message,
        name: upErr.name,
      });
      return null;
    }

    const publicUrl = micahTtsStoragePublicUrl(supabase, bucket, path);
    console.log("[micah/elevenlabs] synthesised Micah ElevenLabs MP3", {
      micahVoiceQA: true,
      event: "elevenlabs_uploaded_play_url",
      voiceId: MICAH_ELEVENLABS_VOICE_ID,
      modelId,
      bytes: buf.length,
      path,
      publicUrl: publicUrl.slice(0, 200),
    });
    void warnIfPlayUrlReadableByTwilio(publicUrl);
    return publicUrl;
  } catch (e) {
    const err = e as Error & { cause?: unknown; statusCode?: number };
    console.error("[micah/elevenlabs] TTS pipeline failed:", {
      micahVoiceQA: true,
      event: "elevenlabs_pipeline_failed",
      voiceId: MICAH_ELEVENLABS_VOICE_ID,
      message: err?.message ?? String(e),
      name: err?.name,
      statusCode: err?.statusCode,
      cause: err?.cause,
      stack: err?.stack?.split("\n").slice(0, 5).join(" | "),
    });
    return null;
  }
}
