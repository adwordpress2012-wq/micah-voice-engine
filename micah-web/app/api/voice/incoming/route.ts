import twilio from "twilio";
import type { NextRequest } from "next/server";
import { plainErrorTwiML, twimlResponse } from "@/lib/micah/twiml-fallback";
import { MICAH_SAY_LANGUAGE, micahSayAttributes } from "@/lib/micah/twilio-voice";
import { safeBuildPublicBaseUrl } from "@/lib/micah-prompt";
import { isValidTwilioVoiceWebhook } from "@/lib/micah/twilio-webhook-auth";

type TwilioVR = import("twilio/lib/twiml/VoiceResponse");

const VOICE_ENGINE = process.env.MICAH_VOICE_ENGINE?.trim().toLowerCase() ?? "";
const STREAM_WSS = process.env.MICAH_MEDIA_STREAM_WSS_URL?.trim() ?? "";
/** Must match `micah-realtime-bridge` env `MICAH_BRIDGE_SECRET` (appended as `?token=` when URL has no token). */
const BRIDGE_TOKEN = process.env.MICAH_BRIDGE_SECRET?.trim() ?? "";

/** Opening gather — enough time to speak after the greeting. */
const INCOMING_GATHER_TIMEOUT_SEC = 10;

function formString(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export const maxDuration = 30;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const mode =
    VOICE_ENGINE === "realtime" || VOICE_ENGINE === "openai-realtime"
      ? "realtime media stream"
      : "gather → /api/voice/process";
  return new Response(
    `POST /api/voice/incoming — Micah (${mode}). TwiML from POST only.`,
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
      return twimlResponse(
        plainErrorTwiML(
          "Hi, it's Micah — I couldn't read that request properly. Please try calling again."
        ),
        "[micah/voice/incoming] bad-form"
      );
    }

    if (!isValidTwilioVoiceWebhook(request, form)) {
      console.warn("[micah/voice/incoming] invalid Twilio signature");
      return twimlResponse(
        plainErrorTwiML(
          "Hi — I'm having trouble verifying this call. Please hang up and dial again."
        ),
        "[micah/voice/incoming] bad-signature"
      );
    }

    const useRealtime =
      VOICE_ENGINE === "realtime" || VOICE_ENGINE === "openai-realtime";

    if (useRealtime) {
      if (!STREAM_WSS) {
        return twimlResponse(
          plainErrorTwiML(
            "Micah's realtime voice link isn't configured yet — please try again later."
          ),
          "[micah/voice/incoming] missing-stream-url"
        );
      }
      let streamUrl = STREAM_WSS;
      if (BRIDGE_TOKEN && !/[?&]token=/.test(streamUrl)) {
        streamUrl += `${streamUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(BRIDGE_TOKEN)}`;
      }

      const from = formString(form, "From");
      const to = formString(form, "To");

      const vr = new twilio.twiml.VoiceResponse();
      const connect = vr.connect();
      // Twilio <Connect><Stream> allows only `inbound_track` (not `both_tracks` — error 31941).
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

    const base = safeBuildPublicBaseUrl(request);
    const processUrl = `${base}/api/voice/process`;

    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
      input: ["speech"],
      timeout: INCOMING_GATHER_TIMEOUT_SEC,
      speechTimeout: "auto",
      action: processUrl,
      method: "POST",
      language: MICAH_SAY_LANGUAGE as TwilioVR["GatherLanguage"],
    });
    gather.say(
      micahSayAttributes(),
      "Hi! This is Micah, your AI receptionist. How can I help you today?"
    );
    twiml.say(
      micahSayAttributes(),
      "I'll hang up for now — feel free to call back when you're ready. Bye!"
    );
    twiml.hangup();

    return new Response(twiml.toString(), {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  } catch (e) {
    console.error("[micah/voice/incoming] fatal:", e);
    return twimlResponse(
      plainErrorTwiML(
        "Hi, it's Micah — I'm having a quick connection hiccup. Please try your call again in a moment."
      ),
      "[micah/voice/incoming] fatal"
    );
  }
}
