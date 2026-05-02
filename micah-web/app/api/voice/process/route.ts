import OpenAI, { toFile } from "openai";
import { plainErrorTwiML, twimlResponse } from "@/lib/micah/twiml-fallback";
import { elevenLabsTtsPublicMp3Url } from "@/lib/micah/elevenlabs-tts";
import { buildMasterSystemPromptV2 } from "@/lib/micah/master-prompt-v2";
import { micahSayLine } from "@/lib/micah/twilio-voice";
import { getTenantVoiceConfig } from "@/lib/micah/tenant-config";
import { safeBuildPublicBaseUrl } from "@/lib/micah-prompt";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";
import { escapeXml } from "@/lib/twiml";
import { loadHistory, saveTurnToLead } from "@/lib/voice-session";

export const maxDuration = 60;

const GPT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o";

/** Optional JSON map of AccountSid → auth token for multi-account Twilio (same keys as Console). */
function twilioAuthTokenForAccount(accountSid: string): string | undefined {
  const raw = process.env.TWILIO_AUTH_BY_ACCOUNT_JSON?.trim();
  if (!raw) return undefined;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const v = o[accountSid];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  } catch {
    console.warn("[micah/voice] TWILIO_AUTH_BY_ACCOUNT_JSON is invalid JSON");
    return undefined;
  }
}

/** Twilio recording URLs require HTTP Basic auth (AccountSid:AuthToken). Webhook AccountSid takes priority. */
async function fetchRecordingBytes(
  recordingUrl: string,
  accountSidFromWebhook?: string
): Promise<ArrayBuffer | null> {
  const sid = (
    accountSidFromWebhook?.trim() ||
    process.env.TWILIO_ACCOUNT_SID?.trim() ||
    ""
  ).trim();

  const mapped = sid ? twilioAuthTokenForAccount(sid) : undefined;
  const token = (mapped ?? process.env.TWILIO_AUTH_TOKEN?.trim()) ?? "";

  if (!token) {
    console.error("ERROR: TWILIO_AUTH_TOKEN IS MISSING IN VERCEL");
    return null;
  }
  if (!sid) {
    console.warn(
      "[micah/voice] Recording fetch skipped: no AccountSid on webhook and TWILIO_ACCOUNT_SID unset"
    );
    return null;
  }

  if (mapped) {
    console.log(`[micah/voice] recording auth: using TWILIO_AUTH_BY_ACCOUNT_JSON for ${sid.slice(0, 6)}…`);
  }

  const res = await fetch(recordingUrl, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
    },
  });
  if (res.status === 401) {
    console.warn(
      `[micah/voice] Recording 401: use a token for AccountSid ${sid} — set TWILIO_AUTH_BY_ACCOUNT_JSON for multi-account or fix TWILIO_AUTH_TOKEN`
    );
    return null;
  }
  if (!res.ok) {
    console.warn(`[micah/voice] Recording fetch HTTP ${res.status}`);
    return null;
  }
  return res.arrayBuffer();
}

async function transcribeOpenAI(
  openai: OpenAI,
  recordingUrl: string,
  callSid: string,
  accountSid?: string
): Promise<string> {
  const buf = await fetchRecordingBytes(recordingUrl, accountSid);
  if (!buf) {
    return "";
  }
  const file = await toFile(Buffer.from(buf), `${callSid}.wav`, {
    type: "audio/wav",
  });
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
  console.log("Call Received");
  try {
    return await handleVoiceProcess(req);
  } catch (e) {
    console.error("[micah/voice/process] fatal:", e);
    return twimlResponse(
      plainErrorTwiML("Sorry — Micah hit a snag. Please try your call again shortly."),
      "[micah/voice/process] fatal"
    );
  }
}

async function handleVoiceProcess(req: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[micah/voice/process] OPENAI_API_KEY missing");
    return twimlResponse(
      plainErrorTwiML(
        "Micah isn't fully configured on the server yet — please try again later."
      ),
      "[micah/voice/process] no-openai-key"
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    console.error("[micah/voice/process] formData:", e);
    return twimlResponse(
      plainErrorTwiML("We couldn't read this call — please try again."),
      "[micah/voice/process] bad-body"
    );
  }

  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };

  const speechResult = get("SpeechResult")?.trim();
  const recordingUrl = get("RecordingUrl");
  const callSid = get("CallSid") ?? "unknown";
  const from = get("From") ?? "unknown";
  const accountSid = get("AccountSid");

  console.log("[micah/voice/process] request", {
    CallSid: callSid,
    From: from,
    SpeechResult: speechResult ? "[present]" : undefined,
    RecordingUrl: recordingUrl ? "[present]" : undefined,
  });

  const url = new URL(req.url);
  const tenantIdParam = url.searchParams.get("tenant_id");
  const tenantSuffix =
    tenantIdParam != null && tenantIdParam !== ""
      ? `?tenant_id=${encodeURIComponent(tenantIdParam)}`
      : "";

  let userText = speechResult;
  const openai = new OpenAI({ apiKey });

  if (!userText?.length && recordingUrl) {
    try {
      userText = await transcribeOpenAI(openai, recordingUrl, callSid, accountSid);
    } catch (e) {
      console.error("[micah/voice/process] transcribe:", e);
      userText = "";
    }
  }

  const baseEarly = safeBuildPublicBaseUrl(req);
  const actionEarly = `${baseEarly}/api/voice/process${tenantSuffix}`;

  if (!userText) {
    try {
      const twiml = emptyInputTwiml(actionEarly);
      return twimlResponse(twiml, "[micah/voice/process] empty-input");
    } catch (e) {
      console.error("[micah/voice/process] emptyInputTwiml:", e);
      return twimlResponse(
        plainErrorTwiML("I didn't catch that — please call back."),
        "[micah/voice/process] empty-twiml-error"
      );
    }
  }

  const supabase = getServiceSupabaseOrNull();
  if (!supabase) {
    console.warn("[micah/voice/process] Supabase not configured — continuing without DB");
  }

  let prior: Awaited<ReturnType<typeof loadHistory>> = [];
  if (supabase) {
    try {
      prior = await loadHistory(supabase, callSid);
    } catch (e) {
      console.error("[micah/voice/process] loadHistory:", e);
    }
  }

  let tenantConfig = null as Awaited<ReturnType<typeof getTenantVoiceConfig>>;
  if (supabase && tenantIdParam) {
    try {
      tenantConfig = await getTenantVoiceConfig(supabase, tenantIdParam);
    } catch (e) {
      console.error("[micah/voice/process] getTenantVoiceConfig:", e);
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
  console.log(
    `[micah/debug] Syla system prompt active (master-prompt-v2, ${systemPrompt.length} chars)`
  );

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
    console.error("[micah/voice/process] chat completion:", e);
    assistantText =
      "I'm having a moment connecting — please try again or leave a message with the team.";
  }

  let assistantPlayUrl: string | null = null;
  try {
    assistantPlayUrl = await elevenLabsTtsPublicMp3Url(
      supabase,
      assistantText,
      callSid
    );
  } catch (e) {
    console.error("[micah/voice/process] ElevenLabs TTS (non-fatal):", e);
  }
  console.log(
    `[micah/debug] AccountSid: ${accountSid ?? "none"}, TTS Success: ${assistantPlayUrl != null}`
  );

  if (supabase) {
    try {
      await saveTurnToLead(supabase, {
        callSid,
        callerId: from,
        userText,
        assistantText,
        history: prior,
        tenantId: resolvedTenantId,
        openaiVoice:
          process.env.ELEVENLABS_VOICE_ID?.trim() ?? "elevenlabs",
      });
    } catch (e) {
      console.error("[micah/voice/process] saveTurnToLead:", e);
    }
  }

  const base = safeBuildPublicBaseUrl(req);
  const tenantSuffixEnd =
    resolvedTenantId != null && resolvedTenantId !== ""
      ? `?tenant_id=${encodeURIComponent(resolvedTenantId)}`
      : "";
  const action = `${base}/api/voice/process${tenantSuffixEnd}`;

  try {
    const twiml = continuationTwiml({
      assistantPlayUrl,
      assistantFallbackText: assistantText,
      actionUrl: action,
    });
    return twimlResponse(twiml, "[micah/voice/process] ok");
  } catch (e) {
    console.error("[micah/voice/process] continuationTwiml (Polly fallback):", e);
    return twimlResponse(
      plainErrorTwiML(
        `${assistantText.slice(0, 350)} Sorry — I'm having trouble continuing this call. Please try again soon.`
      ),
      "[micah/voice/process] continuation-plain-fallback"
    );
  }
}
