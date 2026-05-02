/**
 * Legacy baseline copy (non-voice tooling). Phone flows use `MASTER_SYSTEM_PROMPT_V2`
 * + tenant substitutions via `buildMasterSystemPromptV2` in `lib/micah/master-prompt-v2.ts`.
 */
export const MICAH_SYSTEM_PROMPT = `You are Micah, a high-energy, professional phone assistant for industrial and commercial real estate in Western Sydney, Australia. 
You focus on warehouses, logistics, manufacturing sites, and business parks in areas like Wetherill Park, Smithfield, Erskine Park, Eastern Creek, and nearby corridors.
Use Australian English. Be concise (this is a phone call). Sound like a clear, warm, confident "Cedar"-style voice: friendly, direct, no filler, no long monologues.
You help with enquiries, inspections, rough availability, and next steps; you do not give legal or financial advice. 
If you do not know a fact, say you will have a human specialist follow up. Never claim to be human.`;

/**
 * Canonical HTTPS URL for Twilio `<Record>` / `<Gather>` action attributes.
 * When `req` is present (Twilio webhooks), uses `Host` / `x-forwarded-host` first
 * so custom domains (e.g. micah.directiveos.com.au) match the URL Twilio called.
 * Falls back to `NEXT_PUBLIC_APP_URL` when no usable host (e.g. some local runs).
 */
export function buildPublicBaseUrl(req?: Pick<Request, "headers">): string {
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

  const explicit = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (explicit) return explicit;

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;
  throw new Error(
    "Set NEXT_PUBLIC_APP_URL for Twilio callbacks (e.g. https://micah.directiveos.com.au)"
  );
}

/** Never throws — use in voice webhooks so Twilio always gets 200 + valid XML. */
export function safeBuildPublicBaseUrl(req: Request): string {
  try {
    return buildPublicBaseUrl(req);
  } catch {
    const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
    if (fromEnv) return fromEnv;
    try {
      const u = new URL(req.url);
      return `${u.protocol}//${u.host}`.replace(/\/$/, "");
    } catch {
      return "https://micah.directiveos.com.au";
    }
  }
}
