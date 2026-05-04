# Micah web (Next.js — Vercel and/or Fly.io)

## Twilio must use the production domain

**Preview deployment URLs** (e.g. `micah-voice-engine-git-master-….vercel.app`) are often protected by **Vercel Deployment Protection** and return **401 Unauthorized** to unauthenticated clients. **Twilio cannot post voice webhooks to a 401 URL** — calls will fail or show as offline.

- In **Twilio Console → Phone Numbers → Active number → Voice & Fax**, set **A CALL COMES IN** to **Webhook** and your **live** HTTPS host — for example:  
  `https://micah.directiveos.com.au/api/voice/incoming`  
  (replace with your real **Fly.io** or **Vercel** production origin, e.g. `https://your-app.fly.dev/api/voice/incoming`).
- **Do not** use a **local tunnel** (ngrok, localhost, `127.0.0.1`) for production numbers — the handset/carrier may handle audio locally instead of your TwiML stream.
- **Do not** point Twilio at a `*.vercel.app` preview URL unless you have turned off deployment protection for previews (not recommended for public webhooks).

## Stable `<Gather action>` host

Set **`NEXT_PUBLIC_APP_URL`** in **Production** to your canonical origin (no trailing slash), e.g. `https://micah.directiveos.com.au`. Voice routes build **`/api/voice/process`** (and legacy **`/api/process`**) from this value first so Twilio’s POST URL matches your production domain even when request forwarding headers differ.

## Quick check

```bash
curl -sI "https://YOUR_DOMAIN/api/voice/incoming"
```

You should see **HTTP/2 200** (or 200) on the **same host** Twilio uses. If you get **401**, webhooks from Twilio will not work on that host.

## Voice diagnostics & security

### Masked keys (Fly / Vercel logs)

- OpenAI audit logs use **`sk-…` + last 4 chars** (via `maskApiCredential`) — never the full `OPENAI_API_KEY`.
- **`GET /api/voice/diagnostic`** returns **`checks.elevenLabs.apiKeyMask`**, **`checks.openAi.apiKeyMask`**, and **`checks.supabase.serviceRoleMask`** so you can confirm secrets are **configured** without exposing them. **`describeElevenLabsKeyForDiagnostics()`** in `lib/elevenlabs-tts.ts` (also re-exported from `lib/openai/micah-voice-chat.ts`) matches that behaviour.

### Log hygiene

- **`twimlResponse`** logs **TwiML length only** by default (avoids huge XML / long `<Play>` URLs in consoles). Set **`MICAH_DEBUG_TWIML=1`** only when you need a body preview.
- Legacy **`/api/process`** logs a small Twilio meta object (e.g. `CallSid`, `From`, `To`) — not full `form` dumps.

### Aussie Micah one-line health check

ElevenLabs voice id **`4Nz4vG2f9omkfcS8r4PJ`** is **hardcoded** in `lib/elevenlabs-tts.ts` (not set by env). Use the diagnostic to confirm the **full pipeline** (keys + bucket + Supabase client + OpenAI for gather replies):

```bash
curl -s "https://micah.directiveos.com.au/api/voice/diagnostic" | jq .overallStatus,.blockedReasons
```

- **`green`**: `elevenLabsSynthReady` is true (EL key + `SUPABASE_TTS_BUCKET` + service role + project URL + working Supabase client), **and** `OPENAI_API_KEY` is set for `/api/voice/process` chat turns.
- **`yellow`**: Some env vars look present but synth is not ready — inspect **`blockedReasons`** and **`checks`** in the JSON.
- **`red`**: Critical env missing — **`blockedReasons`** lists what to fix (e.g. `no ELEVENLABS_API_KEY`, `no SUPABASE_TTS_BUCKET`).

## Vercel environment variables

After changing env vars, **redeploy Production**. See `.env.example` for `MICAH_VOICE_ENGINE`, `MICAH_MEDIA_STREAM_WSS_URL`, `MICAH_BRIDGE_SECRET`, `OPENAI_API_KEY`, `TWILIO_AUTH_TOKEN`, etc.

## Fly.io (`micah-web`)

The repo root `fly.toml` builds **`micah-realtime-bridge`** only. To run **this** Next app on Fly:

1. `cd micah-web`
2. If you have not created the Fly app yet: `fly launch --copy-config` (adjust `app` in `micah-web/fly.toml` to your chosen name).
3. Set secrets to mirror production (at minimum):  
   `ELEVENLABS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_TTS_BUCKET`, `OPENAI_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, **`NEXT_PUBLIC_APP_URL`** (must be `https://<your-fly-hostname>` or your custom domain so Twilio `<Gather action>` hits this deployment).
4. `fly deploy`

ElevenLabs voice id is **not** configurable via env — it is the constant `MICAH_ELEVENLABS_VOICE_ID` in `lib/elevenlabs-tts.ts` only.

### Fly build: “Failed to fetch git submodules”

That happens when the repo index contains a **gitlink** (mode `160000`) without a matching `.gitmodules` entry — often from a Cursor **`.claude/worktrees/…`** path accidentally committed as a submodule. Fix: `git rm --cached -r .claude/worktrees/<name>`, add `.claude/worktrees/` to the repo **`.gitignore`**, commit, and push before `fly deploy`.

### `npm warn deprecated scmp@2.1.0`

**Twilio**’s Node SDK still depends on `scmp` for constant-time compares. It is a harmless install warning until Twilio ships a release without that dependency.

## Realtime voice

The **OpenAI Realtime** media bridge runs on **Fly.io** (`micah-realtime-bridge`), not on Vercel. See `../micah-realtime-bridge/README.md`.

## Twilio debugger errors (quick reference)

| Code | Meaning | Typical fix in this project |
|------|---------|-----------------------------|
| **31941** | Stream — invalid `track` on `<Connect><Stream>` | Only **`inbound_track`** is allowed with `Connect` (not `both_tracks`). See `app/api/voice/incoming/route.ts`. |
| **13520** | Say — invalid text / voice+language mismatch | All `<Say>` fallbacks use **`Polly.Olivia`** + **`en-AU`** only. If Twilio still errors, check Twilio Console for region/voice availability. |

### Silence on realtime calls

| Symptom | Cause | Fix |
|---------|--------|-----|
| Dead air after answer | OpenAI Realtime with **server VAD** waits for **caller** audio before speaking | **Fly bridge** must send an opening turn (`conversation.item.create` + `response.create`) — implemented in `micah-realtime-bridge`. |
| Very start of call quiet | Stream connects before first PCM | **Vercel** TwiML includes a short **`<Say>`** before `<Connect>` (`MICAH_REALTIME_PRECONNECT_SAY` or default). |

Debug: **Vercel logs** `[micah/voice/incoming]` — **Fly logs** `[openai] opening turn`, `[bridge] first outbound audio chunk sent to Twilio`.
