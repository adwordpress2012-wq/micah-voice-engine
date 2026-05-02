import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { getTenantVoiceConfig } from "@/lib/micah/tenant-config";
import { sendCallSummaryEmail } from "@/lib/send-call-summary-email";
import type { ChatTurn } from "@/lib/voice-session";

export const maxDuration = 60;

type LeadMetadata = {
  messages?: ChatTurn[];
  summary_email_sent?: boolean;
  tenant_id?: string;
};

/**
 * Twilio **Status Callback** (configure on the phone number: Call status → completed).
 * Sends one Resend email to `tenants.notification_email` when the call ends.
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

  if (status !== "completed" || typeof callSid !== "string") {
    return new NextResponse(null, { status: 204 });
  }

  const supabase = getServiceSupabase();

  const { data: rows, error: leadErr } = await supabase
    .from("leads")
    .select("metadata, tenant_id")
    .eq("call_sid", callSid)
    .order("created_at", { ascending: false })
    .limit(1);

  if (leadErr) {
    console.error("call-status lead fetch:", leadErr.message);
    return new NextResponse(null, { status: 204 });
  }

  const lead = rows?.[0];
  const meta = (lead?.metadata ?? null) as LeadMetadata | null;
  if (meta?.summary_email_sent) {
    return new NextResponse(null, { status: 204 });
  }

  const tenantId =
    (lead as { tenant_id?: string } | null)?.tenant_id ?? meta?.tenant_id ?? null;
  if (!tenantId) {
    return new NextResponse(null, { status: 204 });
  }

  const tenant = await getTenantVoiceConfig(supabase, tenantId);
  const to = tenant?.notification_email;
  if (!to) {
    return new NextResponse(null, { status: 204 });
  }

  const messages: ChatTurn[] =
    meta && Array.isArray(meta.messages) ? (meta.messages as ChatTurn[]) : [];

  const result = await sendCallSummaryEmail({
    to,
    callSid,
    from: typeof from === "string" ? from : undefined,
    messages,
  });

  if (result.ok) {
    const nextMeta: LeadMetadata = {
      ...(meta ?? {}),
      summary_email_sent: true,
    };
    await supabase.from("leads").update({ metadata: nextMeta }).eq("call_sid", callSid);
  }

  return new NextResponse(null, { status: 204 });
}
