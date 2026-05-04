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
import {
  MICAH_SAY_LANGUAGE,
  gatherPlayOrPollyOliviaSay,
  micahDirectiveOsSayAttributes,
} from "@/lib/micah/twilio-voice";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";

type TwilioVR = import("twilio/lib/twiml/VoiceResponse");

export type PlainErrorTwiMLOptions = {
  /**
   * When set, append `<Gather action="…">` so the call can continue to `/api/voice/process`
   * instead of ending on `<Hangup>` (avoids “Twilio went silent / stopped responding”).
   */
  gatherContinuationUrl?: string;
};

/** Twilio Voice webhooks must get HTTP 200 with XML. Prefer ElevenLabs `<Play>`; always fall back to Polly.Olivia `<Say>` — never silence-only. */
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
      whatCallerHears: "ElevenLabs Micah MP3 (synthesised with hardcoded voice id only)",
    });
    vr.play(url);
  } else {
    console.warn(`[${logLabel}] ElevenLabs unavailable — Polly.Olivia Say fallback`, {
      micahVoiceQA: true,
      event: "twiml_error_path_polly_olivia",
      elevenLabsVoiceIdAttempted: MICAH_ELEVENLABS_VOICE_ID,
      pollyVoice: "Polly.Olivia",
      pollyLanguage: "en-AU",
      whatCallerHears: "Polly.Olivia en-AU reads apology (female Australian only)",
      empathyTuning: textSuggestsEmpatheticTts(saySlice),
    });
    vr.say(micahDirectiveOsSayAttributes(), userMessage.slice(0, 1000));
  }

  const gatherUrl = options?.gatherContinuationUrl?.trim();
  if (gatherUrl) {
    const gather = vr.gather({
      input: ["speech"],
      timeout: 12,
      speechTimeout: "auto",
      action: gatherUrl,
      method: "POST",
      language: MICAH_SAY_LANGUAGE as TwilioVR["GatherLanguage"],
    });
    gatherPlayOrPollyOliviaSay(
      gather,
      null,
      "Go ahead — I'm listening whenever you're ready."
    );
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
    console.log(`[${logLabel}] twiml length=${twiml.length} (set MICAH_DEBUG_TWIML=1 for body preview)`);
  }
  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
