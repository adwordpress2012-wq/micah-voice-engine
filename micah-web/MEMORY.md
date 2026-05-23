# Working State Memory: Aussie Micah DOS SBA Demo

This file records the protected working state of the Aussie Micah DOS Smart Business Assistant demo.

## Current Production State

- Production domain: `https://micah.directiveos.com.au`
- DOS demo number: `02 5950 6382`
- Voice persona: Aussie Micah, friendly young Australian receptionist tone.
- Demo role: DOS Smart Business Assistant.
- Status: working live demo. Protect this state.

## What Finally Worked

- YourAtlas and AQX were bypassed for this Lite demo.
- Realtime and Cedar were disabled for this Lite demo.
- Aussie Micah ElevenLabs voice was restored and locked.
- DOS SBA greeting was locked.
- Twilio now uses the gather flow through:
  - `/api/voice/incoming`
  - `/api/voice/process`
- Static Aussie Micah MP3 answers are used for common demo questions.
- Static demo answers prevent the caller from hearing only an old filler clip when dynamic audio fails.
- The dynamic AI path can be improved later, but it is not the protected reliability path for common demo questions.

## Protected Working Demo Answers

The working demo has static MP3 answers for these common questions:

- What is DOS?
- Do you build websites?
- What does pricing look like?

These static answers must not be removed unless a replacement has already been tested with a live Twilio call.

## Known Failure That Was Fixed

The caller heard the DOS greeting, asked "What is DOS?", and then heard the old filler prompt repeatedly instead of the answer.

The real issue was that dynamic reply audio could fail or be skipped before the gather prompt:

- OpenAI could return the right text.
- ElevenLabs could generate or fail depending on quota.
- Supabase upload could fail.
- Signed `/api/voice/tts` could be too fragile for Twilio media fetch.
- Twilio would then reach the next gather and play the old filler clip.

The fix was to make common demo questions return static public Aussie Micah MP3 answer `<Play>` first, then gather again.

## Silence Handling Fix

Normal follow-up gathers must listen silently after Micah answers. Do not place filler audio or extra prompts inside the follow-up gather loop.

When Twilio posts back with no `SpeechResult`, Micah may play:

"Sorry, could you please repeat that?"

That repeat prompt is capped at two no-speech turns in the same call. After repeated silence, Micah says:

"No worries, Jayson can follow up if you need help. Thanks for calling DOS."

Then the call hangs up gracefully.

## Protection Rule

This is a working demo. Do not replace it with a broad rewrite, a different voice engine, a different routing stack, or an untested dynamic-only flow.
