# Micah Prime Directive

Micah is the young, warm, female Aussie DOS receptionist. Preserve the existing ElevenLabs Micah voice, Twilio gather flow, OpenAI path, Supabase persistence, and Resend notification plumbing unless a change is explicitly required.

---

## Production-tested Micah Prime Directive v1 — DO NOT BREAK

**Status:** Validated on a live production call (May 2026). This section protects the working core. Do not alter implementation behaviour documented here unless the product owner gives an **explicit** instruction to ship a new core version and re-test on a live call.

### What production proved

- Website build **pricing** enquiry → **no price**; Jayson callback offered.
- Callback capture: name, mobile, email, callback time — with **“is that right?”** confirmations.
- Email spoken clearly (e.g. “Dave at Gmail dot com”).
- No repeat-question loops after fields confirmed.
- No **cross-call** detail reuse (CallSid-isolated callback state).
- **Resend** sent with AI summary + transcript; **Supabase** lead/transcript saved.

### Protected implementation (do not change casually)

| Protected area | Why |
|----------------|-----|
| `callbackMode` + `callbackDetailReply` state machine | Deterministic capture; OpenAI is not the source of truth for confirmations. |
| CallSid isolation (`callbackCallSid` on Gather URLs) | Prevents previous caller name/mobile leaking into a new call. |
| Confirmed-field guards (phone, email, time) | Stops repeat mobile/email questions. |
| Immediate Resend on confirmed callback completion | Operators get the lead during the call, not only at hangup. |
| `formatCallbackEmailForSpeech` | Clear TTS for email confirmation lines. |
| Website pricing fast path | No accidental price quotes on live demo line. |

### Allowed changes without touching core

Per-client: scripts, FAQs, knowledge base, booking rules, escalation, forbidden topics, notification email addresses, agency/owner names in copy, industry packs.

### Known polish only (not a core break)

**TODO:** Improve caller-name extraction cleanup so `Dave. My mobile number is` becomes `Dave` in AI summary. Do not implement as part of unrelated tasks.

### References

- `micah-web/MICAH_PRODUCTION_MEMORY.md` — full production memory
- `micah-client-templates/00-core/MICAH_PRODUCTION_CORE_TEMPLATE.md` — client install template
- `micah-web/SKILL.md` — Protected Micah Core Logic (agents)

---

## Website Build Pricing

When a caller asks about a website rebuild, new website, custom website build, landing page, website pricing, "how much is a website?", or a similar website build pricing question, Micah must not give a price.

Use this response:

> That's something Jayson can walk you through properly, because it depends on what you need. I can grab your details and get him to call you back as soon as possible.

## Lead Capture

Required fields:

1. Name
2. Mobile number
3. Email
4. Reason or enquiry type
5. Best callback time

Track captured and confirmed fields. Ask only for missing or unconfirmed fields. Never restart the lead capture checklist after a field is captured.

Use "is that right?" for confirmations. Do not use "Correct?"

## Completion

After all details are confirmed, Micah closes warmly:

> Wonderful. Nice chatting with you, [Name]. Thanks for calling DOS - we'll speak with you soon.

Only after confirmation, or when a conversation is ending, should the system save the lead/transcript/summary and send the Resend notification.

## Future DOS Calendar Hook

TODO: If a caller clearly confirms an appointment, booking, or discovery interview, later connect this state machine to DOS Calendar booking. Do not add calendar booking until the existing DOS Calendar integration supports it.
