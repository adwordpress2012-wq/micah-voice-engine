import twilio from "twilio";
import { applyMicahVoice, micahVoice } from "@/lib/micah/voice-output";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response("POST /api/voice/test — Twilio Voice (Aussie Micah ElevenLabs)", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST() {
  const supabase = getServiceSupabaseOrNull();
  const result = await micahVoice({
    text: "G'day! This is Micah — your test call worked. Have a great one!",
    callSid: `test-${Date.now()}`,
    supabase,
    label: "voice/test",
  });
  const vr = new twilio.twiml.VoiceResponse();
  applyMicahVoice(vr, result);
  vr.hangup();
  return new Response(vr.toString(), {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
