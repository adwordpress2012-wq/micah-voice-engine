import { AUSSIE_MICAH_VOICE_ID } from "@/lib/elevenlabs-tts";
import {
  canUseElevenLabsTts,
  micahTtsBlockedReasons,
} from "@/lib/micah/elevenlabs-tts";
import { resolveVoiceActionBaseUrl } from "@/lib/micah-prompt";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — safe booleans only (no secrets). Use after deploy to verify Vercel env for voice.
 * Example: `curl -s https://your-domain/api/voice/diagnostic | jq`
 */
export async function GET(request: Request) {
  const supabase = getServiceSupabaseOrNull();
  const elReady = canUseElevenLabsTts(supabase);
  let baseUrl = "";
  try {
    baseUrl = resolveVoiceActionBaseUrl(request);
  } catch {
    baseUrl = "(resolveVoiceActionBaseUrl failed — set NEXT_PUBLIC_APP_URL)";
  }

  return Response.json({
    voicePipeline:
      "ElevenLabs MP3 → Supabase Storage → Twilio <Play>; Polly.Olivia en-AU if synth fails",
    elevenLabsSynthReady: elReady,
    supabaseClientCreated: !!supabase,
    blockedReasons: micahTtsBlockedReasons(),
    defaultVoiceId: AUSSIE_MICAH_VOICE_ID,
    gatherActionBaseUrl: baseUrl,
    voiceRoutes: {
      incomingPOST: `${baseUrl}/api/voice/incoming`,
      processPOST: `${baseUrl}/api/voice/process`,
      testPOST: `${baseUrl}/api/voice/test`,
    },
    hints: [
      "If elevenLabsSynthReady is false, fix blockedReasons in Vercel → Environment Variables → redeploy.",
      "If synth works but calls are silent, check Vercel logs for [micah/elevenlabs] Storage MP3 not publicly readable — open Supabase Storage bucket policies for public read.",
      "TWILIO_AUTH_TOKEN must match the subaccount that owns the phone number (signature validation).",
    ],
  });
}
