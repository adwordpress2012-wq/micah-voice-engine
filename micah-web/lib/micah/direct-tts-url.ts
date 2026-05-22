import { createHmac, timingSafeEqual } from "crypto";

import { micahElevenLabsOptsForUtterance } from "@/lib/micah/micah-empathy-tts";

const DIRECT_TTS_PATH = "/api/voice/tts";
const MICAH_PRODUCTION_VOICE_ORIGIN = "https://micah.directiveos.com.au";

function directTtsSecret(): string {
  return (
    process.env.TWILIO_AUTH_TOKEN?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.ELEVENLABS_API_KEY?.trim() ||
    ""
  );
}

function base64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function signPayload(payload: string): string | null {
  const secret = directTtsSecret();
  if (!secret) return null;
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifyMicahDirectTtsPayload(payload: string, sig: string): boolean {
  const expected = signPayload(payload);
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function decodeMicahDirectTtsPayload(payload: string): string {
  return Buffer.from(payload, "base64url").toString("utf8").trim().slice(0, 1200);
}

export function buildMicahDirectTtsUrl(text: string): string | null {
  const plain = text.trim().slice(0, 1200);
  if (!plain) return null;

  const payload = base64Url(plain);
  const sig = signPayload(payload);
  if (!sig) return null;
  return `${MICAH_PRODUCTION_VOICE_ORIGIN}${DIRECT_TTS_PATH}?t=${encodeURIComponent(payload)}&sig=${encodeURIComponent(sig)}`;
}

export function micahDirectTtsOpts(text: string) {
  return micahElevenLabsOptsForUtterance(text);
}
