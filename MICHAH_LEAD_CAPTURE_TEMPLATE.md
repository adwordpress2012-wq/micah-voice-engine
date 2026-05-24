# Micah Lead Capture Template

Use this template for DOS or client receptionist flows that need callback lead capture without repeated questions.

## State

Track these for each field:

- `captured`: caller supplied a usable value.
- `confirmed`: caller confirmed the value when confirmation is required.
- `value`: normalized value Micah can repeat back.
- `pendingConfirm`: the one field currently waiting for "yes" or correction.

Required fields:

- Name
- Mobile number
- Email
- Reason or enquiry type
- Best callback time

## Flow

1. If website build/pricing is asked, do not quote price. Offer Jayson callback.
2. Ask for name and mobile together.
3. Confirm mobile: "Thanks [Name]. Just confirming, your mobile is [Number], is that right?"
4. Ask for email.
5. Confirm email: "Thanks. Just confirming, your email is [Email], is that right?"
6. Confirm or capture enquiry type if not already known.
7. Ask best callback time.
8. If caller says "this afternoon", say: "That's awesome, [Name]. I'll get Jayson to call you this afternoon, around 5pm if that suits."
9. After final confirmation, close the call warmly and trigger persistence/notification.

## Notification Summary

Email summaries should put useful summary fields before the transcript:

- Caller name
- Mobile
- Email
- Enquiry type
- Best callback time
- Key notes
- Recommended next action
