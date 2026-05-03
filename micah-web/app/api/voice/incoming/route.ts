import twilio from "twilio";
import type { NextRequest } from "next/server";
import { plainErrorTwiMLResponse, twimlResponse } from "@/lib/micah/twiml-fallback";
import {
  MICAH_SAY_LANGUAGE,
  gatherPlayOrPollyOliviaSay,
  playOrPollyOliviaSay,
} from "@/lib/micah/twilio-voice";
import {
  micahGatherOpeningSay,
  micahGatherTimeoutSay,
  micahRealtimePreconnectSay,
} from "@/lib/micah/voice-greetings";
import { resolveVoiceActionBaseUrl } from "@/lib/micah-prompt";
import { isValidTwilioVoiceWebhook } from "@/lib/micah/twilio-webhook-auth";
import {
  canUseElevenLabsTts,
  defaultElevenLabsTtsTimeoutMs,
  elevenLabsTtsPublicMp3UrlWithTimeout,
  micahTtsBlockedReasons,
  AUSSIE_MICAH_VOICE_ID,
} from "@/lib/micah/elevenlabs-tts";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";

type TwilioVR = import("twilio/lib/twiml/VoiceResponse");

const VOICE_ENGINE = process.env.MICAH_VOICE_ENGINE?.trim().toLowerCase() ?? "";
const STREAM_WSS = process.env.MICAH_MEDIA_STREAM_WSS_URL?.trim() ?? "";
const BRIDGE_TOKEN = process.env.MICAH_BRIDGE_SECRET?.trim() ?? "";

const INCOMING_GATHER_TIMEOUT_SEC = 10;

function formString(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Two EL synths + cold start can exceed 30s — Twilio needs 200 + TwiML before timeout. */
export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const mode =
    VOICE_ENGINE === "realtime" || VOICE_ENGINE === "openai-realtime"
      ? "realtime media stream"
      : "gather → /api/voice/process";
  return new Response(
    `POST /api/voice/incoming — Micah (${mode}). ElevenLabs <Play> + Polly.Olivia fallback.`,
    {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return plainErrorTwiMLResponse(
        "",
        "Hi, it's Micah — I couldn't read that request properly. Please try calling again.",
        "[micah/voice/incoming] bad-form"
      );
    }

    console.log(
      "[DirectiveOS-Debug] Call from:",
      form.get("From"),
      "To:",
      form.get("To")
    );

    const callSid = formString(form, "CallSid");

    if (!isValidTwilioVoiceWebhook(request, form)) {
      console.warn("[micah/voice/incoming] invalid Twilio signature");
      return plainErrorTwiMLResponse(
        callSid,
        "Hi — I'm having trouble verifying this call. Please hang up and dial again.",
        "[micah/voice/incoming] bad-signature"
      );
    }

    const useRealtime =
      VOICE_ENGINE === "realtime" || VOICE_ENGINE === "openai-realtime";

    const supabase = getServiceSupabaseOrNull();
    const sid = callSid || `anon-${Date.now()}`;
    const budget = defaultElevenLabsTtsTimeoutMs();

    if (useRealtime) {
      if (!STREAM_WSS) {
        return plainErrorTwiMLResponse(
          callSid,
          "Micah's realtime voice link isn't configured yet — please try again later.",
          "[micah/voice/incoming] missing-stream-url"
        );
      }
      let streamUrl = STREAM_WSS;
      if (BRIDGE_TOKEN && !/[?&]token=/.test(streamUrl)) {
        streamUrl += `${streamUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(BRIDGE_TOKEN)}`;
      }

      const from = formString(form, "From");
      const to = formString(form, "To");

      const preconnect = micahRealtimePreconnectSay();
      console.log(
        "[micah/voice/incoming] realtime TwiML — preconnect ElevenLabs, length=",
        preconnect.length
      );

      const vr = new twilio.twiml.VoiceResponse();
      const staticPre = process.env.MICAH_GREETING_MP3_URL?.trim() || null;
      let preUrl: string | null = staticPre;
      if (!preUrl && canUseElevenLabsTts(supabase)) {
        preUrl = await elevenLabsTtsPublicMp3UrlWithTimeout(
          supabase,
          preconnect,
          sid,
          budget
        );
      }
      playOrPollyOliviaSay(vr, preUrl, preconnect);

      const connect = vr.connect();
      const stream = connect.stream({
        url: streamUrl,
        track: "inbound_track",
      });
      stream.parameter({ name: "From", value: from });
      stream.parameter({ name: "To", value: to });

      return new Response(vr.toString(), {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" },
      });
    }

    const base = resolveVoiceActionBaseUrl(request);
    const processUrl = `${base}/api/voice/process`;
    console.log("[Micah-Audit] Gather action URL:", processUrl);

    const opening = micahGatherOpeningSay();
    const timeoutLine = micahGatherTimeoutSay();
    const elOk = canUseElevenLabsTts(supabase);
    if (!elOk) {
      console.error("[micah/voice/incoming] ElevenLabs `<Play>` blocked:", micahTtsBlockedReasons());
    } else {
      console.log("[micah/voice/incoming] EL ok voiceId=", AUSSIE_MICAH_VOICE_ID);
    }

    console.log(
      "[micah/voice/incoming] gather — opening length=",
      opening.length,
      "timeoutLine length=",
      timeoutLine.length
    );

    const twiml = new twilio.twiml.VoiceResponse();

    const staticGreetingMp3 = process.env.MICAH_GREETING_MP3_URL?.trim() || null;
    let openingAudioUrl: string | null = staticGreetingMp3;
    let timeoutUrl: string | null = null;
    if (elOk && supabase) {
      const timeoutPromise = elevenLabsTtsPublicMp3UrlWithTimeout(
        supabase,
        timeoutLine,
        sid,
        budget
      );
      if (!openingAudioUrl) {
        [openingAudioUrl, timeoutUrl] = await Promise.all([
          elevenLabsTtsPublicMp3UrlWithTimeout(supabase, opening, sid, budget),
          timeoutPromise,
        ]);
      } else {
        timeoutUrl = await timeoutPromise;
      }
    }

    const gather = twiml.gather({
      input: ["speech"],
      timeout: INCOMING_GATHER_TIMEOUT_SEC,
      speechTimeout: "auto",
      action: processUrl,
      method: "POST",
      language: MICAH_SAY_LANGUAGE as TwilioVR["GatherLanguage"],
    });
    gatherPlayOrPollyOliviaSay(gather, openingAudioUrl, opening);

    playOrPollyOliviaSay(twiml, timeoutUrl, timeoutLine);
    twiml.hangup();

    return new Response(twiml.toString(), {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  } catch (e) {
    console.error("[micah/voice/incoming] fatal:", e);
    return plainErrorTwiMLResponse(
      "",
      "Hi, it's Micah — I'm having a quick connection hiccup. Please try your call again in a moment.",
      "[micah/voice/incoming] fatal"
    );
  }
}
