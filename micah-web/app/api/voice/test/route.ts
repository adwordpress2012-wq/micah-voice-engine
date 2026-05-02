import twilio from "twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return new Response("POST /api/voice/test — Twilio Voice (TwiML say)", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST() {
  const response = new twilio.twiml.VoiceResponse();
  response.say("Micah test successful");
  return new Response(response.toString(), {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
