import WebSocket from "ws";

const MICAH_INSTRUCTIONS =
  process.env.MICAH_SYSTEM_PROMPT ??
  `You are Micah, a high-energy, friendly real estate assistant for Western Sydney, Australia. \
You help callers with property questions, inspections, and bookings. Be concise, warm, and professional. \
Use Australian English naturally. Never claim to be human; you are the agency's phone assistant.`;

const REALTIME_MODEL =
  process.env.OPENAI_REALTIME_MODEL ?? "gpt-4o-realtime-preview-2024-12-17";
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE ?? "cedar";

export type TranscriptEntry = { role: "user" | "assistant"; text: string };

type TwilioWsMessage = {
  event?: string;
  streamSid?: string;
  start?: {
    streamSid?: string;
    callSid?: string;
    customParameters?: Record<string, string>;
  };
  media?: { track?: string; payload?: string };
};

function safeSend(ws: WebSocket, payload: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function postTranscriptToCommandCentre(payload: {
  callSid: string;
  callerId: string;
  transcript: TranscriptEntry[];
  endedAt: string;
}): Promise<void> {
  const url = process.env.COMMAND_CENTRE_WEBHOOK_URL;
  if (!url?.trim()) {
    return;
  }
  const secret = process.env.COMMAND_CENTRE_WEBHOOK_SECRET;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("Command Centre webhook failed:", res.status, await res.text());
    }
  } catch (e) {
    console.error("Command Centre webhook error:", e);
  }
}

/**
 * One Twilio Media Stream WebSocket bridged to OpenAI Realtime (μ-law / G.711).
 */
export function attachRealtimeToTwilio(twilioWs: WebSocket): void {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    twilioWs.close(1011, "Missing OPENAI_API_KEY");
    return;
  }

  let streamSid: string | null = null;
  let callSid = "";
  let callerId = "";
  const transcript: TranscriptEntry[] = [];
  let assistantDraft = "";
  let handoffDone = false;
  const pendingOutbound: string[] = [];

  const realtimeUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`;
  const openaiWs = new WebSocket(realtimeUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  let sessionReady = false;
  const pendingInboundAudio: string[] = [];

  const flushPendingInbound = (): void => {
    if (!sessionReady) return;
    for (const audio of pendingInboundAudio) {
      safeSend(openaiWs, {
        type: "input_audio_buffer.append",
        audio,
      });
    }
    pendingInboundAudio.length = 0;
  };

  openaiWs.on("open", () => {
    safeSend(openaiWs, {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: MICAH_INSTRUCTIONS,
        voice: REALTIME_VOICE,
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        input_audio_transcription: {
          model: "gpt-4o-mini-transcribe",
          language: "en",
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
        temperature: 0.8,
      },
    });
  });

  openaiWs.on("message", (raw: WebSocket.RawData) => {
    let msg: { type?: string; delta?: string; transcript?: string; error?: { message?: string } };
    try {
      msg = JSON.parse(raw.toString()) as typeof msg;
    } catch {
      return;
    }

    const t = msg.type;
    if (t === "session.updated") {
      sessionReady = true;
      flushPendingInbound();
      return;
    }

    if (t === "response.audio.delta" && msg.delta) {
      if (!streamSid) {
        pendingOutbound.push(msg.delta);
        return;
      }
      safeSend(twilioWs, {
        event: "media",
        streamSid,
        media: { payload: msg.delta },
      });
      return;
    }

    if (t === "response.audio_transcript.delta" && msg.delta) {
      assistantDraft += msg.delta;
      return;
    }

    if (t === "response.audio_transcript.done") {
      const text = msg.transcript ?? assistantDraft;
      assistantDraft = "";
      if (text?.trim()) {
        transcript.push({ role: "assistant", text: text.trim() });
      }
      return;
    }

    if (t === "conversation.item.input_audio_transcription.completed") {
      const tr = (msg as { transcript?: string }).transcript;
      if (tr?.trim()) {
        transcript.push({ role: "user", text: tr.trim() });
      }
      return;
    }

    if (t === "error") {
      console.error("OpenAI Realtime error:", msg.error);
    }
  });

  openaiWs.on("close", () => {
    twilioWs.close();
  });

  openaiWs.on("error", (err) => {
    console.error("OpenAI Realtime socket error:", err);
  });

  twilioWs.on("message", (raw: WebSocket.RawData) => {
    let data: TwilioWsMessage;
    try {
      data = JSON.parse(raw.toString()) as TwilioWsMessage;
    } catch {
      return;
    }

    const ev = data.event;
    if (ev === "connected") {
      return;
    }

    if (ev === "start" && data.start) {
      streamSid = data.start.streamSid ?? data.streamSid ?? null;
      callSid = data.start.callSid ?? "";
      callerId = data.start.customParameters?.from ?? callerId;
      if (streamSid && pendingOutbound.length > 0) {
        for (const payload of pendingOutbound) {
          safeSend(twilioWs, {
            event: "media",
            streamSid,
            media: { payload },
          });
        }
        pendingOutbound.length = 0;
      }
      return;
    }

    const track = data.media?.track;
    const isInbound = !track || track === "inbound";
    if (ev === "media" && data.media?.payload && isInbound) {
      const chunk = data.media.payload;
      if (sessionReady && openaiWs.readyState === WebSocket.OPEN) {
        safeSend(openaiWs, {
          type: "input_audio_buffer.append",
          audio: chunk,
        });
      } else {
        pendingInboundAudio.push(chunk);
      }
      return;
    }

    if (ev === "stop") {
      const endedAt = new Date().toISOString();
      if (!handoffDone) {
        handoffDone = true;
        void postTranscriptToCommandCentre({
          callSid,
          callerId,
          transcript,
          endedAt,
        });
      }
      openaiWs.close();
      return;
    }
  });

  twilioWs.on("close", () => {
    const endedAt = new Date().toISOString();
    if (!handoffDone && (callSid || callerId || transcript.length > 0)) {
      handoffDone = true;
      void postTranscriptToCommandCentre({
        callSid,
        callerId,
        transcript,
        endedAt,
      });
    }
    openaiWs.close();
  });

  twilioWs.on("error", (err) => {
    console.error("Twilio media stream error:", err);
    openaiWs.close();
  });
}
