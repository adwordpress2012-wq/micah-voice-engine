import type { SupabaseClient } from "@supabase/supabase-js";

export type TenantVoiceConfig = {
  tenant_id: string;
  agency_name: string | null;
  principal_name: string | null;
  micah_persona: string;
  openai_voice: string | null;
  notification_email: string | null;
};

/**
 * Loads Micah persona, voice label, and notification email for a tenant row.
 */
export async function getTenantVoiceConfig(
  supabase: SupabaseClient,
  tenantId: string
): Promise<TenantVoiceConfig | null> {
  const { data, error } = await supabase
    .from("tenants")
    .select("id, agency_name, principal_name, micah_persona, openai_voice, notification_email")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    console.error("getTenantVoiceConfig:", error.message);
    return null;
  }
  if (!data?.id) return null;

  const persona =
    typeof data.micah_persona === "string" ? data.micah_persona.trim() : "";

  return {
    tenant_id: data.id as string,
    agency_name:
      typeof (data as { agency_name?: unknown }).agency_name === "string"
        ? ((data as { agency_name: string }).agency_name ?? "").trim() || null
        : null,
    principal_name:
      typeof (data as { principal_name?: unknown }).principal_name === "string"
        ? ((data as { principal_name: string }).principal_name ?? "").trim() || null
        : null,
    micah_persona: persona,
    openai_voice:
      typeof data.openai_voice === "string" && data.openai_voice.trim()
        ? data.openai_voice.trim()
        : null,
    notification_email:
      typeof data.notification_email === "string" && data.notification_email.trim()
        ? data.notification_email.trim()
        : null,
  };
}

/**
 * Looks up which tenant owns an inbound Twilio number (`To` on the webhook).
 * Uses `inbound_number` (E.164). Override column via TENANT_INBOUND_COLUMN.
 */
export async function getTenantIdByInboundNumber(
  supabase: SupabaseClient,
  didE164: string
): Promise<string | null> {
  const column = process.env.TENANT_INBOUND_COLUMN ?? "inbound_number";
  const { data, error } = await supabase
    .from("tenants")
    .select("id")
    .eq(column, didE164)
    .maybeSingle();

  if (error) {
    console.error("getTenantIdByInboundNumber:", error.message);
    return null;
  }
  return (data?.id as string) ?? null;
}
