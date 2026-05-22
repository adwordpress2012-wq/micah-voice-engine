import type { ChatTurn } from "@/lib/voice-session";

export async function postCallSummaryToCommandCentre(params: {
  callSid: string;
  from?: string;
  to?: string;
  tenantId?: string | null;
  leadId?: string | null;
  messages: ChatTurn[];
  endedAt: string;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const url = process.env.COMMAND_CENTRE_WEBHOOK_URL?.trim();
  if (!url) return { ok: true, skipped: true };

  const secret = process.env.COMMAND_CENTRE_WEBHOOK_SECRET?.trim();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({
        source: "micah-web",
        callSid: params.callSid,
        from: params.from ?? null,
        to: params.to ?? null,
        tenantId: params.tenantId ?? null,
        leadId: params.leadId ?? null,
        messages: params.messages,
        endedAt: params.endedAt,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const error = `Command Centre webhook HTTP ${res.status}: ${text.slice(0, 400)}`;
      console.error("[command-centre]", error);
      return { ok: false, error };
    }
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[command-centre] webhook error:", error);
    return { ok: false, error };
  }
}
