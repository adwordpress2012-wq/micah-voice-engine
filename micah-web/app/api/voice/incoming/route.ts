/**
 * Twilio Voice webhook — conversational loop via `<Gather speech>` → `/api/voice/process`.
 * Cedar TTS (`cedar` @ 1.0×) is applied in `/api/voice/process` when `SUPABASE_TTS_BUCKET` is set.
 */
import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { micahSayLine } from "@/lib/micah/twilio-voice";
import { getTenantIdByInboundNumber } from "@/lib/micah/tenant-config";
import { buildPublicBaseUrl } from "@/lib/micah-prompt";
import { escapeXml } from "@/lib/twiml";

export const maxDuration = 30;

/** Conversational turn: Say → Gather speech → same webhook on reply (loops until silence timeout). */
function twimlGather(action: string): string {
  const greeting =
    "Hey there! I'm Micah — super glad you called. What's going on, and how can I help?";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${micahSayLine(greeting)}
  <Gather
    input="speech"
    timeout="15"
    speechTimeout="auto"
    action="${escapeXml(action)}"
    method="POST"
    language="en-AU"
  >
    ${micahSayLine("I'm all ears — go ahead.")}
  </Gather>
  ${micahSayLine("I'll hang up for now — feel free to call back anytime. Bye!")}
  <Hangup/>
</Response>`;
}

/** Optional: raw recording + OpenAI Whisper when MICAH_TWIML_MODE=record. */
function twimlRecord(action: string): string {
  const greeting =
    "Hey! I'm Micah — After the tone, tell me what you need and I'll jump on it.";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${micahSayLine(greeting)}
  <Record
    timeout="10"
    maxLength="120"
    playBeep="false"
    action="${escapeXml(action)}"
    method="POST"
    trim="trim-silence"
  />
  ${micahSayLine("I didn't get anything — try calling again soon. Bye!")}
  <Hangup/>
</Response>`;
}

/**
 * Default: `gather` — continuous speech conversation with Twilio STT → GPT → Cedar/Polly reply → Gather again.
 * Set MICAH_TWIML_MODE=record only if you need Whisper on recordings instead.
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
  const mode = (process.env.MICAH_TWIML_MODE ?? "gather").toLowerCase();
  const twiml = mode === "record" ? twimlRecord(action) : twimlGather(action);

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
