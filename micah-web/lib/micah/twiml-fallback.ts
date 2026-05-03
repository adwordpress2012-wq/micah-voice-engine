import { NextResponse } from "next/server";
import { micahPollyVoice } from "@/lib/micah/twilio-voice";
import { escapeXml } from "@/lib/twiml";

/** Minimal valid TwiML when handlers cannot build the full flow (Polly via `MICAH_POLLY_VOICE`, default en-AU-safe). */
export function plainErrorTwiML(userMessage: string): string {
  const t = escapeXml(userMessage.slice(0, 1000));
  const v = escapeXml(micahPollyVoice());
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${v}" language="en-AU">${t}</Say>
  <Hangup/>
</Response>`;
}

/** Twilio Voice webhooks must get HTTP 200 with XML; errors use Say/Hangup in-body, not 5xx. */
export function twimlResponse(twiml: string, logLabel: string): NextResponse {
  const safe =
    twiml.length > 16000 ? `${twiml.slice(0, 16000)}\n<!-- truncated for log -->` : twiml;
  console.log(`[${logLabel}] twiml length=${twiml.length} body=`, safe);
  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
