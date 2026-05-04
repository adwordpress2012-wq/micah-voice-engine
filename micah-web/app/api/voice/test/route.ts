import twilio from "twilio";
import {
  defaultElevenLabsTtsTimeoutMs,
  elevenLabsTtsPublicMp3UrlWithTimeout,
  micahTtsBlockedReasons,
  MICAH_ELEVENLABS_VOICE_ID,
} from "@/lib/micah/elevenlabs-tts";
import { micahElevenLabsOptsForUtterance } from "@/lib/micah/micah-empathy-tts";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";
import { playOrFallbackMp3 } from "@/lib/micah/twilio-voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(
    "POST /api/voice/test — ElevenLabs Aussie Micah <Play>; MICAH_FALLBACK_MP3_URL on synth failure; silent <Pause> if both unavailable (brand policy: no Polly).",
    {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }
  );
}

export async function POST() {
  const supabase = getServiceSupabaseOrNull();
  const vr = new twilio.twiml.VoiceResponse();
  const sid = `test-${Date.now()}`;
  const voiceId = MICAH_ELEVENLABS_VOICE_ID;

  const testLine = "Micah test successful.";
  const url =
    supabase &&
    (await elevenLabsTtsPublicMp3UrlWithTimeout(
      supabase,
      testLine,
      sid,
      defaultElevenLabsTtsTimeoutMs(),
      micahElevenLabsOptsForUtterance(testLine)
    ));

  const fallbackSay = testLine;
  if (url) {
    console.log("[micah/voice/test] Play Aussie Micah", {
      micahVoiceQA: true,
      event: "voice_test_el_play",
      voiceId,
      mp3Url: url,
    });
  } else {
    console.warn(
      "[micah/voice/test] ElevenLabs unavailable — falling back to MICAH_FALLBACK_MP3_URL or silent <Pause> (brand policy: no Polly).",
      {
        micahVoiceQA: true,
        event: "voice_test_static_fallback",
        elevenLabsVoiceIdAttempted: voiceId,
        fallbackMp3Configured: !!process.env.MICAH_FALLBACK_MP3_URL?.trim(),
        blocked: micahTtsBlockedReasons(),
      }
    );
  }
  playOrFallbackMp3(vr, url, fallbackSay);

  return new Response(vr.toString(), {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
