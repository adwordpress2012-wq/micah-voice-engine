import { MICAH_ELEVENLABS_VOICE_ID } from "@/lib/elevenlabs-tts";
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

  const hasFallbackMp3 = !!process.env.MICAH_FALLBACK_MP3_URL?.trim();
  const hasGreetingMp3 = !!process.env.MICAH_GREETING_MP3_URL?.trim();

  const hints = [
    "overallStatus green = ElevenLabs synth path + Supabase client + OpenAI key all ready.",
    "yellow = some env vars set but elevenLabsSynthReady false — see blockedReasons.",
    "If synth works but calls are silent, check logs for Storage MP3 not publicly readable.",
    "TWILIO_AUTH_TOKEN must match the subaccount that owns the phone number (signature validation).",
    "ElevenLabs voice id is only MICAH_ELEVENLABS_VOICE_ID in lib/elevenlabs-tts.ts — no env override.",
    "BRAND POLICY: Aussie Micah ElevenLabs OR pre-recorded MICAH_FALLBACK_MP3_URL ONLY. Polly / Twilio default voices are forbidden. Without MICAH_FALLBACK_MP3_URL, an EL outage produces silent <Pause> (acceptable last resort, never wrong voice).",
  ];

  return Response.json({
    voicePipeline:
      "ElevenLabs Aussie Micah MP3 → Supabase Storage → Twilio <Play>; if synth fails → MICAH_FALLBACK_MP3_URL <Play>; if that's missing → silent <Pause> (brand policy: Polly forbidden).",
    brandPolicy: `All spoken output must originate from ElevenLabs Aussie Micah voice (id=${MICAH_ELEVENLABS_VOICE_ID}) or pre-recorded static MP3 audio approved by Directive OS. Polly/Olivia, default Twilio system voices, or any other fallback are forbidden. Fallback to silence is acceptable only when all assets are unavailable.`,
    overallStatus: checks.overallStatus,
    supabaseClientCreated: !!supabase,
    defaultVoiceId: checks.micahElevenLabsVoiceId,
    // Top-level mirrors for older jq/curl checks (also inside `checks`).
    elevenLabsSynthReady: checks.elevenLabsSynthReady,
    blockedReasons: checks.blockedReasons,
    staticAssets: {
      micahFallbackMp3UrlConfigured: hasFallbackMp3,
      micahGreetingMp3UrlConfigured: hasGreetingMp3,
      bundledGreetingMp3: "/micah-dos-sba-greeting.mp3",
      note: hasFallbackMp3
        ? "MICAH_FALLBACK_MP3_URL is set — EL outages will <Play> this asset (verify it is the Aussie Micah voice)."
        : "MICAH_FALLBACK_MP3_URL is NOT set — EL outages will produce silent <Pause>. Set this env var to a public Aussie Micah MP3 URL.",
    },
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
