---
name: run-micah-web
description: Run, verify, deploy, or smoke-test the Micah voice API (Next.js). Use when asked to run, start, screenshot, verify, deploy, or test the Micah voice app.
---

# run-micah-web

Micah is a Next.js 15 serverless app deployed on Vercel at https://micah.directiveos.com.au. It exposes Twilio voice webhooks: `/api/voice/incoming` (greeting + gather) and `/api/voice/process` (AI reply loop). There is no browser UI — all interaction is via Twilio or curl.

## Prerequisites

- Node 18+, npm
- Bash (for smoke driver)
- Vercel CLI: `npm i -g vercel`

## Build

```bash
cd micah-web
npm install
npx tsc --noEmit
npm run build
```

## Run (agent path) — smoke-test driver

The driver is `.claude/skills/run-micah-web/smoke.sh`. Run it against production (no local server needed):

```bash
bash .claude/skills/run-micah-web/smoke.sh
# or against a specific URL:
bash .claude/skills/run-micah-web/smoke.sh https://micah.directiveos.com.au
```

Checks: GET both voice routes, POST empty-speech → silent Gather, confirms no "listening" in TwiML, verifies all static MP3 assets return 200.

## Deploy to Vercel production

```bash
cd C:\Users\JAYSON\DOS PROJECTS\micah-voicelab
npx vercel --prod
```

Run from the **parent** directory (`micah-voicelab`), not from `micah-web` — the Vercel project root is there. After deploy, Vercel auto-aliases `https://micah.directiveos.com.au`.

## Run (human path)

```bash
cd micah-web
npm run dev
# → http://localhost:3000
```

Dev server only; Twilio webhooks require a public URL (ngrok or deployed).

## Key voice flow

1. Twilio calls `POST /api/voice/incoming` (webhook on phone number)
2. Returns `<Gather>` with DOS greeting MP3 inside
3. Caller speech → `POST /api/voice/process` with `SpeechResult`
4. Demo FAQ check: "What is DOS?" / websites / pricing → static MP3 (no LLM)
5. Everything else → OpenAI → ElevenLabs TTS → `<Play>` + `<Gather>`
6. Empty speech (silence): first time plays `micah-repeat.mp3`, second time TTS goodbye + hangup

## Gotchas

- Deploy must be run from `micah-voicelab/` (parent dir), not `micah-web/`. Running `vercel --prod` inside `micah-web/` gives "path does not exist" error.
- Vercel deployment URLs (e.g. `micah-XYZ.vercel.app`) require Vercel SSO auth when accessed directly. Use `micah.directiveos.com.au` for testing.
- `MICAH_FALLBACK_MP3_URL` is NOT set in Vercel production env — ElevenLabs is the only audio source in prod; if EL fails, caller hears silence (by brand policy, no Polly fallback).
- Twilio signature validation rejects any request without a valid `x-twilio-signature`; invalid requests get a silent `<Gather>` with no audio.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deploy error "path does not exist" | Run `vercel --prod` from `micah-voicelab/` not `micah-web/` |
| "I'm listening" heard on call | Run this skill — strip logic in `sanitizeForMicahSpeech` and `NO_REPEAT_GREETING_OVERRIDE` block it |
| Static MP3 returns 404 | File missing from `micah-web/public/`. Check filenames against constants in `app/api/voice/process/route.ts` |
| TypeScript errors | Run `npx tsc --noEmit` from `micah-web/` before committing |
