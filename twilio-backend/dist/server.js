"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const express_1 = __importDefault(require("express"));
const dotenv = __importStar(require("dotenv"));
const openai_1 = __importDefault(require("openai"));
const twilio_1 = __importDefault(require("twilio"));
const ws_1 = require("ws");
const realtimeBridge_1 = require("./realtimeBridge");
dotenv.config();
const requiredEnvVars = ["OPENAI_API_KEY"];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
    }
}
const app = (0, express_1.default)();
const port = Number(process.env.PORT ?? 8080);
const openai = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
const MessagingResponse = twilio_1.default.twiml.MessagingResponse;
const openAIModel = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const systemPrompt = process.env.OPENAI_SYSTEM_PROMPT ??
    "You are a helpful SMS assistant. Keep responses concise and clear.";
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
function mediaStreamWssUrl(req) {
    const explicit = process.env.PUBLIC_BASE_URL?.trim();
    const base = explicit?.replace(/\/$/, "") ??
        (() => {
            const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0]?.trim() || "https";
            const hostHeader = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "")
                .split(",")[0]
                ?.trim() ?? "";
            if (!hostHeader) {
                throw new Error("Set PUBLIC_BASE_URL (e.g. https://your-service.run.app) or ensure Host / X-Forwarded-Host is set on the voice webhook.");
            }
            return `${proto}://${hostHeader}`;
        })();
    const withoutScheme = base.replace(/^https?:\/\//i, "");
    const useTls = !base.toLowerCase().startsWith("http://");
    return `${useTls ? "wss" : "ws"}://${withoutScheme}/media-stream`;
}
function voiceIncomingTwiML(req, from) {
    const wssUrl = mediaStreamWssUrl(req);
    const esc = (s) => s
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
app.get("/", (_req, res) => {
    res.type("text/plain").send("Micah voice + SMS backend. POST /voice/incoming for calls, WebSocket /media-stream for Twilio Media Streams, POST /webhook for SMS.");
});
/** Twilio Voice: point "A call comes in" to POST {PUBLIC_BASE_URL}/voice/incoming */
app.post("/voice/incoming", (req, res) => {
    try {
        const from = String(req.body.From ?? "");
        res.type("text/xml").send(voiceIncomingTwiML(req, from));
    }
    catch (e) {
        console.error(e);
        res
            .status(500)
            .type("text/plain")
            .send("Server misconfigured: set PUBLIC_BASE_URL or fix proxy Host headers for voice TwiML.");
    }
});
app.post("/webhook", async (req, res) => {
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
        const assistantReply = completion.output_text?.trim() ||
            "Sorry, I could not generate a response right now.";
        twiml.message(assistantReply);
        res.type("text/xml").send(twiml.toString());
    }
    catch (error) {
        console.error("Failed to generate OpenAI response for sender:", from, error);
        twiml.message("Sorry, something went wrong. Please try again in a moment.");
        res.type("text/xml").send(twiml.toString());
    }
});
const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
    const host = request.headers.host ?? "localhost";
    const pathname = new URL(request.url ?? "/", `http://${host}`).pathname;
    if (pathname === "/media-stream") {
        wss.handleUpgrade(request, socket, head, (ws) => {
            (0, realtimeBridge_1.attachRealtimeToTwilio)(ws);
        });
    }
    else {
        socket.destroy();
    }
});
server.listen(port, () => {
    console.log(`Micah backend listening on ${port} (HTTP + Twilio media WebSocket /media-stream)`);
});
process.on("SIGTERM", () => {
    server.close(() => process.exit(0));
});
