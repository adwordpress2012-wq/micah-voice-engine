# Micah Voice Change Operating Guide

Use this guide when making Codex or Cursor changes to the Aussie Micah DOS SBA voice demo.

## Prime Directive

Protect the working live demo first. Make small, reversible changes only.

## Hard Rules

- Protect the working DOS SBA greeting.
- Protect the Aussie Micah voice.
- Never re-enable YourAtlas, AQX, Cedar, or realtime for this Lite demo.
- Never remove the static demo MP3 fallback.
- Do not put filler audio inside normal follow-up gathers.
- After Micah answers, the next gather should listen silently.
- Only play "Sorry, could you please repeat that?" after Twilio returns no speech, and cap it at two repeats before the DOS goodbye hangup.
- Do not change the Twilio webhook path unless explicitly approved.
- Do not add Twilio `<Say>`, Polly, Alice, male voices, or generic TTS fallback.
- Do not replace the Twilio gather flow with a new architecture without approval.
- Do not do a full rewrite.
- Do not touch DOS Hub, AgentMate, QuoteOS, SCW, or unrelated apps.

## Required Checks

Run these before treating a voice change as safe:

```powershell
npx tsc --noEmit
npm run build
```

For production voice changes:

- Commit to `master`.
- Push to `origin/master`.
- Confirm Vercel production deploy.
- Test a real call.
- Check Vercel logs for `micahVoiceQA`.

## Change Style

- Keep changes narrow.
- Prefer adding a small protected fast path over changing the whole pipeline.
- Preserve existing logging.
- Preserve static MP3 fallbacks.
- Preserve dynamic AI path for non-demo questions.
- Document new static assets and why they exist.

## Lead Capture State Machine

- Website build, rebuild, landing page, and website pricing questions must not quote a price. Offer a Jayson callback instead.
- Required callback fields are name, mobile number, email address, reason/enquiry type, and best callback time.
- Track captured values separately from confirmed values.
- Ask only for missing or unconfirmed fields; never restart name/mobile/email once captured.
- Use "is that right?" for confirmations. Do not use "Correct?"
- Send Resend notifications only after required details are confirmed or the conversation is ending.
- TODO: Wire confirmed appointment, booking, or discovery interview intents into DOS Calendar only after the repo has supported calendar booking code.

## Voice Output Policy

Every spoken output must be one of:

- ElevenLabs Aussie Micah voice.
- Approved static Aussie Micah MP3.
- Silence only as a last resort when brand-safe audio is unavailable.

Never use another voice just to avoid silence.

## Live Demo Safety

If a bug affects live calls, first protect the live demo questions:

- What is DOS?
- Do you build websites?
- What does pricing look like?
- Can Jayson call me back?
- What is Micah?
- What is QuoteOS?
- What is AgentMate?
- What is DOS Calendar?
- Can you help my business get more customers?

Only improve the dynamic path after the protected static path is working.

## Micah Client Install SOP

1. Copy `client-name-template`.
2. Fill client profile.
3. Add script.
4. Add FAQs / knowledge base.
5. Add booking rules.
6. Add escalation / forbidden topics.
7. Add notification email.
8. Run local test.
9. Deploy to Vercel.
10. Live test call.
11. Confirm Resend summary.
12. Mark client ready.
