import WebSocket from "ws";
import {
  base64ToPcm16,
  decodeMuLawBuffer,
  downsample24kTo8k,
  encodeMuLawBuffer,
  pcm16ToBase64,
  upsample8kTo24k,
} from "./audio.js";
import { saveLeadFromCall } from "./leadWriter.js";
import { buildMicahRealtimeInstructions } from "./persona.js";

const OPENAI_BETA = process.env.OPENAI_BETA_HEADER ?? "realtime=v1";

/** Preset output voice for Realtime (`cedar`, `marin`, `shimmer`, `alloy`, `echo`, …). Same Fly secret for every call. */
const REALTIME_VOICE =
  process.env.OPENAI_REALTIME_VOICE?.trim().toLowerCase() || "cedar";

/** Synthetic user line so the model speaks first (server VAD alone waits for caller audio → silence). */
const OPENING_NUDGE_TEXT =
  process.env.MICAH_REALTIME_OPENING_NUDGE?.trim() ||
  "Call connected. Speak the exact opening greeting from your instructions in full, then listen to the caller.";

type TwilioStart = {
  event: "start";
  start: {
    streamSid: string;
    callSid?: string;
    customParameters?: Record<string, string>;
  };
};

type TwilioMedia = {
  event: "media";
  media: { payload: string; track: string };
};

/** Pick base64 PCM from any known Realtime output-audio event shape. */
function extractAssistantAudioBase64(
  typ: string,
  ev: Record<string, unknown>
): string | undefined {
  const isOutAudio =
    typ === "response.audio.delta" ||
    typ === "response.output_audio.delta" ||
    typ.includes("output_audio.delta");
  if (isOutAudio && typeof ev.delta === "string") return ev.delta;
  if (typ === "response.audio.delta" && typeof ev.audio === "string")
    return ev.audio;
  const ob = ev.output_audio as Record<string, unknown> | undefined;
  if (ob && typeof ob.delta === "string") return ob.delta as string;
  return undefined;
}

/**
 * One Twilio WebSocket + one OpenAI Realtime WebSocket, bridged.
 */
export function attachCallSession(
  twilioWs: WebSocket,
  openaiKey: string,
  model: string
): void {
  let openai: WebSocket | null = null;
  let streamSid: string | null = null;
  let callSid = "";
  let fromNum = "";
  let toNum = "";
  let transcriptChunks: string[] = [];
  let sessionReady = false;
  let openingTurnSent = false;
  let outboundAudioChunks = 0;
  const queuedTwilioAudio: string[] = [];

  function appendTranscriptFromOpenAI(ev: Record<string, unknown>) {
    const t = ev.type as string;
    if (!t) return;
    if (t.includes("transcript") && typeof ev.delta === "string") {
      transcriptChunks.push(ev.delta);
      return;
    }
    if (t.includes("transcript") && typeof ev.text === "string") {
      transcriptChunks.push(ev.text);
      return;
    }
    if (t === "conversation.item.created") {
      const item = ev.item as Record<string, unknown> | undefined;
      const content = item?.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (typeof c.transcript === "string") transcriptChunks.push(c.transcript);
          if (typeof c.text === "string") transcriptChunks.push(c.text);
        }
      }
    }
  }

  function sendSessionUpdate() {
    if (!openai || openai.readyState !== WebSocket.OPEN) return;
    console.log("[openai] session.update model=", model, "voice=", REALTIME_VOICE);
    /** Preview models (`gpt-4o-realtime-preview`) accept flat `voice` + modalities (see OPENAI_REALTIME_VOICE). */
    const payload = {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: buildMicahRealtimeInstructions(toNum),
        voice: REALTIME_VOICE,
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        turn_detection: { type: "server_vad" },
      },
    };
    openai.send(JSON.stringify(payload));
  }

  /** After session is ready: nudge the model to produce an immediate greeting (otherwise Realtime waits for user speech). */
  function sendOpeningTurn() {
    if (!openai || openai.readyState !== WebSocket.OPEN || openingTurnSent) return;
    openingTurnSent = true;
    console.log("[openai] opening turn — synthetic user message + response.create");
    try {
      openai.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: OPENING_NUDGE_TEXT }],
          },
        })
      );
      openai.send(JSON.stringify({ type: "response.create" }));
    } catch (e) {
      console.error("[openai] sendOpeningTurn failed:", e);
      openingTurnSent = false;
    }
  }

  function flushQueuedAudio() {
    if (!openai || openai.readyState !== WebSocket.OPEN || !sessionReady) return;
    while (queuedTwilioAudio.length > 0) {
      const b64 = queuedTwilioAudio.shift();
      if (!b64) continue;
      const mulaw = Buffer.from(b64, "base64");
      const pcm8k = decodeMuLawBuffer(mulaw);
      const pcm24k = upsample8kTo24k(pcm8k);
      const audioB64 = pcm16ToBase64(pcm24k);
      openai.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: audioB64,
        })
      );
    }
  }

  function connectOpenAI() {
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
    openai = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "OpenAI-Beta": OPENAI_BETA,
      },
    });

    openai.on("open", () => {
      console.log("[openai] realtime socket open");
    });

    openai.on("message", (data, isBinary) => {
      if (isBinary) return;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      const typ = ev.type as string;
      if (typ === "session.created") {
        sendSessionUpdate();
        /** Some API revisions omit `session.updated`; unblock audio after short delay. */
        setTimeout(() => {
          if (!sessionReady) {
            sessionReady = true;
            flushQueuedAudio();
          }
          sendOpeningTurn();
        }, 750);
        return;
      }
      if (typ === "session.updated") {
        sessionReady = true;
        flushQueuedAudio();
        sendOpeningTurn();
        return;
      }
      if (typ === "error") {
        const errObj = ev.error as Record<string, unknown> | undefined;
        const msg =
          (typeof errObj?.message === "string" && errObj.message) ||
          (typeof ev.message === "string" && ev.message) ||
          JSON.stringify(ev);
        console.error("[openai] error event:", msg);
        return;
      }

      appendTranscriptFromOpenAI(ev);

      /** Assistant PCM16 base64 — event names vary by Realtime API revision. */
      let audioB64 = extractAssistantAudioBase64(typ, ev);

      if (audioB64 && streamSid && twilioWs.readyState === WebSocket.OPEN) {
        try {
          const pcm24 = base64ToPcm16(audioB64);
          const pcm8 = downsample24kTo8k(pcm24);
          const mulawBuf = encodeMuLawBuffer(pcm8);
          twilioWs.send(
            JSON.stringify({
              event: "media",
              streamSid,
              media: { payload: mulawBuf.toString("base64") },
            })
          );
          outboundAudioChunks += 1;
          if (outboundAudioChunks === 1) {
            console.log("[bridge] first outbound audio chunk sent to Twilio");
          }
        } catch (e) {
          console.warn("[bridge] outbound audio chunk failed:", e);
        }
      }
    });

    openai.on("close", () => {
      console.log("[openai] closed");
    });

    openai.on("error", (err) => {
      console.error("[openai] ws error:", err);
    });
  }

  twilioWs.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    const ev = msg.event as string;

    if (ev === "connected") return;

    if (ev === "start") {
      const s = msg as unknown as TwilioStart;
      streamSid = s.start.streamSid;
      callSid = s.start.callSid ?? "";
      const cp = s.start.customParameters ?? {};
      fromNum = cp.From ?? cp.from ?? "";
      toNum = cp.To ?? cp.to ?? "";
      console.log("[twilio] start", { streamSid, callSid, fromNum, toNum });
      connectOpenAI();
      return;
    }

    if (ev === "media") {
      const m = msg as unknown as TwilioMedia;
      const tr = m.media.track;
      if (tr && tr !== "inbound" && tr !== "inbound_track") return;
      const payload = m.media.payload;
      if (!openai || openai.readyState !== WebSocket.OPEN) {
        queuedTwilioAudio.push(payload);
        return;
      }
      if (!sessionReady) {
        queuedTwilioAudio.push(payload);
        return;
      }
      const mulaw = Buffer.from(payload, "base64");
      const pcm8k = decodeMuLawBuffer(mulaw);
      const pcm24k = upsample8kTo24k(pcm8k);
      const audioB64 = pcm16ToBase64(pcm24k);
      openai.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: audioB64,
        })
      );
      return;
    }

    if (ev === "stop") {
      void (async () => {
        const fullTranscript = transcriptChunks.join(" ").replace(/\s+/g, " ").trim();
        await saveLeadFromCall({
          transcriptOriginal: fullTranscript || "(no transcript captured)",
          callSid: callSid || "unknown",
          from: fromNum,
          to: toNum,
        });
      })();
      try {
        openai?.close();
      } catch {
        /* ignore */
      }
      twilioWs.close();
    }
  });

  twilioWs.on("close", () => {
    try {
      openai?.close();
    } catch {
      /* ignore */
    }
  });
}
