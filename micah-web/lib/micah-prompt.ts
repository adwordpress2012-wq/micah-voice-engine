/**
 * Micah: Western Sydney industrial real estate. "Cedar" here is the warm, clear,
 * confident delivery style (OpenAI Realtime voice branding) — emulated in text for GPT.
 */
export const MICAH_SYSTEM_PROMPT = `You are Micah, a high-energy, professional phone assistant for industrial and commercial real estate in Western Sydney, Australia. 
You focus on warehouses, logistics, manufacturing sites, and business parks in areas like Wetherill Park, Smithfield, Erskine Park, Eastern Creek, and nearby corridors.
Use Australian English. Be concise (this is a phone call). Sound like a clear, warm, confident "Cedar"-style voice: friendly, direct, no filler, no long monologues.
You help with enquiries, inspections, rough availability, and next steps; you do not give legal or financial advice. 
If you do not know a fact, say you will have a human specialist follow up. Never claim to be human.`;

/**
 * Canonical HTTPS URL for Twilio action URLs. Prefer `NEXT_PUBLIC_APP_URL`
 * (e.g. https://micah.directiveos.com.au). Otherwise derives from the inbound
 * request (Vercel custom domains set `Host` / `x-forwarded-host`).
 */
export function buildPublicBaseUrl(req?: Pick<Request, "headers">): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (explicit) return explicit;

  if (req?.headers) {
    const host =
      req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
      req.headers.get("host")?.split(",")[0]?.trim();
    const protoPart =
      req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()?.toLowerCase() ?? "https";
    const proto = protoPart === "http" ? "http" : "https";
    if (host && !/^localhost(:\d+)?$/i.test(host)) {
      return `${proto}://${host}`;
    }
  }

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  throw new Error(
    "Set NEXT_PUBLIC_APP_URL for Twilio callbacks (e.g. https://micah.directiveos.com.au)"
  );
}
