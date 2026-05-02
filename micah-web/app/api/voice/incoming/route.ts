/**
 * Twilio Voice webhook — conversational loop via `<Gather speech>` → `/api/voice/process`.
 * Incoming never requires OpenAI/Supabase for TwiML; `/process` validates keys and returns spoken errors as 200.
 */
import { plainErrorTwiML, twimlResponse } from "@/lib/micah/twiml-fallback";
import { getServiceSupabaseOrNull } from "@/lib/supabase-server";
import { micahSayLine } from "@/lib/micah/twilio-voice";
import { getTenantVoiceConfigByInboundDid } from "@/lib/micah/tenant-config";
import { safeBuildPublicBaseUrl } from "@/lib/micah-prompt";
import { escapeXml } from "@/lib/twiml";

export const maxDuration = 30;
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/** When no `tenants` row matches inbound DID — keeps caller on the line with a generic Syla greeting (200 OK). */
function twimlGatherFallback(action: string): string {
  const greeting =
    "Hi — you've reached Directive OS. I'm Micah. How can I help you today?";

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
    ${micahSayLine("Go ahead whenever you're ready.")}
  </Gather>
  ${micahSayLine("I'll hang up — feel free to call back. Goodbye.")}
  <Hangup/>
</Response>`;
}

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

/** Browser / uptime sanity check — Twilio uses POST only. */
export async function GET() {
  return new Response(
    "Micah voice webhook OK — use POST (Twilio). Deployment reachable.",
    {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }
  );
}

export async function POST(req: Request): Promise<Response> {
  console.log("Call Received");
  try {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      console.warn("[micah/voice/incoming] OPENAI_API_KEY missing — /process will return configured error TwiML");
    }
    if (
      !process.env.SUPABASE_URL?.trim() &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    ) {
      console.warn(
        "[micah/voice/incoming] SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL missing — tenant lookup + DB disabled"
      );
    }

    let form: FormData | null = null;
    try {
      form = await req.formData();
    } catch (e) {
      console.error("[micah/voice/incoming] formData parse:", e);
    }

    const incomingSummary = {
      CallSid: typeof form?.get("CallSid") === "string" ? form.get("CallSid") : undefined,
      From: typeof form?.get("From") === "string" ? form.get("From") : undefined,
      To: typeof form?.get("To") === "string" ? form.get("To") : undefined,
      AccountSid:
        typeof form?.get("AccountSid") === "string" ? form.get("AccountSid") : undefined,
    };
    console.log("[micah/voice/incoming] request", incomingSummary);

    const base = safeBuildPublicBaseUrl(req);
    let tenantQuery = "";
    try {
      const to = form?.get("To");
      if (typeof to === "string" && to.length > 0) {
        const supabase = getServiceSupabaseOrNull();
        if (supabase) {
          const tenant = await getTenantVoiceConfigByInboundDid(supabase, to);
          if (tenant) {
            tenantQuery = `?tenant_id=${encodeURIComponent(tenant.tenant_id)}`;
          } else {
            const actionFallback = `${base}/api/voice/process`;
            return twimlResponse(
              twimlGatherFallback(actionFallback),
              "[micah/voice/incoming] tenant-not-found-fallback"
            );
          }
        }
      }
    } catch (e) {
      console.error("[micah/voice/incoming] tenant lookup:", e);
    }

    const action = `${base}/api/voice/process${tenantQuery}`;
    const mode = (process.env.MICAH_TWIML_MODE ?? "gather").toLowerCase();

    let twiml: string;
    try {
      twiml = mode === "record" ? twimlRecord(action) : twimlGather(action);
    } catch (e) {
      console.error("[micah/voice/incoming] twiml build:", e);
      return twimlResponse(
        plainErrorTwiML("Micah hit a quick glitch building your call. Please try again."),
        "[micah/voice/incoming] twiml-build-error"
      );
    }

    return twimlResponse(twiml, "[micah/voice/incoming]");
  } catch (e) {
    console.error("[micah/voice/incoming] fatal:", e);
    return twimlResponse(
      plainErrorTwiML(
        "Hi — Micah's having a quick tech moment. Please hang up and try again in a minute."
      ),
      "[micah/voice/incoming] fatal"
    );
  }
}
