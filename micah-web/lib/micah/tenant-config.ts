import type { SupabaseClient } from "@supabase/supabase-js";

export type TenantVoiceConfig = {
  tenant_id: string;
  agency_name: string | null;
  principal_name: string | null;
  micah_persona: string;
  openai_voice: string | null;
  notification_email: string | null;
};

function mapTenantRow(data: Record<string, unknown> | null): TenantVoiceConfig | null {
  if (!data || typeof data.id !== "string") return null;

  const persona =
    typeof data.micah_persona === "string" ? data.micah_persona.trim() : "";

  return {
    tenant_id: data.id,
    agency_name:
      typeof data.agency_name === "string"
        ? data.agency_name.trim() || null
        : null,
    principal_name:
      typeof data.principal_name === "string"
        ? data.principal_name.trim() || null
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
 * Loads agency name, Micah persona, etc. from `tenants` by primary key (Command Centre Portal).
 */
export async function getTenantVoiceConfig(
  supabase: SupabaseClient,
  tenantId: string
): Promise<TenantVoiceConfig | null> {
  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, agency_name, principal_name, micah_persona, openai_voice, notification_email"
    )
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    console.error("getTenantVoiceConfig:", error.message);
    console.log("[micah/debug] Tenant Lookup Failed");
    return null;
  }
  const row = mapTenantRow(data as Record<string, unknown> | null);
  if (!row) {
    console.log("[micah/debug] Tenant Lookup Failed");
  }
  return row;
}

/**
 * Resolve tenant + persona fields by inbound DID (`To` on Twilio webhook).
 * Column defaults to `inbound_number` (E.164); override with `TENANT_INBOUND_COLUMN`.
 */
export async function getTenantVoiceConfigByInboundDid(
  supabase: SupabaseClient,
  didE164: string
): Promise<TenantVoiceConfig | null> {
  const column = process.env.TENANT_INBOUND_COLUMN ?? "inbound_number";
  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, agency_name, principal_name, micah_persona, openai_voice, notification_email"
    )
    .eq(column, didE164)
    .maybeSingle();

  if (error) {
    console.error("getTenantVoiceConfigByInboundDid:", error.message);
    console.log("[micah/debug] Tenant Lookup Failed");
    return null;
  }
  const row = mapTenantRow(data as Record<string, unknown> | null);
  if (!row) {
    console.log("[micah/debug] Tenant Lookup Failed");
  }
  return row;
}

/** Returns only tenant id (same inbound lookup as {@link getTenantVoiceConfigByInboundDid}). */
export async function getTenantIdByInboundNumber(
  supabase: SupabaseClient,
  didE164: string
): Promise<string | null> {
  const row = await getTenantVoiceConfigByInboundDid(supabase, didE164);
  return row?.tenant_id ?? null;
}
