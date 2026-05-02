/**
 * Twilio Media Streams: μ-law 8 kHz mono ↔ PCM16 LE for OpenAI Realtime (PCM16 @ 24 kHz input).
 * Simple hold/interpolate resampling — adequate for telephony experiments; swap for polyphase if needed.
 */

/** μ-law byte → int16 linear PCM sample (G.711). */
export function muLawDecodeSample(mu: number): number {
  const BIAS = 0x84;
  mu = ~mu & 0xff;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  let sample = ((mantissa << 4) + 0x08) << (exponent + 3);
  sample -= BIAS;
  if (sign) sample = -sample;
  return Math.max(-32768, Math.min(32767, sample));
}

/** int16 sample → μ-law byte */
export function muLawEncodeSample(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let exp = 0; exp < 8; exp++) {
    if (sample <= (0xff << (exp + 2))) {
      exponent = exp;
      break;
    }
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  let muLaw = ~(sign | (exponent << 4) | mantissa);
  return muLaw & 0xff;
}

export function decodeMuLawBuffer(buf: Buffer): Int16Array {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = muLawDecodeSample(buf[i]);
  return out;
}

export function encodeMuLawBuffer(samples: Int16Array): Buffer {
  const out = Buffer.alloc(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = muLawEncodeSample(samples[i]);
  return out;
}

/** 8 kHz → 24 kHz: repeat each sample 3× (zero-order hold). */
export function upsample8kTo24k(samples8k: Int16Array): Int16Array {
  const out = new Int16Array(samples8k.length * 3);
  let j = 0;
  for (let i = 0; i < samples8k.length; i++) {
    const s = samples8k[i];
    out[j++] = s;
    out[j++] = s;
    out[j++] = s;
  }
  return out;
}

/** 24 kHz → 8 kHz: take every 3rd sample (drops 2/3 energy — acceptable for telephony POC). */
export function downsample24kTo8k(samples24k: Int16Array): Int16Array {
  const n = Math.floor(samples24k.length / 3);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = samples24k[i * 3];
  return out;
}

export function pcm16ToBase64(samples: Int16Array): string {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], i * 2);
  return buf.toString("base64");
}

export function base64ToPcm16(b64: string): Int16Array {
  const buf = Buffer.from(b64, "base64");
  const n = Math.floor(buf.length / 2);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}
