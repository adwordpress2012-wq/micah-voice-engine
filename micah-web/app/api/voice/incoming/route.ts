import twilio from "twilio";
import type { NextRequest } from "next/server";
import { plainErrorTwiMLResponse, twimlResponse } from "@/lib/micah/twiml-fallback";
import { MICAH_SAY_LANGUAGE } from "@/lib/micah/twilio-voice";
import { defaultElevenLabsTtsTimeoutMs } from "@/lib/micah/elevenlabs-tts";
import { applyMicahVoice, micahVoice } from "@/lib/micah/voice-output";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";
import {
  MICAH_DOS_SBA_GREETING_TEXT,
  micahGatherOpeningSay,
} from "@/lib/micah/voice-greetings";
import { isValidTwilioVoiceWebhook } from "@/lib/micah/twilio-webhook-auth";
import { MICAH_ELEVENLABS_VOICE_ID } from "@/lib/micah/elevenlabs-tts";

type TwilioVR = import("twilio/lib/twiml/VoiceResponse");

const VOICE_ENGINE = process.env.MICAH_VOICE_ENGINE?.trim().toLowerCase() ?? "";
const STREAM_WSS = process.env.MICAH_MEDIA_STREAM_WSS_URL?.trim() ?? "";
const BRIDGE_TOKEN = process.env.MICAH_BRIDGE_SECRET?.trim() ?? "";

const INCOMING_GATHER_TIMEOUT_SEC = 10;
const DOS_SBA_GREETING_MP3_PATH = "/micah-dos-sba-greeting-v2.mp3";
const MICAH_PRODUCTION_VOICE_ORIGIN = "https://micah.directiveos.com.au";

function formString(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function resolveGreetingMp3Url(): string {
  return `${MICAH_PRODUCTION_VOICE_ORIGIN}${DOS_SBA_GREETING_MP3_PATH}`;
}

/**
 * First spoken line uses {@link micahVoice} + {@link applyMicahVoice} (ElevenLabs Aussie Micah,
 * or `MICAH_GREETING_MP3_URL` / `MICAH_FALLBACK_MP3_URL`). When no static greeting URL is set,
 * EL runs under {@link defaultElevenLabsTtsTimeoutMs} so the webhook stays within typical
 * serverless limits. Brand policy: Aussie Micah ElevenLabs OR static MP3 only — no Polly.
 */
export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response(
    "POST /api/voice/incoming - Micah (gather -> /api/voice/process). Opening line is locked to DOS Smart Business Assistant.",
    {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }
  );
}

export async function POST(request: NextRequest) {
  const gatherContinuationUrl = `${MICAH_PRODUCTION_VOICE_ORIGIN}/api/voice/process`;
  const gatherOpts = { gatherContinuationUrl };

  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return plainErrorTwiMLResponse(
        "",
        "Hi, it's Micah — I couldn't read that request properly. Please try calling again.",
        "[micah/voice/incoming] bad-form",
        gatherOpts
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
        "[micah/voice/incoming] bad-signature",
        gatherOpts
      );
    }

    const useRealtime = false;
    if (VOICE_ENGINE === "realtime" || VOICE_ENGINE === "openai-realtime") {
      console.warn(
        "[micah/voice/incoming] MICAH_VOICE_ENGINE realtime ignored; DOS SBA gather path is locked for this route."
      );
    }

    const sid = callSid || `anon-${Date.now()}`;
    const supabase = getServiceSupabaseOrNull();

    if (useRealtime) {
      if (!STREAM_WSS) {
        return plainErrorTwiMLResponse(
          callSid,
          "Micah's realtime voice link isn't configured yet — please try again later.",
          "[micah/voice/incoming] missing-stream-url",
          gatherOpts
        );
      }
      let streamUrl = STREAM_WSS;
      if (BRIDGE_TOKEN && !/[?&]token=/.test(streamUrl)) {
        streamUrl += `${streamUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(BRIDGE_TOKEN)}`;
      }

      const from = formString(form, "From");
      const to = formString(form, "To");

      const preconnect = MICAH_DOS_SBA_GREETING_TEXT;
      const staticPre = resolveGreetingMp3Url();

      const vr = new twilio.twiml.VoiceResponse();
      const preResult = await micahVoice({
        text: preconnect,
        callSid: sid,
        supabase,
        label: "incoming-realtime-preconnect",
        preferredPlayUrl: staticPre,
        ttsBudgetMs: staticPre ? undefined : defaultElevenLabsTtsTimeoutMs(),
      });
      applyMicahVoice(vr, preResult);

      const connect = vr.connect();
      const stream = connect.stream({
        url: streamUrl,
        track: "inbound_track",
      });
      stream.parameter({ name: "From", value: from });
      stream.parameter({ name: "To", value: to });

      console.log(
        "[micah/voice/incoming] realtime TwiML — micahVoice preconnect + <Connect><Stream>, EL voiceId=",
        MICAH_ELEVENLABS_VOICE_ID
      );

      return new Response(vr.toString(), {
        status: 200,
        headers: { "Content-Type": "text/xml; charset=utf-8" },
      });
    }

    const processUrl = `${MICAH_PRODUCTION_VOICE_ORIGIN}/api/voice/process`;
    console.log("[Micah-Audit] Gather action URL:", processUrl);

    const opening = micahGatherOpeningSay();
    const staticGreetingMp3 = resolveGreetingMp3Url();

    const twiml = new twilio.twiml.VoiceResponse();

    const gather = twiml.gather({
      input: ["speech"],
      timeout: INCOMING_GATHER_TIMEOUT_SEC,
      speechTimeout: "auto",
      actionOnEmptyResult: true,
      action: processUrl,
      method: "POST",
      language: MICAH_SAY_LANGUAGE as TwilioVR["GatherLanguage"],
    });
    const openingResult = await micahVoice({
      text: opening,
      callSid: sid,
      supabase,
      label: "incoming-gather-opening",
      preferredPlayUrl: staticGreetingMp3,
      ttsBudgetMs: staticGreetingMp3 ? undefined : defaultElevenLabsTtsTimeoutMs(),
    });
    applyMicahVoice(gather, openingResult);

    twiml.redirect({ method: "POST" }, processUrl);

    console.log(
      "[micah/voice/incoming] <Gather> opening via micahVoice; Aussie Micah EL on /api/voice/process, voiceId=",
      MICAH_ELEVENLABS_VOICE_ID
    );

    return twimlResponse(twiml.toString(), "[micah/voice/incoming] gather-ok");
  } catch (e) {
    console.error("[micah/voice/incoming] fatal:", e);
    let fatalGather: { gatherContinuationUrl?: string } | undefined;
    try {
      fatalGather = {
        gatherContinuationUrl,
      };
    } catch {
      /* no NEXT_PUBLIC_APP_URL — omit gather */
    }
    return plainErrorTwiMLResponse(
      "",
      "Hi, it's Micah — I'm having a quick connection hiccup. Please try your call again in a moment.",
      "[micah/voice/incoming] fatal",
      fatalGather
    );
  }
}
