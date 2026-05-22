import { readFile } from "fs/promises";
import { join } from "path";
import { convertTextToSpeech, MICAH_ELEVENLABS_VOICE_ID } from "@/lib/elevenlabs-tts";
import {
  decodeMicahDirectTtsPayload,
  micahDirectTtsOpts,
  verifyMicahDirectTtsPayload,
} from "@/lib/micah/direct-tts-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DIRECT_TTS_FALLBACK_MP3 = join(process.cwd(), "public", "micah-tts-fallback.mp3");

let fallbackAudioCache: Uint8Array | null = null;

async function directTtsFallbackAudio(): Promise<Uint8Array> {
  if (!fallbackAudioCache) {
    fallbackAudioCache = new Uint8Array(await readFile(DIRECT_TTS_FALLBACK_MP3));
  }
  return fallbackAudioCache;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = url.searchParams.get("t") ?? "";
  const sig = url.searchParams.get("sig") ?? "";

  if (!payload || !sig || !verifyMicahDirectTtsPayload(payload, sig)) {
    return new Response("Forbidden", { status: 403 });
  }

  const text = decodeMicahDirectTtsPayload(payload);
  if (!text) return new Response("No text", { status: 400 });

  try {
    const audio = await convertTextToSpeech(text, micahDirectTtsOpts(text)?.voiceSettings);
    console.log("[micah/voice/tts] direct ElevenLabs MP3", {
      micahVoiceQA: true,
      event: "direct_elevenlabs_tts_ok",
      voiceId: MICAH_ELEVENLABS_VOICE_ID,
      inputChars: text.length,
      mp3Bytes: audio.length,
    });
    return new Response(new Uint8Array(audio), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    console.error("[micah/voice/tts] direct ElevenLabs failed", {
      micahVoiceQA: true,
      event: "direct_elevenlabs_tts_failed",
      voiceId: MICAH_ELEVENLABS_VOICE_ID,
      err: e,
      fallbackMp3: "/micah-tts-fallback.mp3",
    });
    try {
      const audio = await directTtsFallbackAudio();
      return new Response(audio.slice(), {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "public, max-age=300",
          "X-Micah-TTS-Fallback": "static-mp3",
        },
      });
    } catch (fallbackError) {
      console.error("[micah/voice/tts] static fallback MP3 failed", {
        micahVoiceQA: true,
        event: "direct_elevenlabs_tts_static_fallback_failed",
        voiceId: MICAH_ELEVENLABS_VOICE_ID,
        fallbackMp3: "/micah-tts-fallback.mp3",
        err: fallbackError,
      });
      return new Response(new Uint8Array(), {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
          "X-Micah-TTS-Fallback": "empty-audio",
        },
      });
    }
  }
}
