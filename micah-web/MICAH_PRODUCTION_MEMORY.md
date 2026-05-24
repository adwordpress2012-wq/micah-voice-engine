# Micah Production Memory

**Status:** Micah Prime Directive v1 — **production-tested** (live DOS voice call, May 2026).

This document is the protected operational memory for the working Micah voice stack. It records what is stable in production and what must not be changed without an explicit instruction.

---

## Production-tested flow (Micah Prime Directive v1)

Live call validated end-to-end:

1. Caller asked for **website build pricing**.
2. Micah **did not quote a price**.
3. Micah offered a **Jayson callback** and entered deterministic callback capture.
4. Captured **name, mobile, email, and best callback time** (reason/enquiry may be pre-filled when intent is already clear, e.g. website pricing).
5. Confirmed mobile and email with **“is that right?”** (never “Correct?”).
6. Spoke email clearly in TTS form, e.g. **“Dave at Gmail dot com”**.
7. Did **not** repeat already-confirmed questions.
8. Did **not** reuse a previous caller’s name or number (**CallSid-isolated state**).
9. **Resend** notification sent successfully with **AI summary + transcript**.
10. Lead/transcript persisted via **Supabase** (`leads` table, keyed by `call_sid`).

---

## What is working (do not regress)

| Area | Behaviour |
|------|-----------|
| Website build pricing | No price on call; Jayson callback offer (`WEBSITE_BUILD_LEAD_OFFER` fast path in `app/api/voice/process/route.ts`). |
| Callback mode | Deterministic `callbackDetailReply` state machine — not left to OpenAI for field capture/confirmation. |
| Field guards | `confirmed` locks phone, email, time; no re-ask loops once confirmed. |
| Confirmations | Mobile/email use “is that right?”; email spoken via `formatCallbackEmailForSpeech`. |
| CallSid isolation | Gather URLs carry `callbackCallSid`; stale URL params from another call are discarded (`resolveCallbackFieldStateForRequest`). |
| Session cleanup | In-memory session cleared on callback complete and on `call-status` **completed**. |
| Resend timing | Immediate DOS lead email when required callback fields are confirmed (`sendCallbackDetailLeadEmail`); subject `New Micah Voice Lead - DOS`. |
| Voice brand | ElevenLabs Aussie Micah only (`MICAH_ELEVENLABS_VOICE_ID`); no Polly / `<Say>`. |
| Observability | Vercel logs: filter `micahVoiceQA` and callback events e.g. `voice_process_callback_state_*`. |

---

## Protected rules (core logic — change only when explicitly requested)

- **Do not rewrite** `callbackMode`, `callbackDetailReply`, confirmed-field guards, Gather URL state encoding, or CallSid validation without explicit approval.
- **Do not change** Resend immediate-send timing for completed callback capture without explicit approval.
- **Do not change** email speech formatting (`formatCallbackEmailForSpeech`) without explicit approval.
- **Do not** reintroduce Polly, `<Say>`, env-based ElevenLabs voice IDs, or cross-call global callback state.
- **Client installs** customise scripts, FAQs, knowledge base, booking rules, escalation, forbidden topics, and notification recipients — **not** this core state machine.
- **Deployments:** ship via `master` → Vercel production; run `npx tsc --noEmit` and live test call after voice changes. See repo `AGENTS.md`.

### Key implementation files (reference only)

- `app/api/voice/process/route.ts` — callback state machine, website pricing fast path, Gather TwiML.
- `lib/micah/callback-call-session.ts` — per-`CallSid` warm-instance session store.
- `lib/micah/micah-lead-resend.ts` — Resend lead email + transcript/summary.
- `lib/voice-session.ts` — Supabase `leads` history by `call_sid`.
- `app/api/voice/call-status/route.ts` — clears callback session on call completed.
- `lib/micah/micah-directive-os-persona.ts` — persona + routing (demo vs main).

---

## Known tiny polish (not blocking production)

**TODO:** Improve caller-name extraction cleanup so summary/transcript fields do not retain trailing phrasing such as `Dave. My mobile number is` — target clean `Dave` in AI summary. Do **not** implement as part of routine doc or client install tasks unless explicitly requested.

---

## Related docs

- `micah-client-templates/00-core/MICAH_PRIME_DIRECTIVE.md` — product rules + “DO NOT BREAK” section.
- `micah-client-templates/00-core/MICAH_PRODUCTION_CORE_TEMPLATE.md` — reusable client-install core template.
- `micah-web/SKILL.md` — Cursor/Codex protected core logic section.
- `AGENTS.md` (repo root) — voice brand, env, deploy, QA.

---

*Last aligned with production-tested Micah Prime Directive v1. Update this file when a new core version is deliberately shipped and re-validated on a live call.*
