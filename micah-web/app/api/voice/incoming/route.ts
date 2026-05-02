/**
 * Twilio Voice webhook — inbound TwiML for Record/Gather follow-ups.
 * Assistant audio uses OpenAI Speech (`cedar`, speed 1.0) in `/api/voice/process`
 * when `SUPABASE_TTS_BUCKET` is configured; otherwise Polly `<Say>` fallback.
 */
import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { getTenantIdByInboundNumber } from "@/lib/micah/tenant-config";
import { buildPublicBaseUrl } from "@/lib/micah-prompt";
import { escapeXml } from "@/lib/twiml";

export const maxDuration = 30;

function twimlGather(action: string): string {
  const greeting =
    "Hi, this is Micah — Western Sydney industrial and commercial property. " +
    "In a sentence or two, what are you looking for?";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Nicole" language="en-AU">${escapeXml(greeting)}</Say>
  <Gather
    input="speech"
    timeout="10"
    speechTimeout="auto"
    action="${escapeXml(action)}"
    method="POST"
    language="en-AU"
  >
    <Say voice="Polly.Nicole" language="en-AU">Go ahead whenever you're ready.</Say>
  </Gather>
  <Say voice="Polly.Nicole" language="en-AU">I didn't catch that. Goodbye.</Say>
  <Hangup/>
</Response>`;
}

function twimlRecord(action: string): string {
  const greeting =
    "Hi, this is Micah — Western Sydney industrial and commercial property. " +
    "After the tone, tell me in a sentence what you're looking for.";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Nicole" language="en-AU">${escapeXml(greeting)}</Say>
  <Record
    timeout="10"
    maxLength="120"
    playBeep="true"
    action="${escapeXml(action)}"
    method="POST"
    trim="trim-silence"
  />
  <Say voice="Polly.Nicole" language="en-AU">I didn't get a recording. Goodbye.</Say>
  <Hangup/>
</Response>`;
}

/**
 * Twilio Voice webhook (e.g. "A call comes in" → POST this URL).
 *
 * - `MICAH_TWIML_MODE=gather` → `<Gather speech>` (Twilio transcript only; no OpenAI STT).
 * - `MICAH_TWIML_MODE=record` or unset → `<Record>` + OpenAI transcription from `RecordingUrl`.
 */
export async function POST(req: Request): Promise<Response> {
  const base = buildPublicBaseUrl(req);
  let tenantQuery = "";
  try {
    const form = await req.formData();
    const to = form.get("To");
    if (typeof to === "string" && to.length > 0) {
      const supabase = getServiceSupabase();
      const id = await getTenantIdByInboundNumber(supabase, to);
      if (id) {
        tenantQuery = `?tenant_id=${encodeURIComponent(id)}`;
      }
    }
  } catch (e) {
    console.error("incoming / tenant lookup:", e);
  }

  const action = `${base}/api/voice/process${tenantQuery}`;
  const mode = (process.env.MICAH_TWIML_MODE ?? "record").toLowerCase();
  const twiml = mode === "gather" ? twimlGather(action) : twimlRecord(action);

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
