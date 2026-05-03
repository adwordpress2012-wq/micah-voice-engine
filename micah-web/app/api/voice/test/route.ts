import twilio from "twilio";
import {
  defaultElevenLabsTtsTimeoutMs,
  elevenLabsTtsPublicMp3UrlWithTimeout,
  micahTtsBlockedReasons,
  AUSSIE_MICAH_VOICE_ID,
} from "@/lib/micah/elevenlabs-tts";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";
import { playOrPollyOliviaSay } from "@/lib/micah/twilio-voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(
    "POST /api/voice/test — ElevenLabs Aussie Micah only (no bare Say).",
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
  const voiceId = AUSSIE_MICAH_VOICE_ID;

  const url =
    supabase &&
    (await elevenLabsTtsPublicMp3UrlWithTimeout(
      supabase,
      "Micah test successful.",
      sid,
      defaultElevenLabsTtsTimeoutMs()
    ));

  const fallbackSay = "Micah test successful.";
  if (url) {
    console.log("[micah/voice/test] Play Aussie Micah", { voiceId, url: url.slice(0, 120) });
  } else {
    console.warn("[micah/voice/test] ElevenLabs unavailable — Polly.Olivia Say. Check env.", {
      voiceId,
      blocked: micahTtsBlockedReasons(),
    });
  }
  playOrPollyOliviaSay(vr, url, fallbackSay);

  return new Response(vr.toString(), {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
