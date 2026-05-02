import type { SupabaseClient } from "@supabase/supabase-js";

export type ChatTurn = { role: "user" | "assistant" | "system"; content: string };

const TABLE = "leads";

/**
 * Persists conversation history in `leads` using call_sid (expects a text column
 * `call_sid` and json/jsonb `conversation` or falls back to `metadata`).
 */
export async function loadHistory(
  supabase: SupabaseClient,
  callSid: string
): Promise<ChatTurn[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("metadata")
    .eq("call_sid", callSid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return [];

  const raw = (data as { metadata?: { messages?: ChatTurn[] } }).metadata?.messages;

  if (Array.isArray(raw)) {
    return raw.filter(
      (m): m is ChatTurn =>
        m &&
        typeof m === "object" &&
        (m as ChatTurn).role !== undefined &&
        typeof (m as ChatTurn).content === "string"
    );
  }
  return [];
}

export async function saveTurnToLead(
  supabase: SupabaseClient,
  params: {
    callSid: string;
    callerId: string;
    userText: string;
    assistantText: string;
    history: ChatTurn[];
    tenantId?: string | null;
    openaiVoice?: string | null;
  }
): Promise<void> {
  const { callSid, callerId, userText, assistantText, history, tenantId, openaiVoice } =
    params;

  const messages: ChatTurn[] = [
    ...history.filter((m) => m.role !== "system"),
    { role: "user", content: userText },
    { role: "assistant", content: assistantText },
  ];

  const snippet = `User: ${userText}\nAssistant: ${assistantText}`;

  const payload = {
    call_sid: callSid,
    phone: callerId,
    tenant_id: tenantId ?? null,
    metadata: {
      source: "twilio_voice_turn",
      messages,
      tenant_id: tenantId ?? undefined,
      openai_voice: openaiVoice ?? undefined,
    },
    notes: snippet,
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await supabase
    .from(TABLE)
    .select("id")
    .eq("call_sid", callSid)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from(TABLE)
      .update({
        phone: callerId,
        tenant_id: payload.tenant_id,
        metadata: payload.metadata,
        notes: snippet,
        updated_at: payload.updated_at,
      })
      .eq("id", existing.id);
    if (error) console.error("Supabase update leads:", error.message);
  } else {
    const { error } = await supabase.from(TABLE).insert({
      ...payload,
      created_at: payload.updated_at,
    });
    if (error) console.error("Supabase insert leads:", error.message);
  }
}
