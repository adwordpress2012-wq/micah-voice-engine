import { MICAH_ELEVENLABS_VOICE_ID } from "@/lib/elevenlabs-tts";
import {
  MICAH_TTS_BUCKET_NAME_DEFAULT,
  canUseElevenLabsTts,
  micahTtsBlockedReasons,
} from "@/lib/micah/elevenlabs-tts";
import { maskApiCredential, supabaseConfiguredHostname } from "@/lib/micah/mask-api-credential";
import type { SupabaseClient } from "@supabase/supabase-js";

export type VoiceHealthStatus = "green" | "yellow" | "red";

export type VoiceEnvDiagnostics = {
  overallStatus: VoiceHealthStatus;
  /** Hardcoded in `lib/elevenlabs-tts.ts` — never loaded from env. */
  micahElevenLabsVoiceId: typeof MICAH_ELEVENLABS_VOICE_ID;
  elevenLabs: {
    apiKeyConfigured: boolean;
    apiKeyMask: string | null;
    modelId: string;
  };
  openAi: {
    apiKeyConfigured: boolean;
    apiKeyMask: string | null;
    looksLikeOpenAiSecret: boolean;
    chatModelDefault: string;
  };
  supabase: {
    urlHost: string | null;
    serviceRoleConfigured: boolean;
    serviceRoleMask: string | null;
    ttsBucket: string | null;
    /** Expected upload path pattern (bucket from env). */
    uploadPathPattern: string;
  };
  elevenLabsSynthReady: boolean;
  blockedReasons: string[];
};

const CHAT_MODEL_DEFAULT = "gpt-4o-mini";

export function buildVoiceEnvDiagnostics(
  supabase: SupabaseClient | null
): VoiceEnvDiagnostics {
  const elKey = process.env.ELEVENLABS_API_KEY?.trim();
  const oaKey = process.env.OPENAI_API_KEY?.trim();
  const srKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_TTS_BUCKET?.trim();

  const synthReady = canUseElevenLabsTts(supabase);
  const blocked = micahTtsBlockedReasons();

  let overallStatus: VoiceHealthStatus = "red";
  if (synthReady && !!oaKey && !!supabase) {
    overallStatus = "green";
  } else if (elKey && srKey && bucket && (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    overallStatus = "yellow";
  }

  return {
    overallStatus,
    micahElevenLabsVoiceId: MICAH_ELEVENLABS_VOICE_ID,
    elevenLabs: {
      apiKeyConfigured: !!elKey,
      apiKeyMask: maskApiCredential(elKey),
      modelId: process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_multilingual_v2",
    },
    openAi: {
      apiKeyConfigured: !!oaKey,
      apiKeyMask: maskApiCredential(oaKey),
      looksLikeOpenAiSecret: oaKey?.startsWith("sk-") ?? false,
      chatModelDefault: process.env.OPENAI_CHAT_MODEL?.trim() || CHAT_MODEL_DEFAULT,
    },
    supabase: {
      urlHost: supabaseConfiguredHostname(),
      serviceRoleConfigured: !!srKey,
      serviceRoleMask: maskApiCredential(srKey),
      ttsBucket: bucket || null,
      uploadPathPattern: `storage/v1/object/public/${bucket || MICAH_TTS_BUCKET_NAME_DEFAULT}/voice/{CallSid}/{timestamp}.mp3`,
    },
    elevenLabsSynthReady: synthReady,
    blockedReasons: blocked,
  };
}
