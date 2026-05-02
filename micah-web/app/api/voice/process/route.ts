import OpenAI from "openai";
import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { cedarTtsPublicMp3Url } from "@/lib/micah/cedar-tts";
import {
  MICAH_OPENAI_VOICE,
  buildMasterSystemPromptV2,
} from "@/lib/micah/master-prompt-v2";
import { micahSayLine } from "@/lib/micah/twilio-voice";
import { getTenantVoiceConfig } from "@/lib/micah/tenant-config";
import { buildPublicBaseUrl } from "@/lib/micah-prompt";
import { escapeXml } from "@/lib/twiml";
import { loadHistory, saveTurnToLead } from "@/lib/voice-session";

export const maxDuration = 60;

const GPT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o";

async function fetchRecordingBytes(recordingUrl: string): Promise<ArrayBuffer> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const headers: HeadersInit = {};
  if (sid && token) {
    const basic = Buffer.from(`${sid}:${token}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  }
  const res = await fetch(recordingUrl, { headers });
  if (!res.ok) {
    throw new Error(`Recording fetch failed: ${res.status}`);
  }
  return res.arrayBuffer();
}

async function transcribeOpenAI(
  openai: OpenAI,
  recordingUrl: string,
  callSid: string
): Promise<string> {
  const buf = await fetchRecordingBytes(recordingUrl);
  const blob = new Blob([buf], { type: "audio/wav" });
  const file = new File([blob], `${callSid}.wav`, { type: "audio/wav" });
  const model = process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1";
  const forceEnglishOnly = process.env.MICAH_STT_MULTILINGUAL === "false";
  const fixedLang = process.env.OPENAI_TRANSCRIBE_LANGUAGE?.trim();
  const tr = await openai.audio.transcriptions.create({
    file,
    model,
    ...(forceEnglishOnly && fixedLang ? { language: fixedLang } : {}),
    prompt:
      process.env.OPENAI_TRANSCRIBE_PROMPT ??
      "Transcribe faithfully. Audio may be multilingual or code-switched with English.",
  });
  return tr.text.trim();
}

function continuationTwiml(params: {
  assistantPlayUrl: string | null;
  assistantFallbackText: string;
  actionUrl: string;
}): string {
  const mode = (process.env.MICAH_TWIML_MODE ?? "gather").toLowerCase();
  const followUp =
    "What's next — anything else I can sort for you? I'm listening.";
  const mainAudio =
    params.assistantPlayUrl != null
      ? `<Play>${escapeXml(params.assistantPlayUrl)}</Play>`
      : micahSayLine(params.assistantFallbackText);

  if (mode === "record") {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${mainAudio}
  ${micahSayLine(followUp)}
  <Record
    timeout="15"
    maxLength="120"
    playBeep="false"
    action="${escapeXml(params.actionUrl)}"
    method="POST"
    trim="trim-silence"
  />
  ${micahSayLine("Thanks for chatting — speak soon. Bye!")}
  <Hangup/>
</Response>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${mainAudio}
  <Gather
    input="speech"
    timeout="15"
    speechTimeout="auto"
    action="${escapeXml(params.actionUrl)}"
    method="POST"
    language="en-AU"
  >
    ${micahSayLine(followUp)}
  </Gather>
  ${micahSayLine("I'll hop off — call back anytime. Take care!")}
  <Hangup/>
</Response>`;
}

function emptyInputTwiml(actionUrl: string): string {
  const mode = (process.env.MICAH_TWIML_MODE ?? "gather").toLowerCase();
  if (mode === "record") {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${micahSayLine("Sorry — I didn't catch that. Let's try once more after the tone.")}
  <Record
    timeout="10"
    maxLength="120"
    playBeep="false"
    action="${escapeXml(actionUrl)}"
    method="POST"
    trim="trim-silence"
  />
  ${micahSayLine("No worries — try again later. Bye!")}
  <Hangup/>
</Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${micahSayLine("Sorry, I missed that — mind saying it again?")}
  <Gather
    input="speech"
    timeout="15"
    speechTimeout="auto"
    action="${escapeXml(actionUrl)}"
    method="POST"
    language="en-AU"
  >
    ${micahSayLine("Go ahead, I'm listening.")}
  </Gather>
  ${micahSayLine("I'll let you go — bye for now!")}
  <Hangup/>
</Response>`;
}

export async function POST(req: Request): Promise<Response> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return new NextResponse("Missing OPENAI_API_KEY", { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new NextResponse("Expected form body", { status: 400 });
  }

  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };

  const speechResult = get("SpeechResult")?.trim();
  const recordingUrl = get("RecordingUrl");
  const callSid = get("CallSid") ?? "unknown";
  const from = get("From") ?? "unknown";

  const url = new URL(req.url);
  const tenantIdParam = url.searchParams.get("tenant_id");
  const tenantSuffix =
    tenantIdParam != null && tenantIdParam !== ""
      ? `?tenant_id=${encodeURIComponent(tenantIdParam)}`
      : "";

  let userText = speechResult;
  const openai = new OpenAI({ apiKey: key });

  if (!userText?.length && recordingUrl) {
    try {
      userText = await transcribeOpenAI(openai, recordingUrl, callSid);
    } catch (e) {
      console.error(e);
      userText = "";
    }
  }

  const baseEarly = buildPublicBaseUrl(req);
  const actionEarly = `${baseEarly}/api/voice/process${tenantSuffix}`;

  if (!userText) {
    const twiml = emptyInputTwiml(actionEarly);
    return new NextResponse(twiml, {
      status: 200,
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  }

  const supabase = getServiceSupabase();
  let prior: Awaited<ReturnType<typeof loadHistory>> = [];
  try {
    prior = await loadHistory(supabase, callSid);
  } catch (e) {
    console.error("loadHistory:", e);
  }

  let tenantConfig = null as Awaited<ReturnType<typeof getTenantVoiceConfig>>;
  if (tenantIdParam) {
    try {
      tenantConfig = await getTenantVoiceConfig(supabase, tenantIdParam);
    } catch (e) {
      console.error("getTenantVoiceConfig:", e);
    }
  }

  const resolvedTenantId = tenantConfig?.tenant_id ?? tenantIdParam ?? null;

  const appendix =
    tenantConfig?.micah_persona && tenantConfig.micah_persona.trim().length > 0
      ? tenantConfig.micah_persona.trim()
      : null;

  const systemPrompt = buildMasterSystemPromptV2({
    agencyName: tenantConfig?.agency_name,
    principalName: tenantConfig?.principal_name,
    tenantMicahPersonaAppendix: appendix,
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...prior.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userText },
  ];

  let assistantText: string;
  try {
    const completion = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 300,
    });
    assistantText =
      completion.choices[0]?.message?.content?.trim() ??
      "Let me get someone from the team to call you back.";
  } catch (e) {
    console.error(e);
    assistantText = "Something went wrong on our side — give us another try soon.";
  }

  let assistantPlayUrl: string | null = null;
  try {
    assistantPlayUrl = await cedarTtsPublicMp3Url(openai, supabase, assistantText, callSid);
  } catch (e) {
    console.error("cedar TTS:", e);
  }

  try {
    await saveTurnToLead(supabase, {
      callSid,
      callerId: from,
      userText,
      assistantText,
      history: prior,
      tenantId: resolvedTenantId,
      openaiVoice: MICAH_OPENAI_VOICE,
    });
  } catch (e) {
    console.error("saveTurnToLead:", e);
  }

  const base = buildPublicBaseUrl(req);
  const tenantSuffixEnd =
    resolvedTenantId != null && resolvedTenantId !== ""
      ? `?tenant_id=${encodeURIComponent(resolvedTenantId)}`
      : "";
  const action = `${base}/api/voice/process${tenantSuffixEnd}`;
  const twiml = continuationTwiml({
    assistantPlayUrl,
    assistantFallbackText: assistantText,
    actionUrl: action,
  });

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
