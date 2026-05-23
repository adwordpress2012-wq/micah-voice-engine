import { NextResponse } from "next/server";
import { Resend } from "resend";
import {
  buildResendEnvDiagnostics,
  formatResendError,
  maskEmailAddress,
  resolveLeadRecipient,
  resolveResendApiKey,
  resolveResendFromAddress,
} from "@/lib/micah/resend-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST JSON: `{ "transcript"?: string, "to"?: string, "test"?: boolean }`
 * - Body text falls back to "No transcript provided" if empty.
 * - Normal: sends to `to` or `MICAH_VOICE_NOTIFY_EMAIL` or `MICAH_TRANSCRIPT_DEFAULT_TO` or `leads@directiveos.com.au`.
 * - `test: true`: sends only to `MICAH_RESEND_TEST_TO` (set in env, e.g. your personal inbox for tests).
 * Optional: `Authorization: Bearer <MICAH_TRANSCRIPT_API_SECRET>` if that env is set.
 */
export async function POST(req: Request): Promise<Response> {
  const apiSecret = process.env.MICAH_TRANSCRIPT_API_SECRET?.trim();
  if (apiSecret) {
    const auth = req.headers.get("authorization")?.trim();
    if (auth !== `Bearer ${apiSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const apiKey = resolveResendApiKey();
  const from = resolveResendFromAddress();
  const resendDiag = buildResendEnvDiagnostics();

  if (!apiKey || !from) {
    console.warn("[email/send-transcript] Resend not configured", {
      micahVoiceQA: true,
      event: "email_send_transcript_skip_not_configured",
      resendApiKeyConfigured: resendDiag.apiKeyConfigured,
      apiKeySource: resendDiag.apiKeySource,
      fromConfigured: resendDiag.fromConfigured,
      fromPreview: resendDiag.fromPreview,
      blockedReasons: resendDiag.blockedReasons,
    });
    return NextResponse.json(
      { error: "Resend not configured (RESEND_API_KEY / RESEND_FROM)" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body as {
    transcript?: string;
    to?: string;
    test?: boolean;
  };

  const raw = typeof b.transcript === "string" ? b.transcript.trim() : "";
  const text = raw || "No transcript provided";

  let to: string;
  if (b.test === true) {
    const testTo = process.env.MICAH_RESEND_TEST_TO?.trim();
    if (!testTo) {
      return NextResponse.json(
        {
          error:
            "test mode requires MICAH_RESEND_TEST_TO (do not hardcode personal emails in code)",
        },
        { status: 400 }
      );
    }
    to = testTo;
  } else {
    to =
      (typeof b.to === "string" && b.to.trim()) ||
      resolveLeadRecipient() ||
      "leads@directiveos.com.au";
  }

  console.log("[email/send-transcript] Resend attempt", {
    micahVoiceQA: true,
    event: "email_send_transcript_attempt",
    resendApiKeyConfigured: true,
    apiKeySource: resendDiag.apiKeySource,
    recipientMask: maskEmailAddress(to),
    fromPreview: from.replace(/<[^>]+>/, "<…>"),
    testMode: b.test === true,
  });

  const resend = new Resend(apiKey);
  try {
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject: "Micah Call Transcript",
      text,
    });
    if (error) {
      const detail = formatResendError(error);
      console.error("[email/send-transcript] Resend API error", {
        micahVoiceQA: true,
        event: "email_send_transcript_resend_error",
        recipientMask: maskEmailAddress(to),
        fromPreview: from.replace(/<[^>]+>/, "<…>"),
        resendApiKeyConfigured: true,
        resendSuccess: false,
        error: detail,
      });
      return NextResponse.json({ error: detail }, { status: 500 });
    }
    console.log("[email/send-transcript] Resend sent", {
      micahVoiceQA: true,
      event: "email_send_transcript_resend_ok",
      recipientMask: maskEmailAddress(to),
      fromPreview: from.replace(/<[^>]+>/, "<…>"),
      resendApiKeyConfigured: true,
      resendSuccess: true,
      resendId: data?.id ?? null,
    });
    return NextResponse.json({
      success: true,
      ...(data?.id ? { id: data.id } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[email/send-transcript] Resend threw", {
      micahVoiceQA: true,
      event: "email_send_transcript_resend_throw",
      recipientMask: maskEmailAddress(to),
      fromPreview: from.replace(/<[^>]+>/, "<…>"),
      resendApiKeyConfigured: true,
      resendSuccess: false,
      error: msg,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  return new Response(
    "POST /api/email/send-transcript — JSON { transcript, to?, test? }. Optional Bearer MICAH_TRANSCRIPT_API_SECRET.",
    { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}
