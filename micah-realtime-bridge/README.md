# Micah — Twilio Media Streams ↔ OpenAI Realtime (Cedar)

Long-lived **WebSockets are not supported on Vercel serverless**. This small **Node.js service** bridges:

- **Twilio** `<Connect><Stream>` (μ-law 8 kHz)  
- **OpenAI Realtime API** (`gpt-4o-realtime-preview`, voice **`cedar`**)

Your Next.js app on Vercel still serves **`/api/voice/incoming`** TwiML; the **stream URL** points here (Railway, Fly.io, Render, Google Cloud Run with WebSocket, etc.).

## Environment variables

| Variable | Required | Notes |
|----------|----------|--------|
| `OPENAI_API_KEY` | Yes | Same project key as Micah web. |
| `OPENAI_REALTIME_MODEL` | No | Default `gpt-4o-realtime-preview`. Pin a dated snapshot in production if you prefer. |
| `PORT` | No | Defaults **8080** in the Dockerfile / Fly; locally you can use `8787` (`npm run dev` / ngrok). |
| `MICAH_BRIDGE_SECRET` | **Strongly recommended** | Random string; must match Vercel **`MICAH_BRIDGE_SECRET`** (see **Realtime bridge token** below). |
| `SUPABASE_URL` | For leads | Same as micah-web. |
| `SUPABASE_SERVICE_ROLE_KEY` | For leads | Service role (server only). |
| `OPENAI_TRANSLATE_MODEL` | No | Default `gpt-4o-mini` — normalises transcript to English for `leads.raw_text`. |
| `OPENAI_BETA_HEADER` | Rarely | Default `realtime=v1` if OpenAI still expects beta header for your account. |

## Realtime bridge token (Vercel ↔ Fly)

**Both** this bridge and **micah-web** use the **same name:** **`MICAH_BRIDGE_SECRET`**. (Do not use alternate env names in Vercel — they are ignored by the app.)

**How it works**

1. On **Vercel**, set `MICAH_BRIDGE_SECRET` to the **same string** as on Fly (`fly secrets set MICAH_BRIDGE_SECRET=...`).
2. Set `MICAH_MEDIA_STREAM_WSS_URL` to the WebSocket path **without** `?token=` (e.g. `wss://micah-bridge.fly.dev/twilio`). Micah’s incoming route appends `?token=<MICAH_BRIDGE_SECRET>` when the URL does not already contain a `token` parameter.
3. On **Fly**, when `MICAH_BRIDGE_SECRET` is set, the upgrade handler requires `?token=` on the WebSocket URL to **match**; otherwise the socket is closed and logs show `[bridge] rejected WS — bad token`.

**Failure mode (silent call, valid Twilio/Vercel):** Secret is set on Fly but **`MICAH_BRIDGE_SECRET` is missing or misnamed on Vercel** → no token is appended → Fly rejects the stream. **Vercel often shows no error** (TwiML is still valid). Confirm with `fly logs` during a test call.

**Fix:** Add or rename the variable on Vercel to **`MICAH_BRIDGE_SECRET`**, match Fly, then **redeploy** Production (env changes do not apply to already-built lambdas). Rotating the secret on Fly restarts machines — do it between calls.

## Run locally

```bash
cd micah-realtime-bridge
npm install
npm run dev
```

Expose HTTPS + WSS with **ngrok** or **Cloudflare Tunnel**:

```bash
ngrok http 8787
```

Set Twilio / Vercel `MICAH_MEDIA_STREAM_WSS_URL` to `wss://YOUR_TUNNEL_HOST/twilio?token=YOUR_MICAH_BRIDGE_SECRET`.

## Deploy on Fly.io

**Option A — from repo root** (`micah-dialogflow/`, where the Micah monorepo lives): a **`Dockerfile`** and **`fly.toml`** at the root build this package via `COPY micah-realtime-bridge/...`. Run:

```bash
cd /path/to/micah-dialogflow
fly launch    # or: fly deploy
```

**Option B — from this folder only** (smaller context):

```bash
cd micah-realtime-bridge
fly launch
```

Secrets (either layout):

```bash
fly secrets set OPENAI_API_KEY=sk-...
fly secrets set SUPABASE_URL=https://xxx.supabase.co
fly secrets set SUPABASE_SERVICE_ROLE_KEY=...
fly secrets set MICAH_BRIDGE_SECRET=$(openssl rand -hex 24)
fly deploy
```

Public URL will look like `https://micah-bridge.fly.dev`. Twilio needs **`wss://`**:

- **Recommended (micah-web):** `MICAH_MEDIA_STREAM_WSS_URL=wss://micah-bridge.fly.dev/twilio` and set **`MICAH_BRIDGE_SECRET`** on Vercel — incoming TwiML appends `?token=` automatically.
- **Alternative:** embed the token in the URL: `.../twilio?token=YOUR_MICAH_BRIDGE_SECRET` (do not double-append).

(Fly terminates TLS; WebSocket upgrades work on the same host.)

## Deploy (Railway / Render / GCP)

1. Build with the included **Dockerfile** (or `npm ci && npm run build && node dist/server.js`).  
2. Set env vars in the host UI.  
3. Map **public HTTPS/WSS** to `PORT` (**8080** in the Dockerfile image; Fly overrides via `fly.toml` `internal_port`).  
4. In **Vercel** (micah-web): `MICAH_VOICE_ENGINE=realtime`, `MICAH_MEDIA_STREAM_WSS_URL=wss://.../twilio`, `MICAH_BRIDGE_SECRET` (see **Realtime bridge token** above)

## Force clean deploy (user request)

**Next.js (Vercel / local):**

```bash
cd micah-web
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue; npm run build
```

**Vercel CLI production:**

```bash
cd micah-web
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod --force
```

Or trigger **Redeploy** from the Vercel dashboard with **“Use existing Build Cache”** disabled.

**Bridge service:** redeploy the container/host after `git push`; most platforms have a **“Restart”** or **“Deploy latest”** button.
