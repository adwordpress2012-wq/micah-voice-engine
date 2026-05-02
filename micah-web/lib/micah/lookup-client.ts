import type { SupabaseClient } from "@supabase/supabase-js";
import { inboundDidLookupVariants } from "@/lib/micah/tenant-config";

export type MicahClientRow = {
  id: string;
  agency_name: string;
  twilio_number: string;
  email: string;
  domain: string | null;
};

/** Resolve `clients.twilio_number` from Twilio `To` (tries E.164 variants). */
export async function lookupClientByTwilioTo(
  supabase: SupabaseClient,
  to: string
): Promise<MicahClientRow | null> {
  const variants = inboundDidLookupVariants(to);
  for (const v of variants) {
    const { data, error } = await supabase
      .from("clients")
      .select("id, agency_name, twilio_number, email, domain")
      .eq("twilio_number", v)
      .maybeSingle();

    if (error) {
      console.error("[micah/clients] lookup:", error.message);
      continue;
    }
    if (data && typeof (data as MicahClientRow).id === "string") {
      return data as MicahClientRow;
    }
  }
  return null;
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s.trim()
  );
}
