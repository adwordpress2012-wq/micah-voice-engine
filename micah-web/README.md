# Micah web (Next.js / Vercel)

## Twilio must use the production domain

**Preview deployment URLs** (e.g. `micah-voice-engine-git-master-….vercel.app`) are often protected by **Vercel Deployment Protection** and return **401 Unauthorized** to unauthenticated clients. **Twilio cannot post voice webhooks to a 401 URL** — calls will fail or show as offline.

- Set the Twilio number’s **Voice webhook** to your **stable production URL**, for example:  
  `https://micah.directiveos.com.au/api/voice/incoming`  
  (or your custom production domain connected to the **Production** deployment).
- **Do not** point Twilio at a `*.vercel.app` preview URL unless you have turned off deployment protection for previews (not recommended for public webhooks).

## Quick check

```bash
curl -sI "https://YOUR_DOMAIN/api/voice/incoming"
```

You should see **HTTP/2 200** (or 200) on the **same host** Twilio uses. If you get **401**, webhooks from Twilio will not work on that host.

## Vercel environment variables

After changing env vars, **redeploy Production**. See root `.env.example` for `MICAH_VOICE_ENGINE`, `MICAH_MEDIA_STREAM_WSS_URL`, `MICAH_BRIDGE_SECRET`, `OPENAI_API_KEY`, `TWILIO_AUTH_TOKEN`, etc.

## Realtime voice

The **OpenAI Realtime** media bridge runs on **Fly.io** (`micah-realtime-bridge`), not on Vercel. See `../micah-realtime-bridge/README.md`.

## Twilio debugger errors (quick reference)

| Code | Meaning | Typical fix in this project |
|------|---------|-----------------------------|
| **31941** | Stream — invalid `track` on `<Connect><Stream>` | Only **`inbound_track`** is allowed with `Connect` (not `both_tracks`). See `app/api/voice/incoming/route.ts`. |
| **13520** | Say — invalid text / voice+language mismatch | Use an Amazon Polly voice that matches **`language="en-AU"`** (default **`Polly.Nicole`**). **`Polly.Olivia`** with **en-AU** often triggers this. Override with **`MICAH_POLLY_VOICE`** if needed. |
