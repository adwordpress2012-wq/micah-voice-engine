import { NextResponse } from "next/server";
import { escapeXml } from "@/lib/twiml";

/**
 * Last-resort TwiML when handlers cannot build the full flow (signature failure,
 * missing OpenAI key, malformed request body, etc).
 *
 * NEVER uses Polly or any non-Aussie-Micah voice. If MICAH_FALLBACK_MP3_URL is
 * set (a pre-recorded Aussie Micah apology), it is played and the call hangs up
 * gracefully. Otherwise the call hangs up silently — better than a wrong voice.
 *
 * `userMessage` is kept in the function signature for back-compat but is not
 * spoken; the static MP3 (if configured) carries any apology audio.
 */
export function plainErrorTwiML(_userMessage: string): string {
  const mp3 = process.env.MICAH_FALLBACK_MP3_URL?.trim();
  if (mp3) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${escapeXml(mp3)}</Play>
  <Hangup/>
</Response>`;
  }
  // No fallback MP3 configured — silent short pause then hang up. Caller experiences
  // a moment of silence rather than a wrong-voice apology. Set MICAH_FALLBACK_MP3_URL
  // (Aussie Micah pre-recorded MP3) to replace this with audible Micah audio.
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
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
