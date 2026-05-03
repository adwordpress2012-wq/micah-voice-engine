import http from "node:http";
import express from "express";
import WebSocket, { WebSocketServer } from "ws";
import "dotenv/config";
import { attachCallSession } from "./callSession.js";

/** Fly.io / Cloud Run usually set PORT (e.g. 8080); local default keeps README examples simple. */
const PORT = Number(process.env.PORT ?? 8787);
const BRIDGE_SECRET = process.env.MICAH_BRIDGE_SECRET?.trim();
const OPENAI_KEY = process.env.OPENAI_API_KEY?.trim();
const MODEL =
  process.env.OPENAI_REALTIME_MODEL?.trim() ?? "gpt-4o-realtime-preview";
const REALTIME_VOICE =
  process.env.OPENAI_REALTIME_VOICE?.trim().toLowerCase() || "cedar";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "micah-realtime-bridge",
    model: MODEL,
    voice: REALTIME_VOICE,
    hasOpenAI: Boolean(OPENAI_KEY),
  });
});

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  try {
    const host = request.headers.host ?? "localhost";
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (url.pathname !== "/twilio") {
      socket.destroy();
      return;
    }
    if (BRIDGE_SECRET) {
      const token = url.searchParams.get("token");
      if (token !== BRIDGE_SECRET) {
        console.warn("[bridge] rejected WS — bad token");
        socket.destroy();
        return;
      }
    }
    if (!OPENAI_KEY) {
      console.error("[bridge] OPENAI_API_KEY missing — cannot attach realtime session");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } catch (e) {
    console.error("[bridge] upgrade error:", e);
    socket.destroy();
  }
});

wss.on("connection", (twilioWs: WebSocket) => {
  console.log("[bridge] Twilio media stream connected");
  attachCallSession(twilioWs, OPENAI_KEY!, MODEL);
});

server.listen(PORT, () => {
  console.log(
    `[bridge] listening ${PORT} — ws path /twilio — realtime voice=${REALTIME_VOICE} model=${MODEL}`
  );
  if (!OPENAI_KEY) {
    console.warn("[bridge] WARN: OPENAI_API_KEY not set");
  }
  if (!BRIDGE_SECRET) {
    console.warn(
      "[bridge] WARN: MICAH_BRIDGE_SECRET unset — WebSocket URL is not authenticated"
    );
  }
});
