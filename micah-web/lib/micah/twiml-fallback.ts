import twilio from "twilio";
import { NextResponse } from "next/server";
import { AUSSIE_MICAH_VOICE_ID } from "@/lib/elevenlabs-tts";
import {
  defaultElevenLabsTtsTimeoutMs,
  elevenLabsTtsPublicMp3UrlWithTimeout,
} from "@/lib/micah/elevenlabs-tts";
import { micahDirectiveOsSayAttributes } from "@/lib/micah/twilio-voice";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";

/** Twilio Voice webhooks must get HTTP 200 with XML. Prefer ElevenLabs `<Play>`; always fall back to Polly.Olivia `<Say>` — never silence-only. */
export async function plainErrorTwiMLResponse(
  callSid: string,
  userMessage: string,
  logLabel: string
): Promise<NextResponse> {
  const supabase = getServiceSupabaseOrNull();
  const vr = new twilio.twiml.VoiceResponse();
  const sid = callSid.trim() || `anon-${Date.now()}`;
  const budget = defaultElevenLabsTtsTimeoutMs();
  const url =
    supabase &&
    (await elevenLabsTtsPublicMp3UrlWithTimeout(
      supabase,
      userMessage.slice(0, 1000),
      sid,
      budget
    ));
  if (url) {
    console.log(`[${logLabel}] error path elevenlabs Play voiceId=${AUSSIE_MICAH_VOICE_ID}`, {
      urlPreview: url.slice(0, 96),
    });
    vr.play(url);
  } else {
    console.warn(`[${logLabel}] ElevenLabs unavailable — Polly.Olivia Say fallback`, {
      voiceId: AUSSIE_MICAH_VOICE_ID,
    });
    vr.say(micahDirectiveOsSayAttributes(), userMessage.slice(0, 1000));
  }
  vr.hangup();
  return twimlResponse(vr.toString(), logLabel);
}

/** Twilio Voice webhooks must get HTTP 200 with XML; errors use Play/Pause in-body, not 5xx. */
export function twimlResponse(twiml: string, logLabel: string): NextResponse {
  const safe =
    twiml.length > 16000 ? `${twiml.slice(0, 16000)}\n<!-- truncated for log -->` : twiml;
  console.log(`[${logLabel}] twiml length=${twiml.length} body=`, safe);
  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
