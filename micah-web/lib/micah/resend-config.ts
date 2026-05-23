import { maskApiCredential } from "@/lib/micah/mask-api-credential";

/**
 * Prefer canonical `RESEND_API_KEY` (Vercel production). Legacy `MICAH_RESEND_API_KEY` is only
 * used when `RESEND_API_KEY` is unset — stale Micah-specific keys have blocked live lead email.
 */
export function resolveResendApiKey(): string | null {
  return (
    process.env.RESEND_API_KEY?.trim() ||
    process.env.MICAH_RESEND_API_KEY?.trim() ||
    null
  );
}

export function resolveResendFromAddress(): string {
  return (
    process.env.RESEND_FROM?.trim() || "Micah <onboarding@resend.dev>"
  );
}

/**
 * DOS voice lead recipient — env only (no hardcoded personal inboxes).
 * Falls back to `leads@directiveos.com.au` when transcript routes use the same default.
 */
export function resolveLeadRecipient(): string | null {
  return (
    process.env.MICAH_VOICE_NOTIFY_EMAIL?.trim() ||
    process.env.MICAH_TRANSCRIPT_DEFAULT_TO?.trim() ||
    "leads@directiveos.com.au"
  );
}

/** Mask `user@domain` → `u…r@domain` for logs/diagnostics. */
export function maskEmailAddress(email: string | null | undefined): string | null {
  const s = email?.trim();
  if (!s) return null;
  const at = s.indexOf("@");
  if (at <= 0) return "(invalid email)";
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (local.length <= 2) return `…@${domain}`;
  return `${local.slice(0, 1)}…${local.slice(-1)}@${domain}`;
}

export function formatResendError(error: unknown): string {
  if (error == null) return "unknown Resend error";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export type ResendEnvDiagnostics = {
  apiKeyConfigured: boolean;
  apiKeyMask: string | null;
  apiKeySource: "RESEND_API_KEY" | "MICAH_RESEND_API_KEY" | null;
  fromConfigured: boolean;
  fromPreview: string | null;
  leadNotifyEmailConfigured: boolean;
  leadNotifyEmailMask: string | null;
  transcriptDefaultToConfigured: boolean;
  transcriptDefaultToMask: string | null;
  resolvedLeadRecipientMask: string | null;
  resendReady: boolean;
  blockedReasons: string[];
};

export function buildResendEnvDiagnostics(): ResendEnvDiagnostics {
  const micahResendKey = process.env.MICAH_RESEND_API_KEY?.trim();
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const apiKey = resolveResendApiKey();
  const from = process.env.RESEND_FROM?.trim();
  const notify = process.env.MICAH_VOICE_NOTIFY_EMAIL?.trim();
  const transcriptTo = process.env.MICAH_TRANSCRIPT_DEFAULT_TO?.trim();
  const resolvedTo = resolveLeadRecipient();

  const blockedReasons: string[] = [];
  if (!apiKey) {
    blockedReasons.push("RESEND_API_KEY (or MICAH_RESEND_API_KEY) is not set");
  }
  if (!from) {
    blockedReasons.push(
      "RESEND_FROM is not set — onboarding@resend.dev only delivers to the Resend account owner"
    );
  }
  if (!notify && !transcriptTo) {
    blockedReasons.push(
      "MICAH_VOICE_NOTIFY_EMAIL and MICAH_TRANSCRIPT_DEFAULT_TO unset — using default leads@directiveos.com.au"
    );
  }

  return {
    apiKeyConfigured: !!apiKey,
    apiKeyMask: maskApiCredential(apiKey),
    apiKeySource: resendKey
      ? "RESEND_API_KEY"
      : micahResendKey
        ? "MICAH_RESEND_API_KEY"
        : null,
    fromConfigured: !!from,
    fromPreview: from ? from.replace(/<[^>]+>/, "<…>") : null,
    leadNotifyEmailConfigured: !!notify,
    leadNotifyEmailMask: maskEmailAddress(notify),
    transcriptDefaultToConfigured: !!transcriptTo,
    transcriptDefaultToMask: maskEmailAddress(transcriptTo),
    resolvedLeadRecipientMask: maskEmailAddress(resolvedTo),
    resendReady: !!apiKey && !!from,
    blockedReasons,
  };
}
