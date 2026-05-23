import { Resend } from "resend";
import type { ChatTurn } from "@/lib/voice-session";
import {
  resolveResendApiKey,
  resolveResendFromAddress,
} from "@/lib/micah/resend-config";

export async function sendCallSummaryEmail(params: {
  to: string;
  callSid: string;
  from?: string;
  tenantLabel?: string;
  messages: ChatTurn[];
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = resolveResendApiKey();
  const fromAddress = resolveResendFromAddress();
  if (!apiKey || !fromAddress) {
    console.warn("sendCallSummaryEmail: missing RESEND_API_KEY or RESEND_FROM");
    return { ok: false, error: "Resend not configured" };
  }

  const resend = new Resend(apiKey);
  const lines = params.messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "Caller" : "Micah"}: ${m.content}`);

  const bodyText =
    lines.join("\n\n") || "(No transcript captured.)";

  const subject = `${params.tenantLabel ? `[${params.tenantLabel}] ` : ""}Call summary — ${params.callSid}`;

  try {
    const { error } = await resend.emails.send({
      from: fromAddress,
      to: params.to,
      subject,
      text: [
        `Call SID: ${params.callSid}`,
        params.from ? `From: ${params.from}` : null,
        "",
        bodyText,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    if (error) {
      console.error("Resend error:", error);
      return { ok: false, error: String(error) };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("sendCallSummaryEmail:", msg);
    return { ok: false, error: msg };
  }
}
