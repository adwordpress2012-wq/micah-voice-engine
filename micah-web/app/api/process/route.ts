import OpenAI from "openai";
import twilio from "twilio";
import { Resend } from "resend";
import { plainErrorTwiML, twimlResponse } from "@/lib/micah/twiml-fallback";
import { applyMicahVoice, micahVoice, type MicahVoiceResult } from "@/lib/micah/voice-output";
import { buildMicahSystemPrompt, MICAH_OPENING_GREETING } from "@/lib/micah/micah-voice-persona";
import { safeBuildPublicBaseUrl } from "@/lib/micah-prompt";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";
import {
  isUuid,
  lookupClientByTwilioTo,
  type MicahClientRow,
} from "@/lib/micah/lookup-client";

export const maxDuration = 60;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.OPENAI_MICAH_PROCESS_MODEL ?? "gpt-4o-mini";

function buildSystemPrompt(agencyName: string): string {
  // Re-uses the canonical Micah persona so all routes share the same identity.
  // /api/process is the legacy multi-tenant webhook used by per-client numbers; treat
  // it as a "demo" line so Micah can engage if a caller raises real-estate topics
  // (e.g. the demo number 02 5950 6382 routed here historically). Agency name is
  // surfaced in the prompt via MICAH_FALLBACK_AGENCY_NAME at module load time.
  void agencyName;
  return buildMicahSystemPrompt({ mode: "demo" });
}

function fallbackClient(): MicahClientRow {
  return {
    id: "",
    agency_name:
      process.env.MICAH_FALLBACK_AGENCY_NAME?.trim() ?? "our office",
    twilio_number: "",
    email: process.env.MICAH_FALLBACK_CLIENT_EMAIL?.trim() ?? "",
    domain: null,
  };
}

function conversationTwiml(
  assistant: MicahVoiceResult,
  followup: MicahVoiceResult,
  gatherActionUrl: string
): string {
  const vr = new twilio.twiml.VoiceResponse();
  applyMicahVoice(vr, assistant);
  const gather = vr.gather({
    input: ["speech"],
    timeout: 15,
    speechTimeout: "auto",
    action: gatherActionUrl,
    method: "POST",
    language: "en-AU",
    actionOnEmptyResult: true,
  });
  applyMicahVoice(gather, followup);
  vr.redirect({ method: "POST" }, gatherActionUrl);
  return vr.toString();
}

function openingTwiml(
  greeting: MicahVoiceResult,
  listening: MicahVoiceResult,
  gatherActionUrl: string
): string {
  const vr = new twilio.twiml.VoiceResponse();
  applyMicahVoice(vr, greeting);
  const gather = vr.gather({
    input: ["speech"],
    timeout: 15,
    speechTimeout: "auto",
    action: gatherActionUrl,
    method: "POST",
    language: "en-AU",
    actionOnEmptyResult: true,
  });
  applyMicahVoice(gather, listening);
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
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return twimlResponse(
      plainErrorTwiML("Micah isn't configured yet — please try again later."),
      "[micah/process] no-openai"
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return twimlResponse(
      plainErrorTwiML("Invalid request."),
      "[micah/process] bad-form"
    );
  }

  console.log("Incoming Twilio:", Object.fromEntries(form.entries()));

  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };

  const userInput = get("SpeechResult").trim();
  const toNumber = get("To");

  const supabase = getServiceSupabaseOrNull();
  let dbClient: MicahClientRow | null = null;
  if (supabase && toNumber) {
    dbClient = await lookupClientByTwilioTo(supabase, toNumber);
  }

  const client = dbClient ?? fallbackClient();
  const matchedFromDb = dbClient != null;

  console.log("Matched client:", matchedFromDb ? dbClient : client);

  // NEXT_PUBLIC_APP_URL always wins so <Gather action> never points to a preview deployment.
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    safeBuildPublicBaseUrl(req);
  const gatherActionUrl = `${base}/api/process`;

  const callSidForTts = get("CallSid") || `nosid-${Date.now()}`;

  if (!userInput) {
    const [greetingAudio, listening] = await Promise.all([
      micahVoice({
        text: MICAH_OPENING_GREETING,
        callSid: `greeting-${callSidForTts}`,
        supabase,
        label: "process/greeting",
      }),
      micahVoice({
        text: "I'm listening.",
        callSid: `listening-${callSidForTts}`,
        supabase,
        label: "process/listening",
      }),
    ]);
    return twimlResponse(
      openingTwiml(greetingAudio, listening, gatherActionUrl),
      "[micah/process] opening"
    );
  }

  const openai = new OpenAI({ apiKey });
  let assistantText =
    "Sorry, I didn't catch that. Can you please repeat your details?";

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: buildSystemPrompt(client.agency_name) },
        { role: "user", content: userInput },
      ],
      temperature: 0.6,
      max_tokens: 220,
    });
    assistantText =
      completion.choices[0]?.message?.content?.trim() ?? assistantText;
  } catch (e) {
    console.error("[micah/process] OpenAI:", e);
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
        to: notifyTo,
        subject: `New lead for ${client.agency_name}`,
        text: userInput,
      });
    } catch (e) {
      console.error("[micah/process] Resend:", e);
    }
  }

  const [assistantAudio, followup] = await Promise.all([
    micahVoice({
      text: assistantText,
      callSid: `reply-${callSidForTts}`,
      supabase,
      label: "process/reply",
    }),
    micahVoice({
      text: "Anything else I can help with?",
      callSid: `followup-${callSidForTts}`,
      supabase,
      label: "process/followup",
    }),
  ]);
  return twimlResponse(
    conversationTwiml(assistantAudio, followup, gatherActionUrl),
    "[micah/process] ok"
  );
}
