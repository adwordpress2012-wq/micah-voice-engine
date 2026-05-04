import { buildVoiceEnvDiagnostics } from "@/lib/micah/voice-env-diagnostics";
import { resolveVoiceActionBaseUrl } from "@/lib/micah-prompt";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — safe health JSON (no full secrets). Use on production to confirm “green” Aussie Micah stack.
 * Example: `curl -s https://your-domain/api/voice/diagnostic | jq`
 */
export async function GET(request: Request) {
  const supabase = getServiceSupabaseOrNull();
  const checks = buildVoiceEnvDiagnostics(supabase);

  let gatherActionBaseUrl = "";
  try {
    gatherActionBaseUrl = resolveVoiceActionBaseUrl(request);
  } catch {
    gatherActionBaseUrl =
      "(resolveVoiceActionBaseUrl failed — set NEXT_PUBLIC_APP_URL)";
  }

  const hints = [
    "overallStatus green = ElevenLabs synth path + Supabase client + OpenAI key all ready.",
    "yellow = some env vars set but elevenLabsSynthReady false — see blockedReasons.",
    "If synth works but calls are silent, check logs for Storage MP3 not publicly readable.",
    "TWILIO_AUTH_TOKEN must match the subaccount that owns the phone number (signature validation).",
    "ElevenLabs voice id is only MICAH_ELEVENLABS_VOICE_ID in lib/elevenlabs-tts.ts — no env override.",
  ];

  return Response.json({
    voicePipeline:
      "ElevenLabs MP3 → Supabase Storage → Twilio <Play>; Polly.Olivia en-AU if synth fails",
    overallStatus: checks.overallStatus,
    supabaseClientCreated: !!supabase,
    defaultVoiceId: checks.micahElevenLabsVoiceId,
    // Top-level mirrors for older jq/curl checks (also inside `checks`).
    elevenLabsSynthReady: checks.elevenLabsSynthReady,
    blockedReasons: checks.blockedReasons,
    checks,
    gatherActionBaseUrl,
    voiceRoutes: {
      incomingPOST: `${gatherActionBaseUrl}/api/voice/incoming`,
      processPOST: `${gatherActionBaseUrl}/api/voice/process`,
      testPOST: `${gatherActionBaseUrl}/api/voice/test`,
    },
    hints,
  });
}
