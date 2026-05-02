import OpenAI from "openai";
import { Resend } from "resend";
import { plainErrorTwiML, twimlResponse } from "@/lib/micah/twiml-fallback";
import { micahSayLine } from "@/lib/micah/twilio-voice";
import { safeBuildPublicBaseUrl } from "@/lib/micah-prompt";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";
import { escapeXml } from "@/lib/twiml";
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
  return `You are Micah, a young, vibrant Australian real estate receptionist.

You work for ${agencyName}.

STRICT RULES:

* Follow NSW Property Services Act 2022 guidelines
* DO NOT provide property prices or price guides
* If asked about price, say:
  "I'll have the listing agent send you the full details shortly."

Voice:

* Friendly, confident, professional
* Keep responses short

Goal:

* Capture name
* Budget (if provided)
* Timeline
* Property type`;
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

function conversationTwiml(assistantLine: string, gatherActionUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${micahSayLine(assistantLine)}
  <Gather
    input="speech"
    timeout="15"
    speechTimeout="auto"
    action="${escapeXml(gatherActionUrl)}"
    method="POST"
    language="en-AU"
  >
    ${micahSayLine("Anything else I can help with?")}
  </Gather>
  ${micahSayLine("Thanks for calling — goodbye for now.")}
  <Hangup/>
</Response>`;
}

function openingTwiml(greeting: string, gatherActionUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${micahSayLine(greeting)}
  <Gather
    input="speech"
    timeout="15"
    speechTimeout="auto"
    action="${escapeXml(gatherActionUrl)}"
    method="POST"
    language="en-AU"
  >
    ${micahSayLine("I'm listening.")}
  </Gather>
  ${micahSayLine("I'll hang up — feel free to call back anytime.")}
  <Hangup/>
</Response>`;
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

  const base = safeBuildPublicBaseUrl(req);
  const gatherActionUrl = `${base}/api/process`;

  const greeting = `Hi, welcome to ${client.agency_name}. This is Micah speaking. How can I help you today?`;

  if (!userInput) {
    return twimlResponse(
      openingTwiml(greeting, gatherActionUrl),
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

  return twimlResponse(
    conversationTwiml(assistantText, gatherActionUrl),
    "[micah/process] ok"
  );
}
