# Micah AI Receptionist — Agent instructions (Directive OS)

This repo implements **Micah**: a young, warm, **always-female** Australian receptionist for Directive OS across voice (Twilio), web chat, and tenant flows. Treat this file as the **canonical persona contract** when changing prompts, TTS, or call handling.

## Non-negotiables

- **Voice**: ElevenLabs Micah only — constant **`MICAH_ELEVENLABS_VOICE_ID`** = `4Nz4vG2f9omkfcS8r4PJ` in `micah-web/lib/elevenlabs-tts.ts` (hardcoded; no env). Never swap to male, Alice, or generic Twilio defaults.
- **`<Say>` fallback**: Only **Polly.Olivia** + **en-AU** via `micahDirectiveOsSayAttributes()` in `micah-web/lib/micah/twilio-voice.ts`. No bare `.say()` without those attributes anywhere.
- **Static `<Play>` URLs** (`MICAH_GREETING_MP3_URL`, `MICAH_FALLBACK_MP3_URL`): not ElevenLabs — if the file is male/wrong, callers hear that. Remove or replace bad assets; rely on EL + `MICAH_ELEVENLABS_VOICE_ID` when unsure.
- **No silence**: Never ship TwiML that leaves the caller with only `<Pause>` or empty audio. If synthesis fails, they still hear Polly.Olivia reading an apology or script.
- **In-character**: Micah never identifies as an AI, bot, assistant, chatbot, or automated system. Never say “assistant” or “bot” in persona-facing copy.

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

`micah-web/lib/micah/voice-output.ts` — `micahVoice()` + `applyMicahVoice()` are the single pipeline for Aussie EL → static MP3 → Polly.Olivia. Incoming webhook uses `preferredPlayUrl` (`MICAH_GREETING_MP3_URL`) for instant `<Play>` when set; otherwise bounded EL timeout (`defaultElevenLabsTtsTimeoutMs`, default 1500ms).

## Observability

Prefer structured logs: `CallSid`, `From`/`To`, inbound route, whether empathy TTS was applied, **outgoing `mp3Url`** on `<Play>` paths, and explicit **why** on Polly or static fallbacks (`[micah/voice]`, `[micah/voice/apply]`, `[micah/voice/process]`).

Many voice log payloads include **`micahVoiceQA: true`** and an **`event`** string so **Vercel → Project → Logs** can filter on one token.

### Vercel (current host) — deploy checklist & QA

1. **Deploy** `micah-web` to production; confirm Twilio **Voice webhook** URL is your **production** Vercel origin (not a preview URL behind auth).
2. **Vercel → Settings → Environment Variables (Production)**  
   - Remove any legacy **`AUSSIE_MICAH_VOICE_ID`**, **`ELEVENLABS_VOICE_ID`**, or other “voice id” env vars — they are **not read**; only **`MICAH_ELEVENLABS_VOICE_ID`** in code (`4Nz4vG2f9omkfcS8r4PJ`) is used for ElevenLabs.  
   - Required for EL path: **`ELEVENLABS_API_KEY`**, **`SUPABASE_URL`** (or **`NEXT_PUBLIC_SUPABASE_URL`**), **`SUPABASE_SERVICE_ROLE_KEY`**, **`SUPABASE_TTS_BUCKET`**, **`OPENAI_API_KEY`** (for gather replies).  
   - **`MICAH_GREETING_MP3_URL` / `MICAH_FALLBACK_MP3_URL`**: optional `<Play>` assets — **not** synthesised by ElevenLabs. If a male/wrong MP3 is hosted here, callers hear it. Clear or replace unless the file is verified female Aussie Micah.
3. **After one test call**, in Vercel Logs search: **`micahVoiceQA`**  
   - **`event: "elevenlabs_tts_ok"`** / **`micah_voice_el_play_url`** → EL wire path used; **`voiceId`** / **`micahElevenLabsVoiceId`** must be **`4Nz4vG2f9omkfcS8r4PJ`**.  
   - **`event: "twiml_play_static_mp3"`** → static greeting `<Play>`; audit **`mp3Url`** (wrong file = wrong gender).  
   - **`event: "micah_voice_polly_olivia_say"`** / **`twiml_apply_say_polly_olivia`** → Polly fallback only (**female en-AU**).
4. **API**: `GET https://<your-vercel-domain>/api/voice/diagnostic` — confirm **`checks.micahElevenLabsVoiceId`** and **`overallStatus`** / **`blockedReasons`**.

### Cross-check (repo audit — done)

- **No** `AUSSIE_MICAH_VOICE_ID` and **no** `process.env.ELEVENLABS_VOICE_ID` (or any env-driven ElevenLabs voice id) in `micah-web`.  
- **Single** ElevenLabs URL builder: `convertTextToSpeech` in `lib/elevenlabs-tts.ts` using **`MICAH_ELEVENLABS_VOICE_ID`**.  
- **All** Twilio `.say(` paths use **`micahDirectiveOsSayAttributes()`** → **Polly.Olivia** + **en-AU** only.  
- **Hidden wrong-voice risk**: wrong **static MP3** URL, or **Realtime bridge** (separate host) using non-Micah audio — outside this Next bundle; treat static URLs as production config.

### Cursor session paste (context block)

Copy the following into a Cursor task, chat, or PR description when working on voice:

**Strict requirements for all voice outputs on DirectiveOS:**

- Never use `AUSSIE_MICAH_VOICE_ID`, `ELEVENLABS_VOICE_ID`, or any env-based indirection for voice selection in code.
- Only use hardcoded **`MICAH_ELEVENLABS_VOICE_ID`** = `4Nz4vG2f9omkfcS8r4PJ` for ElevenLabs (`micah-web/lib/elevenlabs-tts.ts`).
- All Polly fallbacks must be **Polly.Olivia** (female AU) with **`micahDirectiveOsSayAttributes()`** in `micah-web/lib/micah/twilio-voice.ts` — never default, Alice, or male.
- For every voice path (EL, Polly, MP3), log **`micahVoiceQA: true`** and include **`event`**, **`voiceId`** (the hardcoded Micah EL id for app-wide audit), and pipeline notes (`lib/elevenlabs-tts.ts`, `lib/micah/voice-output.ts`, `lib/micah/twilio-voice.ts`, routes).
- Static greeting/fallback MP3 URLs (`MICAH_GREETING_MP3_URL` / `MICAH_FALLBACK_MP3_URL`) must only refer to files with a **verified** female Aussie Micah voice — if not, clear or correct them.
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
| Polly-only helpers | `micah-web/lib/micah/twilio-voice.ts` |
| Voice webhook | `micah-web/app/api/voice/process/route.ts`, `incoming/route.ts` |

When adding features, preserve **persona**, **gender/voice lock**, and the **no-silence** guarantee.
