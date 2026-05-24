# Micah Production Core Template

Reusable **stable core** for Micah voice client installs. Copy behaviour and constraints from this template; customise only the client-specific sections listed at the end.

**Baseline:** Micah Prime Directive v1 (production-tested on Directive OS demo line).

---

## Stable core (same for every client install)

### Website build / pricing enquiries

- When the caller asks about website rebuild, new website, landing page, or website build **pricing**, Micah must **not** quote a price.
- Offer a human callback (DOS default: Jayson) and enter callback capture.
- Example line (adapt name only per client):

  > That's something [Owner] can walk you through properly, because it depends on what you need. I can grab your details and get [him/her/them] to call you back as soon as possible.

### Callback capture flow (`callbackMode`)

Deterministic field machine (implemented in `micah-web/app/api/voice/process/route.ts`):

1. **Name** and **mobile** — often asked together first.
2. **Mobile** — confirm with “is that right?” before treating as locked.
3. **Email** — capture, then confirm with “is that right?”; speak as e.g. `Name at Gmail dot com` (not raw `user@gmail.com` in TTS).
4. **Best callback time** — capture; clear phrases (e.g. “today at 4pm”, “this afternoon”) complete without repeat loops.
5. **Reason / enquiry type** — required in product docs; may be **pre-captured** when intent is obvious (e.g. website pricing). Do not force a redundant reason question if already captured.

### Required fields (minimum for Resend “full” callback email)

| Field | Confirm? |
|-------|----------|
| Name | Yes (captured; may auto-confirm when clear) |
| Mobile | Yes — “is that right?” |
| Email | Yes — “is that right?” |
| Best callback time | Yes when provided |
| Reason | When not already clear from intent |

### Confirmation wording

- Use **“is that right?”** for mobile and email confirmation.
- Do **not** use “Correct?”
- Do **not** re-ask name, mobile, or email after `confirmed` is set for that field.

### Completion line (DOS default)

> Wonderful. Nice chatting with you, [Name]. Thanks for calling DOS - we'll speak with you soon.

(Client installs: replace agency name only.)

### Resend notification timing

- Send lead email **immediately** when required callback fields are **confirmed** during the call — do not wait for hangup.
- Subject pattern: `New Micah Voice Lead - [Client Short Name]` (DOS: `New Micah Voice Lead - DOS`).
- Body includes: caller details, **AI summary**, and **transcript** where implemented.
- Resend/Supabase failures must **log** and must **not** break the live call.

Env (DOS): `MICAH_VOICE_NOTIFY_EMAIL` → fallback `MICAH_TRANSCRIPT_DEFAULT_TO`.

### CallSid state isolation

- All callback gather continuation URLs must include **`callbackCallSid`** matching Twilio **`CallSid`**.
- Stale query params from a **previous call** must be **discarded** (empty state + log `voice_process_callback_state_reset`).
- New calls from `/api/voice/incoming` start with a **clean** process URL (no callback params).
- Session map: `lib/micah/callback-call-session.ts`; cleared on callback complete and `call-status` **completed**.

### Supabase ↔ Resend relationship

| System | Role |
|--------|------|
| **Supabase `leads`** | Persists `call_sid`, caller phone, `metadata.messages` transcript turns, tenant id. Keyed by **CallSid**, not caller phone. |
| **Resend** | Operator notification email with summary + transcript; sent on confirmed callback completion (and other tiers per `micah-lead-resend.ts`). |
| **call-status webhook** | Optional end-of-call summary email; distinct from immediate callback lead email. |

Do not key callback **capture state** by phone number — only by **CallSid** (+ validated URL params).

### Voice / persona (non-negotiable)

- ElevenLabs Aussie **Micah** voice only (`MICAH_ELEVENLABS_VOICE_ID` hardcoded).
- No Polly, no Twilio `<Say>`, no male/generic fallback voices.
- Micah never identifies as AI/bot/assistant in caller-facing copy.

---

## Client-specific customisation points (safe to change per install)

Customize **only** these for each client — leave the core state machine and CallSid isolation untouched:

| Customise | Examples |
|-----------|----------|
| Opening / agency name | `MICAH_AGENCY_NAME`, greeting copy in client script |
| Callback owner name | “Jayson” → client principal name |
| Scripts & FAQs | `CLIENT_SCRIPT.md`, `CLIENT_FAQ.md`, knowledge base |
| Forbidden topics & escalation | `CLIENT_ESCALATION_RULES.md`, `CLIENT_FORBIDDEN_TOPICS` |
| Booking rules | `CLIENT_BOOKING_RULES.md` (future calendar hook — not in v1 core) |
| Notification settings | `MICAH_VOICE_NOTIFY_EMAIL`, client notify address, subject prefix |
| Demo vs main routing | Inbound number → tenant / persona variant |
| Static demo MP3s | DOS/websites/pricing FAQ recordings (verify Aussie Micah voice) |
| Industry packs | Tradie, real estate, clinic overlays on **wording** only |

---

## Pre-ship checklist (core unchanged)

1. `cd micah-web && npx tsc --noEmit && npm run build`
2. Deploy `master` to Vercel production
3. Live test: website pricing → no price → callback → confirm mobile/email → no repeat questions → Resend received
4. Second live call: **different** caller — must **not** mention previous caller (CallSid isolation)
5. Vercel logs: `micahVoiceQA`, `voice_process_callback_state_initialized` on new call

---

## Known polish (template-level TODO)

**TODO:** Improve caller-name extraction cleanup so AI summary shows `Dave` not `Dave. My mobile number is`. Not part of core template changes unless explicitly requested.

---

## See also

- `MICAH_PRIME_DIRECTIVE.md` — product directive + DO NOT BREAK section
- `LEAD_CAPTURE_FLOW.md` — generic capture wording
- `RESEND_SUMMARY_TEMPLATE.md` — email body shape
- `micah-web/MICAH_PRODUCTION_MEMORY.md` — production memory / what shipped
