import { Resend } from "resend";
import type { ChatTurn } from "@/lib/voice-session";
import {
  formatResendError,
  maskEmailAddress,
  resolveLeadRecipient,
  resolveResendApiKey,
  resolveResendFromAddress,
} from "@/lib/micah/resend-config";

const DOS_LEAD_SUBJECT = "New Micah Voice Lead - DOS";
const DOS_NEXT_ACTION = "Jayson to follow up personally.";

export type MicahLeadEmailTier = "basic" | "full";

type LeadEmailSentState = {
  basic: boolean;
  full: boolean;
};

const CALLBACK_INTENT_PATTERN =
  /\b(?:call me back|callback|ring me|contact me|follow up|speak to jayson|get jayson|can jayson|have jayson)\b/i;

type LeadDetails = {
  callerName: string | null;
  businessName: string | null;
  businessType: string | null;
  callbackNumber: string | null;
  callerEmail: string | null;
  bestTimeToCall: string | null;
  callbackPerson: string | null;
  needHelpWith: string | null;
};

/** Heuristic: Micah appears to have finished confirming details / closing warmly. */
export function micahReplyLooksLikeLeadWrapUp(reply: string): boolean {
  const r = reply.toLowerCase();
  return (
    r.includes("wonderful day") ||
    r.includes("lovely chatting") ||
    r.includes("call you back shortly") ||
    r.includes("have someone call you back") ||
    r.includes("jayson will follow up personally") ||
    r.includes("i'll pass that to jayson") ||
    (r.includes("just to confirm") && r.includes("correct"))
  );
}

function looksLikeBusinessContext(s: string): boolean {
  const r = s.toLowerCase();
  return /\b(business|company|clinic|salon|agency|trade|tradie|builder|plumber|electrician|real estate|restaurant|cafe|studio|shop|store|service|practice)\b/.test(
    r
  );
}

function looksLikeNeedContext(s: string): boolean {
  const r = s.toLowerCase();
  return /\b(enquiries|inquiries|leads|bookings|booking|website|quote|quotes|chat widget|scw|micah|reception|receptionist|notifications|customers|follow up|call back|callback|automate|automation)\b/.test(
    r
  );
}

export function micahConversationLooksLikeCapturedLead(params: {
  history: ChatTurn[];
  callerNumber: string;
  latestCallerTurn: string;
  micahReply: string;
}): boolean {
  const transcript = [
    ...params.history.map((m) => m.content),
    params.latestCallerTurn,
    params.micahReply,
  ].join("\n");
  const hasName = !!guessNameFromTranscript(transcript);
  const hasPhone =
    !!params.callerNumber || /\b(?:\+?61|0)[2-478](?:[\s().-]?\d){8,12}\b/.test(transcript);
  const hasEmail = !!extractEmailFromText(transcript);
  const hasBusiness = looksLikeBusinessContext(transcript);
  const hasNeed = looksLikeNeedContext(transcript);
  const micahIsWrapping = micahReplyLooksLikeLeadWrapUp(params.micahReply);
  const hasCallbackRequest = CALLBACK_INTENT_PATTERN.test(transcript);

  return (
    // Demo / DOS: send as soon as we can act — do not wait for perfect data
    (hasName && hasPhone) ||
    (hasPhone && hasNeed) ||
    // Classic enquiry lead: phone + (name or business) + need
    (hasPhone && (hasName || hasBusiness) && hasNeed) ||
    // Micah wrapping up and we have a phone
    (micahIsWrapping && hasPhone) ||
    // Callback lead: name + phone + email collected
    (hasName && hasPhone && hasEmail) ||
    // Callback intent with name and phone (caller ID counts as phone)
    (hasCallbackRequest && hasName && hasPhone) ||
    // Early demo lead: callback intent + Twilio caller ID (no name required yet)
    (hasCallbackRequest && hasPhone)
  );
}

/** True when we can send a minimal DOS lead email (callback + Twilio From). */
export function micahEarlyCallbackLeadReady(params: {
  callerNumber: string;
  latestCallerTurn?: string;
  history?: ChatTurn[];
}): boolean {
  const transcript = [
    ...(params.history ?? []).map((m) => m.content),
    params.latestCallerTurn ?? "",
  ].join("\n");
  const hasPhone = !!params.callerNumber?.trim();
  return hasPhone && CALLBACK_INTENT_PATTERN.test(transcript);
}

export function extractEmailFromText(s: string): string | null {
  const m = s.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return m ? m[0] : null;
}

export function guessNameFromTranscript(s: string): string | null {
  const p =
    /(?:my name is|i'm|i am|this is|it's|it is|call me)\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,4})/i;
  const m = s.match(p);
  if (m?.[1]) {
    const name = m[1].trim().replace(/[.,;:!?]+$/g, "");
    if (name.length > 2 && name.length < 80) return name;
  }
  return null;
}

function firstMatch(s: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = s.match(pattern);
    const value = match?.[1]?.trim();
    if (value && value.length >= 2 && value.length <= 180) {
      return value.replace(/[.,;:!?]+$/g, "").trim();
    }
  }
  return null;
}

function extractCallbackNumberFromTranscript(s: string): string | null {
  return firstMatch(s, [
    /\b(?:best\s+)?(?:callback|call back|phone|mobile|contact)(?:\s+number)?(?:\s+is|\s+on|:)?\s*((?:\+?61|0)[\d\s().-]{8,18})/i,
    /\b((?:\+?61|0)[2-478](?:[\s().-]?\d){8,12})\b/,
  ]);
}

function extractBusinessNameFromTranscript(s: string): string | null {
  return firstMatch(s, [
    /\b(?:business|company|firm|shop|agency|practice)(?:\s+name)?(?:\s+is|:)?\s+([A-Za-z0-9][A-Za-z0-9 &'().-]{1,80})/i,
    /\b(?:from|at|with)\s+([A-Z][A-Za-z0-9 &'().-]{1,80})/,
    /\b(?:I run|I own|we run|we own)\s+([A-Za-z0-9][A-Za-z0-9 &'().-]{1,80})/i,
  ]);
}

function extractBusinessTypeFromTranscript(s: string): string | null {
  return firstMatch(s, [
    /\b(?:we are|we're|i am|i'm)\s+(?:a|an)\s+([A-Za-z][A-Za-z\s-]{2,60})(?:\s+(?:business|company|service|agency|practice))?/i,
    /\b(?:we do|we provide|we specialise in|we specialize in|i do)\s+([A-Za-z][A-Za-z\s-]{2,80})/i,
    /\b(plumb\w*|electr\w*|build\w*|clean\w*|landscap\w*|consult\w*|account\w*|legal|medical|dental|tradie|trade|mechanic|retail\w*)\b/i,
  ]);
}

function extractNeedFromTranscript(s: string): string | null {
  return firstMatch(s, [
    /\b(?:need|want|looking for|after|interested in|would like|like)\s+(.{5,160})/i,
    /\b(?:help with|help me with)\s+(.{5,160})/i,
    /\b(ask(?:ing)? for Jayson to call back.{0,120})/i,
  ]);
}

function extractBestTimeFromTranscript(s: string): string | null {
  // Try named-time patterns first, then generic time keywords
  const named = firstMatch(s, [
    /\b(?:best time|good time|ideal time)(?: is| would be)?\s+(.{3,80})/i,
    /\b(?:call me|reach me|get me)\s+(?:at|around|after|before|between|in the)\s+(.{3,80})/i,
    /\b(?:available|free)\s+(?:in the|on|after|before|between)\s+(.{3,80})/i,
  ]);
  if (named) return named;
  // Fallback: single-word / short phrase time indicators
  const m = s.match(
    /\b(any\s*time|anytime|mornings?|afternoons?|evenings?|weekdays?|weekends?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|this week|later today|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i
  );
  return m?.[1] ?? null;
}

function extractCallbackPersonFromTranscript(s: string): string | null {
  // Who did the caller ask to call them back?
  const m = s.match(
    /\b(?:can|could|get|have|ask)\s+([A-Z][a-z]+)\s+(?:call|ring|contact)\s+(?:me|us)\b/i
  );
  if (m?.[1] && !/^(someone|you|anyone|a|the|i|me)\b/i.test(m[1])) {
    return m[1];
  }
  return null;
}

function extractLeadDetails(transcript: string): LeadDetails {
  return {
    callerName: guessNameFromTranscript(transcript),
    businessName: extractBusinessNameFromTranscript(transcript),
    businessType: extractBusinessTypeFromTranscript(transcript),
    callbackNumber: extractCallbackNumberFromTranscript(transcript),
    callerEmail: extractEmailFromText(transcript),
    bestTimeToCall: extractBestTimeFromTranscript(transcript),
    callbackPerson: extractCallbackPersonFromTranscript(transcript),
    needHelpWith: extractNeedFromTranscript(transcript),
  };
}

function formatTranscript(turns: ChatTurn[], micahReply: string): string {
  const lines = [
    ...turns
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role === "user" ? "Caller" : "Micah"}: ${m.content}`),
    micahReply.trim() ? `Micah: ${micahReply.trim()}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function getSentCallSidStateMap(): Map<string, LeadEmailSentState> {
  const key = "__micahVoiceLeadEmailSentCallSids";
  const globalStore = globalThis as typeof globalThis & Record<string, unknown>;
  if (!(globalStore[key] instanceof Map)) {
    globalStore[key] = new Map<string, LeadEmailSentState>();
  }
  return globalStore[key] as Map<string, LeadEmailSentState>;
}

function leadEmailTierAlreadySent(
  callSid: string,
  tier: MicahLeadEmailTier
): boolean {
  const state = getSentCallSidStateMap().get(callSid);
  if (!state) return false;
  return tier === "basic" ? state.basic : state.full;
}

function markLeadEmailTierSent(callSid: string, tier: MicahLeadEmailTier): void {
  const map = getSentCallSidStateMap();
  const prev = map.get(callSid) ?? { basic: false, full: false };
  if (tier === "basic") prev.basic = true;
  else prev.full = true;
  map.set(callSid, prev);
}

/**
 * Fire-and-forget early callback lead email (does not block TwiML / OpenAI / Supabase).
 */
export function scheduleEarlyCallbackLeadEmail(params: {
  callSid: string;
  callerNumber: string;
  latestCallerTurn: string;
  micahReply?: string;
  turns?: ChatTurn[];
  timeoutMs?: number;
}): void {
  if (!params.callSid?.trim() || !micahEarlyCallbackLeadReady(params)) return;

  const run = async () => {
    await sendMicahLeadSummaryEmail({
      callSid: params.callSid,
      callerNumber: params.callerNumber,
      transcriptSnippet: params.latestCallerTurn,
      micahReply: params.micahReply ?? "",
      timestamp: new Date().toISOString(),
      turns: params.turns,
      tier: "basic",
    });
  };

  const timeoutMs = params.timeoutMs ?? 5_000;
  void Promise.race([
    run(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]).catch((e) => {
    console.warn("[micah-lead-resend] early callback lead email failed", {
      micahVoiceQA: true,
      event: "voice_lead_email_early_schedule_failed",
      CallSid: params.callSid,
      error: formatResendError(e),
    });
  });
}

/**
 * Sends an immediate DOS voice lead notification when `RESEND_API_KEY` is set.
 * Uses `RESEND_FROM` when configured (required by Resend for a verified sender).
 */
export async function sendMicahLeadSummaryEmail(params: {
  callSid: string;
  callerNumber: string;
  transcriptSnippet: string;
  micahReply: string;
  timestamp?: string;
  turns?: ChatTurn[];
  /** `basic` = callback + Twilio From; `full` = richer capture / wrap-up (allowed once after basic). */
  tier?: MicahLeadEmailTier;
}): Promise<boolean> {
  const tier: MicahLeadEmailTier = params.tier ?? "full";
  const apiKey = resolveResendApiKey();
  const to = resolveLeadRecipient();
  const fromAddr = resolveResendFromAddress();

  if (!apiKey) {
    console.warn("[micah-lead-resend] Resend API key not configured - skip DOS lead email", {
      micahVoiceQA: true,
      event: "voice_lead_email_skip_no_api_key",
      CallSid: params.callSid || null,
      resendApiKeyConfigured: false,
      tier,
    });
    return false;
  }
  if (!to) {
    console.warn(
      "[micah-lead-resend] no lead recipient resolved - skip DOS lead email",
      {
        micahVoiceQA: true,
        event: "voice_lead_email_skip_no_recipient",
        CallSid: params.callSid || null,
        resendApiKeyConfigured: true,
        tier,
      }
    );
    return false;
  }

  if (params.callSid && leadEmailTierAlreadySent(params.callSid, tier)) {
    console.log("[micah-lead-resend] duplicate DOS lead email skipped", {
      micahVoiceQA: true,
      event: "voice_lead_email_duplicate_skipped",
      CallSid: params.callSid,
      tier,
      duplicateGuardState: `in_memory_${tier}_already_sent`,
    });
    return true;
  }
  const transcript = params.turns?.length
    ? formatTranscript(params.turns, params.micahReply)
    : `${params.transcriptSnippet}\nMicah: ${params.micahReply}`.trim();
  const combined = `${transcript}\n${params.micahReply}`;
  const details = extractLeadDetails(combined);
  const timestamp = params.timestamp ?? new Date().toISOString();

  const body = [
    "New Micah Voice Lead - DOS",
    "",
    "--- CALLBACK DETAILS ---",
    `Callback requested for:    ${details.callbackPerson ?? "Jayson"}`,
    `Caller name:               ${details.callerName ?? "(not clearly provided)"}`,
    `Mobile number (spoken):    ${details.callbackNumber ?? "(not clearly provided)"}`,
    `Caller phone (Twilio From):${params.callerNumber || "(unknown)"}`,
    `Email address:             ${details.callerEmail ?? "(not clearly provided)"}`,
    `Best time to call:         ${details.bestTimeToCall ?? "(not specified — any time)"}`,
    "",
    "--- BUSINESS CONTEXT ---",
    `Business name: ${details.businessName ?? "(not clearly provided)"}`,
    `Business type: ${details.businessType ?? "(not clearly provided)"}`,
    `Reason / what they need:   ${details.needHelpWith ?? "(not clearly provided — see transcript)"}`,
    "",
    "--- CALL META ---",
    `Call SID:   ${params.callSid || "(unknown)"}`,
    `Timestamp:  ${timestamp}`,
    "",
    `Recommended next action: ${DOS_NEXT_ACTION}`,
    "",
    "--- FULL TRANSCRIPT ---",
    transcript || "(No transcript captured.)",
  ].join("\n");

  console.log("[micah-lead-resend] Resend attempt", {
    micahVoiceQA: true,
    event: "voice_lead_email_resend_attempt",
    CallSid: params.callSid || null,
    tier,
    resendApiKeyConfigured: true,
    recipientMask: maskEmailAddress(to),
    fromPreview: fromAddr.replace(/<[^>]+>/, "<…>"),
    subject: DOS_LEAD_SUBJECT,
    duplicateGuardState:
      params.callSid && leadEmailTierAlreadySent(params.callSid, tier)
        ? "blocked"
        : "clear",
  });

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: fromAddr,
      to,
      subject: DOS_LEAD_SUBJECT,
      text: body,
    });
    if (error) {
      console.warn("[micah-lead-resend] Resend API error", {
        micahVoiceQA: true,
        event: "voice_lead_email_resend_error",
        CallSid: params.callSid || null,
        tier,
        recipientMask: maskEmailAddress(to),
        fromPreview: fromAddr.replace(/<[^>]+>/, "<…>"),
        resendApiKeyConfigured: true,
        resendSuccess: false,
        error: formatResendError(error),
      });
      return false;
    }
    console.log("[micah-lead-resend] Resend sent", {
      micahVoiceQA: true,
      event: "voice_lead_email_resend_ok",
      CallSid: params.callSid || null,
      tier,
      recipientMask: maskEmailAddress(to),
      fromPreview: fromAddr.replace(/<[^>]+>/, "<…>"),
      resendApiKeyConfigured: true,
      resendSuccess: true,
      resendId: data?.id ?? null,
    });
    if (params.callSid) {
      markLeadEmailTierSent(params.callSid, tier);
      if (tier === "full") {
        markLeadEmailTierSent(params.callSid, "basic");
      }
    }
    return true;
  } catch (e) {
    console.warn("[micah-lead-resend] Resend send threw", {
      micahVoiceQA: true,
      event: "voice_lead_email_resend_throw",
      CallSid: params.callSid || null,
      tier,
      recipientMask: maskEmailAddress(to),
      fromPreview: fromAddr.replace(/<[^>]+>/, "<…>"),
      resendApiKeyConfigured: true,
      resendSuccess: false,
      error: formatResendError(e),
    });
    return false;
  }
}
