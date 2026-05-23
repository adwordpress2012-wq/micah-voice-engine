import OpenAI from "openai";
import twilio from "twilio";
import { Resend } from "resend";
import { plainErrorTwiMLResponse, twimlResponse } from "@/lib/micah/twiml-fallback";
import {
  canUseElevenLabsTts,
  defaultElevenLabsTtsTimeoutMs,
  elevenLabsTtsPublicMp3UrlWithTimeout,
} from "@/lib/micah/elevenlabs-tts";
import { micahElevenLabsOptsForUtterance } from "@/lib/micah/micah-empathy-tts";
import { resolveVoiceActionBaseUrl } from "@/lib/micah-prompt";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";
import {
  isUuid,
  lookupClientByTwilioTo,
  type MicahClientRow,
} from "@/lib/micah/lookup-client";
import { buildMicahDirectiveProcessSystemPrompt } from "@/lib/micah/micah-directive-os-persona";
import {
  MICAH_SAY_LANGUAGE,
  playOrFallbackMp3,
} from "@/lib/micah/twilio-voice";
import type { SupabaseClient } from "@supabase/supabase-js";

type TwilioVR = import("twilio/lib/twiml/VoiceResponse");

export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.OPENAI_MICAH_PROCESS_MODEL ?? "gpt-4o-mini";

function fallbackClient(): MicahClientRow {
  return {
    id: "",
    agency_name:
      process.env.MICAH_FALLBACK_AGENCY_NAME?.trim() ?? "Directive OS",
    twilio_number: "",
    email: process.env.MICAH_FALLBACK_CLIENT_EMAIL?.trim() ?? "",
    domain: null,
  };
}

async function buildOpeningTwiml(
  greeting: string,
  gatherActionUrl: string,
  supabase: SupabaseClient | null,
  callSid: string
): Promise<string> {
  const vr = new twilio.twiml.VoiceResponse();
  const sid = callSid || `anon-${Date.now()}`;
  const budget = defaultElevenLabsTtsTimeoutMs();

  const staticGreetingMp3 = process.env.MICAH_GREETING_MP3_URL?.trim() || null;
  let greetUrl: string | null = staticGreetingMp3;
  if (canUseElevenLabsTts(supabase) && supabase) {
    if (!greetUrl) {
      greetUrl = await elevenLabsTtsPublicMp3UrlWithTimeout(
        supabase,
        greeting,
        sid,
        budget,
        micahElevenLabsOptsForUtterance(greeting)
      );
    }
  }

  playOrFallbackMp3(vr, greetUrl, greeting);

  vr.gather({
    input: ["speech"],
    timeout: 15,
    speechTimeout: "auto",
    actionOnEmptyResult: true,
    action: gatherActionUrl,
    method: "POST",
    language: MICAH_SAY_LANGUAGE as TwilioVR["GatherLanguage"],
  });

  vr.redirect({ method: "POST" }, gatherActionUrl);
  return vr.toString();
}

async function buildConversationTwiml(
  assistantLine: string,
  gatherActionUrl: string,
  supabase: SupabaseClient | null,
  callSid: string,
  assistantMp3Url: string | null
): Promise<string> {
  const vr = new twilio.twiml.VoiceResponse();
  const sid = callSid || `anon-${Date.now()}`;
  const budget = defaultElevenLabsTtsTimeoutMs();

  let mainUrl: string | null = assistantMp3Url?.trim() || null;

  if (canUseElevenLabsTts(supabase) && supabase) {
    mainUrl =
      mainUrl ||
      (await elevenLabsTtsPublicMp3UrlWithTimeout(
        supabase,
        assistantLine,
        sid,
        budget,
        micahElevenLabsOptsForUtterance(assistantLine)
      ));
  }

  playOrFallbackMp3(vr, mainUrl, assistantLine);

  vr.gather({
    input: ["speech"],
    timeout: 15,
    speechTimeout: "auto",
    actionOnEmptyResult: true,
    action: gatherActionUrl,
    method: "POST",
    language: MICAH_SAY_LANGUAGE as TwilioVR["GatherLanguage"],
  });

  vr.redirect({ method: "POST" }, gatherActionUrl);
  return vr.toString();
}

export async function GET() {
  return new Response("Micah POST /api/process — Twilio Voice webhook", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(req: Request): Promise<Response> {
  const base = resolveVoiceActionBaseUrl(req);
  const gatherActionUrl = `${base}/api/process`;
  const gatherOpts = { gatherContinuationUrl: gatherActionUrl };

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return plainErrorTwiMLResponse(
      "",
      "Micah isn't configured yet — please try again later.",
      "[micah/process] no-openai",
      gatherOpts
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return plainErrorTwiMLResponse(
      "",
      "Invalid request.",
      "[micah/process] bad-form",
      gatherOpts
    );
  }

  console.log(
    "[DirectiveOS-Debug] Call from:",
    form.get("From"),
    "To:",
    form.get("To")
  );
  console.log("[micah/process] Twilio webhook meta", {
    CallSid: form.get("CallSid"),
    From: form.get("From"),
    To: form.get("To"),
  });

  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };

  const userInput = get("SpeechResult").trim();
  const toNumber = get("To");
  const callSid = get("CallSid").trim();

  const supabase = getServiceSupabaseOrNull();
  let dbClient: MicahClientRow | null = null;
  if (supabase && toNumber) {
    dbClient = await lookupClientByTwilioTo(supabase, toNumber);
  }

  const client = dbClient ?? fallbackClient();
  const matchedFromDb = dbClient != null;

  console.log("[micah/process] matched client", {
    matchedFromDb,
    agency_name: client.agency_name,
  });

  console.log("[Micah-Audit] Gather action URL:", gatherActionUrl);

  const greeting = `G'day! You've reached ${client.agency_name}, I'm Micah. How can I help you today?`;

  if (!userInput) {
    const twiml = await buildOpeningTwiml(
      greeting,
      gatherActionUrl,
      supabase,
      callSid
    );
    return twimlResponse(twiml, "[micah/process] opening");
  }

  const openai = new OpenAI({ apiKey });
  let assistantText = "Sorry, could you please repeat that?";

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: buildMicahDirectiveProcessSystemPrompt(
            client.agency_name,
            toNumber
          ),
        },
        { role: "user", content: userInput },
      ],
      temperature: 0.6,
      max_tokens: 220,
    });
    assistantText =
      completion.choices[0]?.message?.content?.trim() ?? assistantText;
  } catch (e) {
    const err = e as Error & { status?: number; code?: string };
    console.error("[micah/process] OpenAI chat failed:", {
      message: err?.message ?? String(e),
      name: err?.name,
      status: err?.status,
      code: err?.code,
      stack: err?.stack?.split("\n").slice(0, 4).join(" | "),
    });
  }

  if (matchedFromDb && supabase && dbClient && isUuid(dbClient.id)) {
    const { error: leadErr } = await supabase.from("leads").insert({
      client_id: dbClient.id,
      raw_text: userInput,
      created_at: new Date().toISOString(),
    });
    if (leadErr) {
      console.error("[micah/process] leads insert:", leadErr.message);
    }
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  const resendFrom = process.env.RESEND_FROM?.trim();
  const notifyTo = client.email?.trim();
  if (resendKey && resendFrom && notifyTo) {
    try {
      const resend = new Resend(resendKey);
      await resend.emails.send({
        from: resendFrom,
        to: [notifyTo],
        subject: `New lead for ${client.agency_name}`,
        text: userInput,
      });
    } catch (e) {
      console.error("[micah/process] Resend:", e);
    }
  }

  let assistantMp3Url: string | null = null;
  if (canUseElevenLabsTts(supabase)) {
    assistantMp3Url = await elevenLabsTtsPublicMp3UrlWithTimeout(
      supabase,
      assistantText,
      callSid || `anon-${Date.now()}`,
      defaultElevenLabsTtsTimeoutMs(),
      micahElevenLabsOptsForUtterance(assistantText)
    );
  }

  const twiml = await buildConversationTwiml(
    assistantText,
    gatherActionUrl,
    supabase,
    callSid,
    assistantMp3Url
  );
  return twimlResponse(twiml, "[micah/process] ok");
}
