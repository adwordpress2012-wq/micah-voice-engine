import twilio from "twilio";
import { NextResponse } from "next/server";
import { MICAH_ELEVENLABS_VOICE_ID } from "@/lib/elevenlabs-tts";
import {
  defaultElevenLabsTtsTimeoutMs,
  elevenLabsTtsPublicMp3UrlWithTimeout,
} from "@/lib/micah/elevenlabs-tts";
import {
  micahElevenLabsOptsForUtterance,
  textSuggestsEmpatheticTts,
} from "@/lib/micah/micah-empathy-tts";
import { MICAH_SAY_LANGUAGE } from "@/lib/micah/twilio-voice";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";

type TwilioVR = import("twilio/lib/twiml/VoiceResponse");
const MICAH_PRODUCTION_VOICE_ORIGIN = "https://micah.directiveos.com.au";

export type PlainErrorTwiMLOptions = {
  /**
   * When set, append `<Gather action="...">` so the call can continue to `/api/voice/process`
   * instead of ending on `<Hangup>` (avoids "Twilio went silent / stopped responding").
   */
  gatherContinuationUrl?: string;
};

/**
 * Twilio Voice webhooks must get HTTP 200 with XML.
 *
 * BRAND-STRICT POLICY: ElevenLabs Aussie Micah `<Play>` first; if synth fails,
 * `MICAH_FALLBACK_MP3_URL` `<Play>`; if that's missing, silent `<Pause>` +
 * `<Hangup>`. Polly / Twilio default voices are forbidden. The `userMessage`
 * argument is preserved for log context - it is never spoken.
 */
export async function plainErrorTwiMLResponse(
  callSid: string,
  userMessage: string,
  logLabel: string,
  options?: PlainErrorTwiMLOptions
): Promise<NextResponse> {
  const supabase = getServiceSupabaseOrNull();
  const vr = new twilio.twiml.VoiceResponse();
  const sid = callSid.trim() || `anon-${Date.now()}`;
  const budget = defaultElevenLabsTtsTimeoutMs();
  const saySlice = userMessage.slice(0, 1000);

  const url =
    supabase &&
    (await elevenLabsTtsPublicMp3UrlWithTimeout(
      supabase,
      saySlice,
      sid,
      budget,
      micahElevenLabsOptsForUtterance(saySlice)
    ));

  if (url) {
    console.log(`[${logLabel}] error path ElevenLabs <Play>`, {
      micahVoiceQA: true,
      event: "twiml_error_path_el_play",
      voiceId: MICAH_ELEVENLABS_VOICE_ID,
      mp3Url: url,
      empathyTuning: textSuggestsEmpatheticTts(saySlice),
      whatCallerHears: "ElevenLabs Aussie Micah MP3",
    });
    vr.play(url);
  } else {
    const configuredFallbackMp3 = process.env.MICAH_FALLBACK_MP3_URL?.trim();
    const fallbackMp3 = configuredFallbackMp3?.startsWith("/")
      ? `${MICAH_PRODUCTION_VOICE_ORIGIN}${configuredFallbackMp3}`
      : configuredFallbackMp3;
    if (fallbackMp3) {
      console.warn(`[${logLabel}] ElevenLabs unavailable - MICAH_FALLBACK_MP3_URL <Play>`, {
        micahVoiceQA: true,
        event: "twiml_error_path_fallback_mp3",
        elevenLabsVoiceIdAttempted: MICAH_ELEVENLABS_VOICE_ID,
        mp3Url: fallbackMp3,
        whatCallerHears: "pre-recorded Aussie Micah MP3 (must be the brand voice)",
        empathyTuning: textSuggestsEmpatheticTts(saySlice),
        intendedTextNotSpoken: saySlice.slice(0, 200),
      });
      vr.play(fallbackMp3);
    } else {
      console.error(
        `[${logLabel}] SILENT error path - both ElevenLabs and MICAH_FALLBACK_MP3_URL are unavailable. Brand policy forbids Polly fallback. Set MICAH_FALLBACK_MP3_URL to prevent silence.`,
        {
          micahVoiceQA: true,
          event: "twiml_error_path_silent",
          elevenLabsVoiceIdAttempted: MICAH_ELEVENLABS_VOICE_ID,
          intendedTextNotSpoken: saySlice.slice(0, 200),
        }
      );
      vr.pause({ length: 1 });
    }
  }

  const gatherUrl = options?.gatherContinuationUrl?.trim();
  if (gatherUrl) {
    vr.gather({
      input: ["speech"],
      timeout: 12,
      speechTimeout: "auto",
      actionOnEmptyResult: true,
      action: gatherUrl,
      method: "POST",
      language: MICAH_SAY_LANGUAGE as TwilioVR["GatherLanguage"],
    });
  } else {
    vr.hangup();
  }
  return twimlResponse(vr.toString(), logLabel);
}

/** Twilio Voice webhooks must get HTTP 200 with XML; errors use Play/Pause in-body, not 5xx. */
export function twimlResponse(twiml: string, logLabel: string): NextResponse {
  if (process.env.MICAH_DEBUG_TWIML === "1") {
    const safe =
      twiml.length > 16000 ? `${twiml.slice(0, 16000)}\n<!-- truncated for log -->` : twiml;
    console.log(`[${logLabel}] twiml length=${twiml.length} body=`, safe);
  } else {
    console.log(
      `[${logLabel}] twiml length=${twiml.length} (set MICAH_DEBUG_TWIML=1 for body preview)`
    );
  }
  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
