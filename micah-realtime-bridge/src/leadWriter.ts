import OpenAI from "openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getSupabase(): SupabaseClient | null {
  const url =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Normalise transcript to English for `leads.raw_text`. */
export async function translateToEnglishIfNeeded(
  openai: OpenAI,
  text: string
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    const r = await openai.chat.completions.create({
      model: process.env.OPENAI_TRANSLATE_MODEL ?? "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Translate the user's message into clear English. If it is already English, return it unchanged. Output only the translated text — no preamble or quotes.",
        },
        { role: "user", content: trimmed },
      ],
      max_tokens: 4000,
      temperature: 0.2,
    });
    return r.choices[0]?.message?.content?.trim() || trimmed;
  } catch (e) {
    console.warn("[leadWriter] translate skipped:", e);
    return trimmed;
  }
}

export async function saveLeadFromCall(params: {
  transcriptOriginal: string;
  callSid: string;
  from?: string;
  to?: string;
}): Promise<void> {
  const supabase = getSupabase();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!supabase) {
    console.warn("[leadWriter] Supabase not configured — skip leads insert");
    return;
  }
  if (!apiKey) {
    console.warn("[leadWriter] OPENAI_API_KEY missing — saving raw transcript only");
  }

  let rawEnglish = params.transcriptOriginal.trim();
  if (apiKey && rawEnglish) {
    const openai = new OpenAI({ apiKey, timeout: 60_000 });
    rawEnglish = await translateToEnglishIfNeeded(openai, rawEnglish);
  }

  try {
    const row: Record<string, unknown> = {
      raw_text: rawEnglish.slice(0, 12000),
      call_sid: params.callSid,
      phone: params.from ?? null,
      metadata: {
        source: "openai_realtime_voice",
        transcript_original: params.transcriptOriginal.slice(0, 12000),
        to_number: params.to ?? null,
      },
      created_at: new Date().toISOString(),
    };
    await supabase.from("leads").insert(row);
    console.log("[leadWriter] leads insert ok", params.callSid);
  } catch (e) {
    console.warn("[leadWriter] leads insert failed:", e);
  }
}
