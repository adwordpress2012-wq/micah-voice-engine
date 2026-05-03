import twilio from "twilio";
import type { NextRequest } from "next/server";
import { plainErrorTwiML, twimlResponse } from "@/lib/micah/twiml-fallback";
import { MICAH_SAY_LANGUAGE, micahSayAttributes } from "@/lib/micah/twilio-voice";
import { MICAH_OPENING_GREETING } from "@/lib/micah/micah-voice-persona";
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
    console.log("[micah/debug] incoming start:", {
      voiceEngine: VOICE_ENGINE || "(gather default)",
      hasElevenLabsKey: !!process.env.ELEVENLABS_API_KEY,
      hasBucket: !!process.env.SUPABASE_TTS_BUCKET,
      voiceId:
        process.env.ELEVENLABS_VOICE_ID?.trim() ||
        process.env.AUSSIE_MICAH?.trim() ||
        "4Nz4vG2f9omkfcS8r4PJ (Aussie Micah default)",
      pollyFallback: process.env.MICAH_POLLY_VOICE?.trim() || "Polly.Olivia (default)",
      appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || "(not set — falling back to headers)",
    });

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

    // NEXT_PUBLIC_APP_URL always wins so <Gather action> never points to a preview deployment.
    const base =
      process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
      safeBuildPublicBaseUrl(request);

    // Demo number routing: if MICAH_DEMO_NUMBER matches the dialled `To`, persona
    // unlocks real-estate topics. Main number → ?mode=main (default behavior).
    const demoNumber = process.env.MICAH_DEMO_NUMBER?.trim();
    const toNumber = formString(form, "To");
    const isDemo = !!demoNumber && !!toNumber && toNumber === demoNumber;
    const processUrl = `${base}/api/voice/process?mode=${isDemo ? "demo" : "main"}`;
    console.log("[micah/debug] persona mode:", { to: toNumber || "(none)", isDemo });

    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
      input: ["speech"],
      timeout: INCOMING_GATHER_TIMEOUT_SEC,
      speechTimeout: "auto",
      action: processUrl,
      method: "POST",
      language: MICAH_SAY_LANGUAGE as TwilioVR["GatherLanguage"],
      // POST to the action URL even when no speech was captured so /process re-prompts
      // gracefully instead of Twilio falling through and ending the call after the greeting.
      actionOnEmptyResult: true,
    });
    gather.say(micahSayAttributes(), MICAH_OPENING_GREETING);
    // Defensive fallback: if Twilio still falls through (gather error), redirect to /process
    // so it handles the empty-speech path with a soft re-prompt instead of hanging up.
    twiml.redirect({ method: "POST" }, processUrl);

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
