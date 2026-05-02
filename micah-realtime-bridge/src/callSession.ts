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
import { MICAH_REALTIME_INSTRUCTIONS } from "./persona.js";

const OPENAI_BETA = process.env.OPENAI_BETA_HEADER ?? "realtime=v1";

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
    /** Preview models (`gpt-4o-realtime-preview`) accept flat audio + voice; Cedar matches OpenAI docs / video demos. */
    const payload = {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: MICAH_REALTIME_INSTRUCTIONS,
        voice: "cedar",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        turn_detection: { type: "server_vad" },
      },
    };
    openai.send(JSON.stringify(payload));
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
        }, 750);
        return;
      }
      if (typ === "session.updated") {
        sessionReady = true;
        flushQueuedAudio();
        return;
      }
      if (typ === "error") {
        console.error("[openai] error event:", JSON.stringify(ev));
        return;
      }

      appendTranscriptFromOpenAI(ev);

      /** Assistant PCM16 audio → μ-law 8k for Twilio */
      let audioB64: string | undefined;
      if (typ === "response.audio.delta" && typeof ev.delta === "string")
        audioB64 = ev.delta;
      else if (typ === "response.output_audio.delta" && typeof ev.delta === "string")
        audioB64 = ev.delta;
      else if (typ === "response.audio.delta" && typeof (ev as { audio?: string }).audio === "string")
        audioB64 = (ev as { audio?: string }).audio;

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
