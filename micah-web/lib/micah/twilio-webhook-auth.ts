import twilio from "twilio";

let warnedMissingAuthToken = false;

/**
 * Exact URL Twilio used when signing the webhook (must match Console webhook URL).
 * Use forwarded headers on Vercel so custom domains match.
 */
export function buildTwilioWebhookUrl(req: Request): string {
  const url = new URL(req.url);
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host =
    forwardedHost ||
    req.headers.get("host")?.split(",")[0]?.trim() ||
    url.host;
  let proto =
    forwardedProto?.toLowerCase() || url.protocol.replace(":", "") || "https";
  if (proto !== "http" && proto !== "https") proto = "https";
  return `${proto}://${host}${url.pathname}${url.search}`;
}

function formDataToParams(form: FormData): Record<string, string> {
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });
  return params;
}

/**
 * When `TWILIO_AUTH_TOKEN` is set, verifies `X-Twilio-Signature`.
 * Set `MICAH_SKIP_TWILIO_SIGNATURE=1` only for local debugging (never in production).
 */
export function isValidTwilioVoiceWebhook(
  req: Request,
  form: FormData
): boolean {
  if (process.env.MICAH_SKIP_TWILIO_SIGNATURE === "1") {
    console.warn(
      "[twilio-webhook] MICAH_SKIP_TWILIO_SIGNATURE=1 — signature check disabled"
    );
    return true;
  }
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!token) {
    if (!warnedMissingAuthToken) {
      warnedMissingAuthToken = true;
      console.warn(
        "[twilio-webhook] TWILIO_AUTH_TOKEN not set — webhook signatures are not verified (set in production)."
      );
    }
    return true;
  }
  const signature = req.headers.get("x-twilio-signature") ?? "";
  const url = buildTwilioWebhookUrl(req);
  const params = formDataToParams(form);
  return twilio.validateRequest(token, signature, url, params);
}
