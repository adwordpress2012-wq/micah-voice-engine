# Micah AI Receptionist — Agent instructions (Directive OS)

This repo implements **Micah**: a young, warm, **always-female** Australian receptionist for Directive OS across voice (Twilio), web chat, and tenant flows. Treat this file as the **canonical persona contract** when changing prompts, TTS, or call handling.

## Non-negotiables

- **Voice**: ElevenLabs Micah only — constant **`MICAH_ELEVENLABS_VOICE_ID`** = `4Nz4vG2f9omkfcS8r4PJ` in `micah-web/lib/elevenlabs-tts.ts` (hardcoded; no env). Never swap to male, Alice, Polly, or generic Twilio defaults.
- **BRAND-STRICT POLICY**: All spoken output must originate from ElevenLabs Aussie Micah voice OR pre-recorded static MP3 audio approved by Directive OS. Polly/Olivia, default Twilio system voices, or any other fallback are forbidden. Fallback to silence is acceptable only when all assets are unavailable. No `<Say>` verbs, no `.say()` calls, no `MICAH_POLLY_VOICE` env var.
- **TwiML helpers**: Use `playOrFallbackMp3` / `gatherPlayOrFallbackMp3` from `micah-web/lib/micah/twilio-voice.ts`. They emit `<Play>` for the EL URL, fall back to `MICAH_FALLBACK_MP3_URL <Play>`, then `<Pause>` if both are unavailable. The legacy `playOrPollyOliviaSay` / `gatherPlayOrPollyOliviaSay` / `micahDirectiveOsSayAttributes` are deleted.
- **Static `<Play>` URLs** (`MICAH_GREETING_MP3_URL`, `MICAH_FALLBACK_MP3_URL`): not ElevenLabs — if the file is male/wrong, callers hear that. Verify all uploaded assets are the Aussie Micah voice.
- **Silence**: Acceptable last resort under brand policy when both ElevenLabs and `MICAH_FALLBACK_MP3_URL` are unavailable. Logged loudly via `[micah/voice] … SILENT` so the operator can fix it. Never preferred over a wrong voice.
- **In-character**: Micah never identifies as an AI, bot, assistant, chatbot, or automated system. Never say "assistant" or "bot" in persona-facing copy.

## Canonical greeting

Always greet with (agency name defaults to **Directive OS** via `MICAH_AGENCY_NAME` / `getMicahAgencyName()`):

> G'day! You've reached Directive OS, I'm Micah. How can I help you today?

Spoken sources: `micah-web/lib/micah/voice-greetings.ts` (`micahGatherOpeningSay`, `micahRealtimePreconnectSay`). Env overrides: `MICAH_GATHER_GREETING`, `MICAH_REALTIME_PRECONNECT_SAY`.

## Routing (main vs demo)

`classifyMicahVoiceInbound` in `micah-web/lib/micah/micah-directive-os-persona.ts` selects **demo** vs **main** by dialed number; `buildMicahDirectiveGatherSystemPrompt` / `buildMicahDirectiveProcessSystemPrompt` inject the correct line rules (real estate handling differs per line).

## Empathy + ElevenLabs tuning

- **Default** synthesis: `stability: 0.5`, `similarity_boost: 0.8` (`convertTextToSpeech` in `micah-web/lib/elevenlabs-tts.ts`).
- **Empathetic** utterances (illness, urgency, distress, etc.): `stability: 0.78`, `similarity_boost: 0.82` — see `micah-web/lib/micah/micah-empathy-tts.ts` (`textSuggestsEmpatheticTts`, `micahElevenLabsOptsForUtterance`).
- **Extend triggers** by editing `EMPATHY_PATTERN` in that file only; keep voice routes passing `micahElevenLabsOptsForUtterance(spokenText)` into `elevenLabsTtsPublicMp3UrlWithTimeout` / `elevenLabsTtsPublicMp3Url`.

## Centralized voice output

`micah-web/lib/micah/voice-output.ts` — `micahVoice()` + `applyMicahVoice()` are the single pipeline for Aussie EL → `MICAH_FALLBACK_MP3_URL` static MP3 → silent `<Pause>` (brand policy: no Polly). Incoming webhook uses `preferredPlayUrl` (`MICAH_GREETING_MP3_URL`) for instant `<Play>` when set; otherwise bounded EL timeout (`defaultElevenLabsTtsTimeoutMs`, default 1500ms).

## Observability

Prefer structured logs: `CallSid`, `From`/`To`, inbound route, whether empathy TTS was applied, **outgoing `mp3Url`** on `<Play>` paths, and explicit **why** on `MICAH_FALLBACK_MP3_URL` or silent fallbacks (`[micah/voice]`, `[micah/voice/apply]`, `[micah/voice/process]`).

Many voice log payloads include **`micahVoiceQA: true`** and an **`event`** string so **Vercel → Project → Logs** can filter on one token.

## Deployment: single source of truth (`master` + Vercel)

**Primary rule:** Production on Vercel must reflect the **current `master` branch on GitHub** — correct code, env, and assets. Do not deploy from a stale clone, unmerged local-only work, or the wrong branch.

### Git workflow (before every ship)

1. `git fetch origin && git checkout master && git pull origin master` — local **`master`** must match **`origin/master`** before you commit or push.
2. From repo root: `cd micah-web && npx tsc --noEmit` — TypeScript must pass.
3. Commit with a clear message; **`git push origin master`** — this is the canonical trigger when Vercel is connected to auto-deploy **`master`**.
4. On GitHub, confirm the latest commit is on **`master`** (not only on your machine).

### Vercel

- Prefer **automatic production deploy** on push to **`master`**. If needed, **Vercel Dashboard → Deployments → Redeploy** the latest deployment that shows source branch **`master`** and the expected commit SHA.
- Confirm Twilio **Voice webhook** URL points at your **production** Vercel origin (not a preview URL behind Deployment Protection).

### Environment variables (Production and Preview)

- **Remove obsolete:** `AUSSIE_MICAH_VOICE_ID`, `ELEVENLABS_VOICE_ID` — the app does **not** read them for voice selection; they confuse operators.
- **Required for ElevenLabs path:** `ELEVENLABS_API_KEY`, `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`), `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_TTS_BUCKET`, `OPENAI_API_KEY` (gather replies).
- **Static MP3 (optional):** `MICAH_GREETING_MP3_URL`, `MICAH_FALLBACK_MP3_URL` — must be **verified female Aussie Micah** audio only; wrong files bypass EL. In ops, you may record an approved asset hash and compare after uploads.

### Compliance (invariants)

- ElevenLabs: only **`MICAH_ELEVENLABS_VOICE_ID`** = `4Nz4vG2f9omkfcS8r4PJ` in `micah-web/lib/elevenlabs-tts.ts` — no env override.
- Static MP3 fallback: **`MICAH_FALLBACK_MP3_URL`** + **`MICAH_GREETING_MP3_URL`** (must be Aussie Micah voice files).
- Silent `<Pause>` only when both EL and `MICAH_FALLBACK_MP3_URL` are unavailable. Logged loudly. Polly is forbidden.
- Logs: voice paths emit **`micahVoiceQA: true`**, **`event`**, **`voiceId`** (and pipeline notes) — see `lib/micah/twilio-voice.ts`, `lib/micah/voice-output.ts`, `lib/elevenlabs-tts.ts`, voice routes.

### After deploy — QA

1. Place a **test call** (or exercise web voice if applicable).
2. **Vercel → Logs** — filter **`micahVoiceQA`**. Expect **`voiceId`** / **`micahElevenLabsVoiceId`** = `4Nz4vG2f9omkfcS8r4PJ` on EL paths; **`twiml_play_static_mp3`** for `MICAH_FALLBACK_MP3_URL` plays; **`twiml_apply_silent_pause`** (logged red) when both EL and the fallback MP3 are unavailable. Any reference to `Polly` in logs is a regression — search and remove.
3. `GET https://<your-production-domain>/api/voice/diagnostic` — **`checks.micahElevenLabsVoiceId`**, **`overallStatus`**, **`blockedReasons`**.

### Cursor / AI mandate

Any change that is meant to ship must end up on **`origin/master`** and in **Vercel production**: commit, push, verify deploy — do not leave fixes only local or on a side branch if production must match **`master`**. Do not reintroduce legacy voice env vars, Dialogflow-era Twilio wiring, `MICAH_POLLY_VOICE`, or any Polly fallback on **`master`** or in Vercel env. Brand policy: ElevenLabs Aussie Micah OR `MICAH_FALLBACK_MP3_URL` ONLY.

### Full sync: environment, code, and docs (mandatory)

**Sources of truth:**

| What | Where |
|------|--------|
| Application **code** and **committed docs** | **`master` on GitHub** — always pull before work; stage, commit, push every intentional change. Nothing production-critical should exist only in Cursor or an unpushed branch. |
| **Runtime secrets** (API keys, service role, Twilio tokens) | **Vercel Production** (and Preview if you use it) — not in chat, not only on a developer laptop. |
| **Local development** | **`micah-web/.env`** or **`micah-web/.env.local`** — copy variable **names** from **`micah-web/.env.example`**; paste **values** from your secrets manager or Vercel export. Same keys must exist in Vercel for production with production values. |

**Before declaring production aligned:**

1. **Git:** `git status` clean on **`master`**; **`git push origin master`** done; GitHub shows the latest commit.
2. **Vercel:** Production env includes at minimum the keys required for voice green — see **`micah-web/.env.example`** and **`buildVoiceEnvDiagnostics`** (`ELEVENLABS_API_KEY`, `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_TTS_BUCKET`, `OPENAI_API_KEY`, plus **`NEXT_PUBLIC_APP_URL`** for Twilio gather URLs). Redeploy after env edits.
3. **Diagnostic:** `GET /api/voice/diagnostic` on the **production** host — target **`overallStatus`: `"green"`** and **`blockedReasons`: []** (empty). **`yellow`** / **`red`** mean fix env or connectivity before treating prod as healthy.
4. **Documentation:** If you add or rename env vars, update **`micah-web/.env.example`** and this **`AGENTS.md`** (and **`README.md`** if operators need a runbook change), then **commit and push** those doc updates with the code.

Never leave a secret or production-only config **only** in Cursor, local `.env`, or a paste — mirror required keys into **Vercel** and keep **`.env.example`** accurate for names and intent.

### Cross-check (repo audit — done)

- **No** `AUSSIE_MICAH_VOICE_ID` and **no** `process.env.ELEVENLABS_VOICE_ID` (or any env-driven ElevenLabs voice id) in `micah-web`.  
- **Single** ElevenLabs URL builder: `convertTextToSpeech` in `lib/elevenlabs-tts.ts` using **`MICAH_ELEVENLABS_VOICE_ID`**.  
- **Zero** Twilio `.say(` paths and zero `<Say>` verbs in code (brand policy: no Polly). All audio is `<Play>` of an ElevenLabs URL or `MICAH_FALLBACK_MP3_URL`.
- **Hidden wrong-voice risk**: wrong **static MP3** URL, or **Realtime bridge** (separate host) using non-Micah audio — outside this Next bundle; treat static URLs as production config.

### Cursor session paste (context block)

Copy the following into a Cursor task, chat, or PR description when working on voice:

**Strict requirements for all voice outputs on DirectiveOS:**

- Never use `AUSSIE_MICAH_VOICE_ID`, `ELEVENLABS_VOICE_ID`, or any env-based indirection for voice selection in code.
- Only use hardcoded **`MICAH_ELEVENLABS_VOICE_ID`** = `4Nz4vG2f9omkfcS8r4PJ` for ElevenLabs (`micah-web/lib/elevenlabs-tts.ts`).
- **Polly is forbidden.** No `<Say>` verbs, no `.say()` calls, no `MICAH_POLLY_VOICE` env var, no `Polly.Olivia` references in voice code paths. The legacy `micahDirectiveOsSayAttributes` / `playOrPollyOliviaSay` / `gatherPlayOrPollyOliviaSay` helpers are deleted; use **`playOrFallbackMp3`** / **`gatherPlayOrFallbackMp3`** which emit `<Play>` of `MICAH_FALLBACK_MP3_URL` or `<Pause>` (silent — logged) instead.
- For every voice path (EL, MP3 fallback, silent), log **`micahVoiceQA: true`** and include **`event`**, **`voiceId`** (the hardcoded Micah EL id for app-wide audit), and pipeline notes (`lib/elevenlabs-tts.ts`, `lib/micah/voice-output.ts`, `lib/micah/twilio-voice.ts`, routes).
- Static greeting/fallback MP3 URLs (`MICAH_GREETING_MP3_URL` / `MICAH_FALLBACK_MP3_URL`) must only refer to files with a **verified** Aussie Micah voice — if not, clear or correct them.
- Always run **`npx tsc --noEmit`** in `micah-web` before deploy.
- After deploying, verify via **live test call** and check **Vercel logs** for `voiceId` = `4Nz4vG2f9omkfcS8r4PJ` and **`micahVoiceQA`** events.

Do not allow any indirect voice logic or accidental overrides in future code or docs.

## Key files

| Area | File |
|------|------|
| Locked LLM persona + greeting + routing | `micah-web/lib/micah/micah-directive-os-persona.ts` |
| Voice gather persona wrapper (Jayson / Statewide layer) | `micah-web/lib/openai/micah-voice-chat.ts` |
| Gather strings + env overrides | `micah-web/lib/micah/voice-greetings.ts` |
| Empathy keyword + EL opts | `micah-web/lib/micah/micah-empathy-tts.ts` |
| Sole ElevenLabs voice id constant | `micah-web/lib/elevenlabs-tts.ts` (`MICAH_ELEVENLABS_VOICE_ID`) |
| EL + Supabase upload | `micah-web/lib/micah/elevenlabs-tts.ts` |
| TwiML `<Play>`-or-`MICAH_FALLBACK_MP3_URL` helpers (no Polly) | `micah-web/lib/micah/twilio-voice.ts` |
| Voice webhook | `micah-web/app/api/voice/process/route.ts`, `incoming/route.ts` |

When adding features, preserve **persona**, **gender/voice lock**, and the **no-silence** guarantee.
