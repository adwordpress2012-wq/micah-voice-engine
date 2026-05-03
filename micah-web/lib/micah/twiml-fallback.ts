import { NextResponse } from "next/server";
import { escapeXml } from "@/lib/twiml";

/**
 * Last-resort TwiML when handlers cannot build the full flow (signature failure,
 * missing OpenAI key, malformed request body, etc).
 *
 * Hard rule: NEVER silent, NEVER male voice.
 *   1. MICAH_FALLBACK_MP3_URL (pre-recorded Aussie Micah)  → <Play>
 *   2. Otherwise              <Say voice="Polly.Olivia" language="en-AU">  ← female AU
 *
 * Polly.Olivia is the AWS Neural female Australian voice — same gender + accent
 * as Aussie Micah, just a different TTS engine. It is hardcoded here so the
 * error path can never be silent and can never reach a male/default voice.
 */
export function plainErrorTwiML(userMessage: string): string {
  const safeText = escapeXml(userMessage.slice(0, 1000));
  const mp3 = process.env.MICAH_FALLBACK_MP3_URL?.trim();
  if (mp3) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${escapeXml(mp3)}</Play>
  <Hangup/>
</Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Olivia" language="en-AU">${safeText}</Say>
  <Hangup/>
</Response>`;
}

/** Twilio Voice webhooks must get HTTP 200 with XML; errors use Hangup in-body, not 5xx. */
export function twimlResponse(twiml: string, logLabel: string): NextResponse {
  const safe =
    twiml.length > 16000 ? `${twiml.slice(0, 16000)}\n<!-- truncated for log -->` : twiml;
  console.log(`[${logLabel}] twiml length=${twiml.length} body=`, safe);
  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
