import { Resend } from "resend";
import type { ChatTurn } from "@/lib/voice-session";

const DOS_LEAD_SUBJECT = "New Micah Voice Lead - DOS";
const DOS_NEXT_ACTION = "Jayson to follow up personally.";

type LeadDetails = {
  callerName: string | null;
  businessName: string | null;
  businessType: string | null;
  callbackNumber: string | null;
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
  const hasBusiness = looksLikeBusinessContext(transcript);
  const hasNeed = looksLikeNeedContext(transcript);
  const micahIsWrapping = micahReplyLooksLikeLeadWrapUp(params.micahReply);

  return (hasPhone && (hasName || hasBusiness) && hasNeed) || (micahIsWrapping && hasPhone);
}

function extractEmailFromText(s: string): string | null {
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

function resolveLeadRecipient(): string | null {
  return (
    process.env.MICAH_VOICE_NOTIFY_EMAIL?.trim() ||
    process.env.MICAH_TRANSCRIPT_DEFAULT_TO?.trim() ||
    null
  );
}

function extractLeadDetails(transcript: string): LeadDetails {
  return {
    callerName: guessNameFromTranscript(transcript),
    businessName: extractBusinessNameFromTranscript(transcript),
    businessType: extractBusinessTypeFromTranscript(transcript),
    callbackNumber: extractCallbackNumberFromTranscript(transcript),
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

function getSentCallSidSet(): Set<string> {
  const key = "__micahVoiceLeadEmailSentCallSids";
  const globalStore = globalThis as typeof globalThis & Record<string, unknown>;
  if (!(globalStore[key] instanceof Set)) {
    globalStore[key] = new Set<string>();
  }
  return globalStore[key] as Set<string>;
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
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[micah-lead-resend] RESEND_API_KEY unset - skip DOS lead email");
    return false;
  }
  const to = resolveLeadRecipient();
  if (!to) {
    console.warn(
      "[micah-lead-resend] MICAH_VOICE_NOTIFY_EMAIL and MICAH_TRANSCRIPT_DEFAULT_TO unset - skip DOS lead email"
    );
    return false;
  }
  const sentCallSids = getSentCallSidSet();
  if (params.callSid && sentCallSids.has(params.callSid)) {
    console.log("[micah-lead-resend] duplicate DOS lead email skipped", {
      CallSid: params.callSid,
    });
    return true;
  }

  const fromAddr = process.env.RESEND_FROM?.trim() ?? "Micah <onboarding@resend.dev>";
  const transcript = params.turns?.length
    ? formatTranscript(params.turns, params.micahReply)
    : `${params.transcriptSnippet}\nMicah: ${params.micahReply}`.trim();
  const combined = `${transcript}\n${params.micahReply}`;
  const email = extractEmailFromText(combined);
  const details = extractLeadDetails(combined);
  const timestamp = params.timestamp ?? new Date().toISOString();

  const body = [
    "New Micah Voice Lead - DOS",
    "",
    `Caller phone from Twilio From: ${params.callerNumber || "(unknown)"}`,
    `Best callback number provided by caller: ${
      details.callbackNumber ?? "(not clearly provided - use Twilio From if appropriate)"
    }`,
    `Caller name: ${details.callerName ?? "(not clearly provided)"}`,
    `Business name: ${details.businessName ?? "(not clearly provided)"}`,
    `Business type: ${details.businessType ?? "(not clearly provided)"}`,
    `What they need help with: ${details.needHelpWith ?? "(not clearly provided - see transcript)"}`,
    email ? `Email mentioned by caller: ${email}` : "",
    "",
    `Call SID: ${params.callSid || "(unknown)"}`,
    `Timestamp: ${timestamp}`,
    "",
    `Recommended next action: ${DOS_NEXT_ACTION}`,
    "",
    "Full transcript / call history:",
    transcript || "(No transcript captured.)",
  ]
    .filter((line) => line !== "")
    .join("\n");

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: fromAddr,
      to,
      subject: DOS_LEAD_SUBJECT,
      text: body,
    });
    if (params.callSid) {
      sentCallSids.add(params.callSid);
    }
    return true;
  } catch (e) {
    console.warn("[micah-lead-resend] Resend send failed:", e);
    return false;
  }
}
