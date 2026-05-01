import http from "http";
import express, { Request, Response } from "express";
import type { IncomingHttpHeaders } from "http";
import * as dotenv from "dotenv";
import OpenAI from "openai";
import twilio from "twilio";
import { WebSocketServer } from "ws";
import { attachRealtimeToTwilio } from "./realtimeBridge";

dotenv.config();

type TwilioWebhookBody = {
  Body?: string;
  From?: string;
  [key: string]: unknown;
};

type TwilioVoiceBody = {
  From?: string;
  CallSid?: string;
  [key: string]: unknown;
};

const requiredEnvVars = ["OPENAI_API_KEY"] as const;
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

const app = express();
const port = Number(process.env.PORT ?? 8080);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MessagingResponse = twilio.twiml.MessagingResponse;
const openAIModel = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const systemPrompt =
  process.env.OPENAI_SYSTEM_PROMPT ??
  "You are a helpful SMS assistant. Keep responses concise and clear.";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function mediaStreamWssUrl(req: { headers: IncomingHttpHeaders }): string {
  const explicit = process.env.PUBLIC_BASE_URL?.trim();
  const base =
    explicit?.replace(/\/$/, "") ??
    (() => {
      const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0]?.trim() || "https";
      const hostHeader =
        String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "")
          .split(",")[0]
          ?.trim() ?? "";
      if (!hostHeader) {
        throw new Error(
          "Set PUBLIC_BASE_URL (e.g. https://your-service.run.app) or ensure Host / X-Forwarded-Host is set on the voice webhook."
        );
      }
      return `${proto}://${hostHeader}`;
    })();
  const withoutScheme = base.replace(/^https?:\/\//i, "");
  const useTls = !base.toLowerCase().startsWith("http://");
  return `${useTls ? "wss" : "ws"}://${withoutScheme}/media-stream`;
}

function voiceIncomingTwiML(req: { headers: IncomingHttpHeaders }, from: string): string {
  const wssUrl = mediaStreamWssUrl(req);
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${esc(wssUrl)}">
      <Parameter name="from" value="${esc(from)}" />
    </Stream>
  </Connect>
</Response>`;
}

app.get("/", (_req: Request, res: Response) => {
  res.type("text/plain").send(
    "Micah voice + SMS backend. POST /voice/incoming for calls, WebSocket /media-stream for Twilio Media Streams, POST /webhook for SMS."
  );
});

/** Twilio Voice: point "A call comes in" to POST {PUBLIC_BASE_URL}/voice/incoming */
app.post("/voice/incoming", (req: Request<unknown, unknown, TwilioVoiceBody>, res: Response) => {
  try {
    const from = String(req.body.From ?? "");
    res.type("text/xml").send(voiceIncomingTwiML(req, from));
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .type("text/plain")
      .send("Server misconfigured: set PUBLIC_BASE_URL or fix proxy Host headers for voice TwiML.");
  }
});

app.post(
  "/webhook",
  async (req: Request<unknown, unknown, TwilioWebhookBody>, res: Response): Promise<void> => {
    const userMessage = req.body.Body?.trim();
    const from = req.body.From ?? "unknown";
    const twiml = new MessagingResponse();

    if (!userMessage) {
      twiml.message("I did not receive a message. Please try again.");
      res.type("text/xml").send(twiml.toString());
      return;
    }

    try {
      const completion = await openai.responses.create({
        model: openAIModel,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      });

      const assistantReply =
        completion.output_text?.trim() ||
        "Sorry, I could not generate a response right now.";

      twiml.message(assistantReply);
      res.type("text/xml").send(twiml.toString());
    } catch (error) {
      console.error("Failed to generate OpenAI response for sender:", from, error);
      twiml.message("Sorry, something went wrong. Please try again in a moment.");
      res.type("text/xml").send(twiml.toString());
    }
  }
);

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const host = request.headers.host ?? "localhost";
  const pathname = new URL(request.url ?? "/", `http://${host}`).pathname;
  if (pathname === "/media-stream") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      attachRealtimeToTwilio(ws);
    });
  } else {
    socket.destroy();
  }
});

server.listen(port, () => {
  console.log(`Micah backend listening on ${port} (HTTP + Twilio media WebSocket /media-stream)`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
