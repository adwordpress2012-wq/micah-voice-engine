import { Resend } from "resend";

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
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[micah-lead-resend] RESEND_API_KEY unset — skip lead summary email");
    return;
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
  } catch (e) {
    console.warn("[micah-lead-resend] Resend send failed:", e);
  }
}
