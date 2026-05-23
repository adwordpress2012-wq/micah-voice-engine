# Aussie Micah DOS SBA Demo Template

This template explains how to duplicate the working Aussie Micah DOS Smart Business Assistant voice demo for future clients, niches, or industry packs without damaging the production demo.

## Current Working Architecture

Call flow:

```text
Twilio number
  -> https://micah.directiveos.com.au/api/voice/incoming
  -> https://micah.directiveos.com.au/api/voice/process
  -> OpenAI / ElevenLabs / static Aussie Micah demo MP3 fallback
  -> Twilio TwiML response with <Play> audio
```

The working DOS SBA demo uses a locked Twilio gather flow:

- `/api/voice/incoming` answers the call and plays the locked DOS SBA greeting.
- `/api/voice/process` receives `SpeechResult` from Twilio.
- Common demo questions use public static Aussie Micah MP3 answers for reliability.
- After every answer, the next `<Gather>` listens silently. Do not add filler audio to normal follow-up gathers.
- If Twilio returns no speech, play "Sorry, could you please repeat that?" at most twice, then play the DOS goodbye and hang up.
- The dynamic AI path remains available for later improvement, but it must not be trusted as the only path for live demo FAQs.
- Spoken output must be ElevenLabs Aussie Micah or approved static Aussie Micah MP3 audio.

## Why Static Demo Answers Exist

The live demo must work even when dynamic services are slow, quota-limited, or unavailable. Static MP3 answers avoid:

- Twilio timing out while waiting for OpenAI, ElevenLabs, or Supabase.
- Supabase upload failures blocking playable audio.
- Signed `/api/voice/tts` URLs failing during Twilio media fetch.
- The caller hearing only the old filler clip.

Static answers are not a replacement for the AI path. They are a reliability layer for common live demo questions.

## Setup Checklist For A New Client Voice Demo

1. Decide the client or industry pack.
2. Write the locked greeting in the client voice/persona.
3. Write 5 to 10 common questions and short spoken answers.
4. Generate approved voice MP3s using the correct ElevenLabs voice.
5. Add static MP3s to `public/` or a public approved audio host.
6. Add a narrow intent fast path for only the common demo questions.
7. Keep the dynamic OpenAI path for all other questions.
8. Test the Twilio webhook with signed requests.
9. Place a real test call.
10. Check Vercel logs for `micahVoiceQA`.

## Environment Variable Checklist

Required for the current Micah voice stack:

- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`
- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_TTS_BUCKET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `NEXT_PUBLIC_APP_URL`

Optional but useful:

- `MICAH_GREETING_MP3_URL`
- `MICAH_FALLBACK_MP3_URL`
- `MICAH_AGENCY_NAME`
- `MICAH_DEMO_RECEPTION_NUMBER`
- `MICAH_MAIN_DIRECTIVE_NUMBER`

Do not add or rely on env-driven ElevenLabs voice IDs. The Micah ElevenLabs voice is locked in code.

## Twilio Webhook Checklist

- Voice webhook points to `https://micah.directiveos.com.au/api/voice/incoming`.
- HTTP method is `POST`.
- Gather action points to `https://micah.directiveos.com.au/api/voice/process`.
- Speech recognition language is Australian English where supported.
- Production Twilio number is not pointed at a preview deployment.
- The webhook URL is not behind Vercel Deployment Protection.
- Test with a real phone call after every voice change.

## Vercel Deployment Checklist

- Work from `master`.
- Pull latest `origin/master` before changing files.
- Run `npx tsc --noEmit`.
- Run `npm run build` for voice-flow changes.
- Commit clearly.
- Push to `origin/master`.
- Confirm Vercel production deploy points to the expected commit.
- Confirm `https://micah.directiveos.com.au` is aliased to the new production deployment.
- Check `/api/voice/diagnostic`.
- Check Vercel logs for `micahVoiceQA`.

## Do Not Break Rules

- Do not change the working DOS SBA greeting unless explicitly approved.
- Do not change the Aussie Micah ElevenLabs voice ID.
- Do not add Polly, Twilio `<Say>`, Alice, male voices, or generic TTS fallback.
- Do not remove static demo MP3 answers for common questions.
- Do not re-enable YourAtlas, AQX, Cedar, or realtime for the Lite demo.
- Do not change Twilio webhook paths without approval.
- Do not move the production domain without approval.
- Do not rewrite the voice stack for a small demo change.
- Do not touch DOS Hub, AgentMate, QuoteOS, SCW, or unrelated apps when working on this voice demo.
