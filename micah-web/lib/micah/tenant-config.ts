import type { SupabaseClient } from "@supabase/supabase-js";

/** Twilio `To` vs DB `inbound_number` often differ only by `+` or spacing — try several forms. */
export function inboundDidLookupVariants(raw: string): string[] {
  const s = raw.trim();
  const out = new Set<string>();
  if (s) out.add(s);
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 8) {
    out.add(digits);
    out.add(`+${digits}`);
    if (digits.startsWith("0") && digits.length >= 9) {
      out.add(`+61${digits.slice(1)}`);
      out.add(`61${digits.slice(1)}`);
    }
    if (digits.startsWith("04") && digits.length === 10) {
      out.add(`+61${digits.slice(1)}`);
      out.add(`61${digits.slice(1)}`);
    }
  }
  return [...out];
}

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
  const variants = inboundDidLookupVariants(didE164);
  console.log("[micah/debug] inbound lookup variants:", variants);

  let lastError: string | null = null;
  for (const v of variants) {
    const { data, error } = await supabase
      .from("tenants")
      .select(
        "id, agency_name, principal_name, micah_persona, openai_voice, notification_email"
      )
      .eq(column, v)
      .maybeSingle();

    if (error) {
      lastError = error.message;
      continue;
    }
    const row = mapTenantRow(data as Record<string, unknown> | null);
    if (row) {
      console.log(`[micah/debug] tenant matched inbound using ${column}=${v}`);
      return row;
    }
  }

  if (lastError) {
    console.error("getTenantVoiceConfigByInboundDid:", lastError);
  }
  console.log("[micah/debug] Tenant Lookup Failed");
  return null;
}

/** Returns only tenant id (same inbound lookup as {@link getTenantVoiceConfigByInboundDid}). */
export async function getTenantIdByInboundNumber(
  supabase: SupabaseClient,
  didE164: string
): Promise<string | null> {
  const row = await getTenantVoiceConfigByInboundDid(supabase, didE164);
  return row?.tenant_id ?? null;
}
