import { Resend } from "resend";
import type { ChatTurn } from "@/lib/voice-session";

const LEADS_INBOX = "leads@directiveos.com.au";

/** Heuristic: Micah appears to have finished confirming details / closing warmly. */
export function micahReplyLooksLikeLeadWrapUp(reply: string): boolean {
  const r = reply.toLowerCase();
  return (
    r.includes("wonderful day") ||
    r.includes("lovely chatting") ||
    r.includes("call you back shortly") ||
    r.includes("have someone call you back") ||
    (r.includes("just to confirm") && r.includes("correct"))
  );
}

function looksLikeBusinessContext(s: string): boolean {
  const r = s.toLowerCase();
  return /\b(business|company|clinic|salon|agency|trade|tradie|builder|plumber|electrician|real estate|restaurant|cafe|studio|shop|store|service)\b/.test(
    r
  );
}

function looksLikeNeedContext(s: string): boolean {
  const r = s.toLowerCase();
  return /\b(enquiries|inquiries|leads|bookings|booking|website|quote|quotes|chat widget|scw|micah|reception|receptionist|notifications|customers|follow up|automate|automation)\b/.test(
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
    !!params.callerNumber || /\b(?:\+?61|0)[2-478](?:[\s-]?\d){8}\b/.test(transcript);
  const hasBusiness = looksLikeBusinessContext(transcript);
  const hasNeed = looksLikeNeedContext(transcript);
  const micahIsWrapping =
    micahReplyLooksLikeLeadWrapUp(params.micahReply) ||
    params.micahReply.toLowerCase().includes("jayson will follow up personally");

  return micahIsWrapping && hasPhone && (hasName || hasBusiness) && hasNeed;
}

function extractEmailFromText(s: string): string | null {
  const m = s.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return m ? m[0] : null;
}

function guessNameFromTranscript(s: string): string | null {
  const p =
    /(?:my name is|i'm|i am|this is|it's|it is|call me)\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,4})/i;
  const m = s.match(p);
  if (m?.[1]) {
    const name = m[1].trim();
    if (name.length > 2 && name.length < 80) return name;
  }
  return null;
}

function briefChatSummary(callerTurn: string, micahReply: string, maxChars = 1200): string {
  const a = callerTurn.trim().slice(0, 600);
  const b = micahReply.trim().slice(0, 600);
  const combined = `Caller (last turn): ${a}\n\nMicah: ${b}`;
  return combined.length > maxChars ? combined.slice(0, maxChars) + "…" : combined;
}

/**
 * Sends a lead summary to `leads@directiveos.com.au` when `RESEND_API_KEY` is set.
 * Uses `RESEND_FROM` when configured (required by Resend for a verified sender).
 */
export async function sendMicahLeadSummaryEmail(params: {
  callSid: string;
  callerNumber: string;
  transcriptSnippet: string;
  micahReply: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[micah-lead-resend] RESEND_API_KEY unset — skip lead summary email");
    return false;
  }

  const fromAddr =
    process.env.RESEND_FROM?.trim() ?? "Micah <onboarding@resend.dev>";
  const combined = `${params.transcriptSnippet}\n${params.micahReply}`;
  const email = extractEmailFromText(combined);
  const name =
    guessNameFromTranscript(params.transcriptSnippet) ??
    guessNameFromTranscript(params.micahReply);

  const summary = briefChatSummary(params.transcriptSnippet, params.micahReply);

  const body = [
    "Micah voice — lead summary (wrap-up detected)",
    "",
    `Name: ${name ?? "(not clearly stated — see summary below)"}`,
    `Number: ${params.callerNumber || "(unknown)"}`,
    `Email: ${email ?? "(not clearly stated — see summary below)"}`,
    "",
    "Brief summary:",
    summary,
    "",
    params.callSid ? `CallSid: ${params.callSid}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  try {
    const resend = new Resend(apiKey);
    const notifyCc = process.env.MICAH_VOICE_NOTIFY_EMAIL?.trim();
    const to = notifyCc ? [LEADS_INBOX, notifyCc] : [LEADS_INBOX];
    await resend.emails.send({
      from: fromAddr,
      to,
      subject: `Micah lead — ${params.callerNumber || params.callSid || "voice call"}`,
      text: body,
    });
    return true;
  } catch (e) {
    console.warn("[micah-lead-resend] Resend send failed:", e);
    return false;
  }
}
