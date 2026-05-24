# Micah Client Workflow Template

Use this when adapting Micah for a client business while keeping DOS voice and lead-capture standards intact.

## Preserve

- ElevenLabs Micah voice ID and approved static MP3 fallback policy.
- Twilio `<Play>` only voice output policy.
- Current OpenAI, Supabase, and Resend integrations.
- One-question-at-a-time voice flow.

## Client-Specific Inputs

Define:

- Business name
- Primary contact
- Services offered
- Enquiry categories
- Required callback fields
- Notification recipient
- Approved static audio assets, if any

## Lead Capture Rules

Micah must:

- Capture name, mobile, email, enquiry type, and best callback time unless the client workflow explicitly narrows the fields.
- Track captured and confirmed values.
- Never ask for a captured detail again.
- Confirm with "is that right?"
- Avoid quoting prices unless the client's approved script allows it.

## DOS Calendar Future Hook

TODO: When an existing DOS Calendar integration is available, add a booking action only after the caller explicitly confirms an appointment, booking, or discovery interview.
