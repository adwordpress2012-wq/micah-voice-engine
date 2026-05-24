import { NextResponse } from "next/server";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";
import { getTenantVoiceConfig } from "@/lib/micah/tenant-config";
import { sendCallSummaryEmail } from "@/lib/send-call-summary-email";
import { postCallSummaryToCommandCentre } from "@/lib/command-centre";
import { isValidTwilioVoiceWebhook } from "@/lib/micah/twilio-webhook-auth";
import { clearMicahCallbackCallSession } from "@/lib/micah/callback-call-session";
import type { ChatTurn } from "@/lib/voice-session";

export const maxDuration = 60;

type LeadMetadata = {
  messages?: ChatTurn[];
  summary_email_sent?: boolean;
  command_centre_sent?: boolean;
  tenant_id?: string;
};

/**
 * Twilio **Status Callback** (configure on the phone number: Call status → completed).
 * Sends one Resend email to the tenant/default lead inbox and optionally posts
 * the same summary to Command Centre when `COMMAND_CENTRE_WEBHOOK_URL` is set.
 */
export async function POST(req: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const status = form.get("CallStatus");
  const callSid = form.get("CallSid");
  const from = form.get("From");
  const toNumber = form.get("To");

  if (status !== "completed" || typeof callSid !== "string") {
    return new NextResponse(null, { status: 204 });
  }

  if (!isValidTwilioVoiceWebhook(req, form)) {
    console.warn("[micah/voice/call-status] invalid Twilio signature");
    return new NextResponse(null, { status: 403 });
  }

  clearMicahCallbackCallSession(callSid);
  console.warn("[micah/voice/call-status] callback session cleared", {
    micahVoiceQA: true,
    event: "voice_call_status_callback_session_cleared",
    CallSid: callSid,
  });

  const supabase = getServiceSupabaseOrNull();
  if (!supabase) {
    console.warn("[micah/voice/call-status] Supabase not configured — skip email");
    return new NextResponse(null, { status: 204 });
  }

  const { data: rows, error: leadErr } = await supabase
    .from("leads")
    .select("id, metadata, tenant_id")
    .eq("call_sid", callSid)
    .order("created_at", { ascending: false })
    .limit(1);

  if (leadErr) {
    console.error("call-status lead fetch:", leadErr.message);
    return new NextResponse(null, { status: 204 });
  }

  const lead = rows?.[0];
  const meta = (lead?.metadata ?? null) as LeadMetadata | null;
  if (meta?.summary_email_sent && meta?.command_centre_sent) {
    return new NextResponse(null, { status: 204 });
  }

  const tenantId =
    (lead as { tenant_id?: string } | null)?.tenant_id ?? meta?.tenant_id ?? null;

  const tenant = tenantId ? await getTenantVoiceConfig(supabase, tenantId) : null;
  const notifyTo =
    tenant?.notification_email?.trim() ||
    process.env.MICAH_VOICE_NOTIFY_EMAIL?.trim() ||
    process.env.MICAH_TRANSCRIPT_DEFAULT_TO?.trim() ||
    "leads@directiveos.com.au";

  const messages: ChatTurn[] =
    meta && Array.isArray(meta.messages) ? (meta.messages as ChatTurn[]) : [];

  const [emailResult, commandCentreResult] = await Promise.all([
    meta?.summary_email_sent
      ? Promise.resolve({ ok: true })
      : sendCallSummaryEmail({
          to: notifyTo,
          callSid,
          from: typeof from === "string" ? from : undefined,
          tenantLabel: tenant?.agency_name ?? undefined,
          messages,
        }),
    meta?.command_centre_sent
      ? Promise.resolve({ ok: true, skipped: false })
      : postCallSummaryToCommandCentre({
          callSid,
          from: typeof from === "string" ? from : undefined,
          to: typeof toNumber === "string" ? toNumber : undefined,
          tenantId,
          leadId:
            typeof (lead as { id?: unknown } | null)?.id === "string"
              ? (lead as { id: string }).id
              : null,
          messages,
          endedAt: new Date().toISOString(),
        }),
  ]);

  if (emailResult.ok || commandCentreResult.ok) {
    const nextMeta: LeadMetadata = {
      ...(meta ?? {}),
      summary_email_sent: emailResult.ok ? true : meta?.summary_email_sent,
      command_centre_sent: commandCentreResult.ok && !commandCentreResult.skipped
        ? true
        : meta?.command_centre_sent,
    };
    await supabase.from("leads").update({ metadata: nextMeta }).eq("call_sid", callSid);
  }

  return new NextResponse(null, { status: 204 });
}
