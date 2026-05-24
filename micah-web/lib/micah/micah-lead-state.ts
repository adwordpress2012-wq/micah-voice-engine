/**
 * Lead collection state tracker for Micah voice calls.
 *
 * Scans conversation history for signals that each required callback detail
 * (name, mobile, email, best time) has been provided. The result is injected
 * into the OpenAI system prompt so Micah can answer clarification questions
 * like "what details do you need?" with only the missing items, and can avoid
 * repeating questions that have already been answered.
 */

import type { ChatTurn } from "@/lib/voice-session";

export type LeadState = {
  has_name: boolean;
  has_business_name: boolean;
  has_business_type: boolean;
  has_phone: boolean;
  has_email: boolean;
  has_best_time: boolean;
  has_enquiry: boolean;
  currently_collecting_details: boolean;
  missing_details: string[];
};

// Caller has introduced themselves by name
const NAME_PATTERNS = [
  /\bmy name(?:'s| is)\b/i,
  /\bi(?:'m| am)\s+[A-Z][a-z]/,
  /\bthis is\s+[A-Z][a-z]/,
  /\bcall me\s+[A-Za-z]/i,
  /\bname(?:'s| is)\s+[A-Z][a-z]/i,
];

// Australian mobile / landline formats spoken in a call
const AU_PHONE_PATTERNS = [
  /\b0[2-57-9]\d[\s.-]?\d{4}[\s.-]?\d{4}\b/,
  /\b04\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/,
  /\+61[2-57-9]\d[\s.-]?\d{4}[\s.-]?\d{3}\b/,
  /\+614\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/,
  /\b(?:number|phone|mobile|contact)(?: number)? (?:is\s+)?[\d\s]{8,14}/i,
];

// Email address in spoken text
const EMAIL_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:email|e-mail|email address)(?: is| address is)?\s+[A-Z0-9]/i,
];

// Caller mentions a business name or organisation
const BUSINESS_NAME_PATTERNS = [
  /\b(?:from|at|with)\s+[A-Z][A-Za-z]/,
  /\b(?:business|company|firm|shop|agency|practice)(?:\s+name)?(?:\s+is)?\s+[A-Z]/i,
  /\b(?:I run|I own|we run|we are|we're)\s+(?:a |an )?[A-Z][A-Za-z]/,
];

// Caller describes what kind of business they have
const BUSINESS_TYPE_PATTERNS = [
  /\bwe\s+(?:are|do|run|operate|provide|specialise)\b/i,
  /\bi\s+(?:am|run|do|operate|own)\s+a(?:n)?\s+\w+(?:ing|er|or|ist)\b/i,
  /\b(?:plumb|electr|build|clean|landscap|consult|account|legal|medical|dental|tradie|trade|mechanic|retail)\w*/i,
];

// Caller states what they need help with
const ENQUIRY_PATTERNS = [
  /\b(?:need|want|looking for|after|interested in|like to|would like)\s+.{5,}/i,
  /\b(?:help with|help me|enquir|quote for|book|appointment)\b/i,
  /\bget more\s+(?:customers|leads|enquir|bookings|jobs)\b/i,
];

// Caller gives a preferred callback time
const BEST_TIME_PATTERNS = [
  /\b(?:best time|good time|anytime|any time)\b/i,
  /\b(?:morning|afternoon|evening|weekday|weekend)\b/i,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(?:today|tomorrow|next week|this week|later today)\b/i,
  /\b(?:today|tomorrow)\s+at\s+\d{1,2}/i,
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
  /\b(?:call me|reach me|get me)\s+(?:at|around|after|before|between|in the|on)\b/i,
];

// Micah has started asking for caller details (activates state block)
const COLLECTING_PATTERNS = [
  /\bcan i (?:grab|get|take|have)\b.{0,50}\b(?:name|number|details|information|email|mobile)\b/i,
  /\byour (?:full )?(?:name|business\s+name|phone|contact|best|email|mobile)\b/i,
  /\btake (?:a few )?(?:your )?details\b/i,
  /\bpass (?:that|your details) (?:on )?to Jayson\b/i,
  /\bjot (?:that )?down\b/i,
  /\bgrab your\b/i,
  /\bi'll let (?:jayson|[a-z]+) know to call you back\b/i,
  /\bcan follow up properly\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

export function extractLeadState(
  history: ChatTurn[],
  callerNumber?: string
): LeadState {
  const userText = history
    .filter((t) => t.role === "user")
    .map((t) => t.content)
    .join(" ");
  const assistantText = history
    .filter((t) => t.role === "assistant")
    .map((t) => t.content)
    .join(" ");
  // Check both sides of the conversation for email and time (Micah may echo them back)
  const fullText = userText + " " + assistantText;

  const has_name = matchesAny(userText, NAME_PATTERNS);
  // Phone: caller ID from Twilio counts, or caller spoke their number
  const has_phone =
    !!(callerNumber?.trim()) || matchesAny(userText, AU_PHONE_PATTERNS);
  const has_email = matchesAny(fullText, EMAIL_PATTERNS);
  const has_best_time = matchesAny(fullText, BEST_TIME_PATTERNS);
  const has_business_name = matchesAny(userText, BUSINESS_NAME_PATTERNS);
  const has_business_type = matchesAny(userText, BUSINESS_TYPE_PATTERNS);
  const has_enquiry = matchesAny(userText, ENQUIRY_PATTERNS);
  const currently_collecting_details = matchesAny(assistantText, COLLECTING_PATTERNS);

  // Core required fields for a callback lead (reason/enquiry type is optional metadata)
  const missing_details: string[] = [];
  if (!has_name) missing_details.push("name");
  if (!has_phone) missing_details.push("mobile number");
  if (!has_email) missing_details.push("email address");
  if (!has_best_time) missing_details.push("best time to call");

  return {
    has_name,
    has_business_name,
    has_business_type,
    has_phone,
    has_email,
    has_best_time,
    has_enquiry,
    currently_collecting_details,
    missing_details,
  };
}

/**
 * Builds a compact system prompt block telling the LLM what lead details have
 * been collected and what is still needed. Injected only when Micah is actively
 * collecting — keeps early-call prompts lean.
 */
export function buildLeadStatePromptBlock(
  state: LeadState,
  callerNumber?: string
): string {
  // Skip injection before any lead collection has started
  if (
    !state.currently_collecting_details &&
    !state.has_name &&
    !state.has_phone &&
    !state.has_email &&
    !state.has_best_time
  ) {
    return "";
  }

  const collected: string[] = [];
  if (state.has_name) collected.push("name");
  if (state.has_phone) {
    collected.push(
      callerNumber ? `mobile (${callerNumber} via caller ID)` : "mobile number"
    );
  }
  if (state.has_email) collected.push("email address");
  if (state.has_best_time) collected.push("best time to call");

  const lines: string[] = ["## Lead collection state (this call)"];

  if (collected.length > 0) {
    lines.push(`Already collected: ${collected.join(", ")}.`);
  }

  if (state.missing_details.length > 0) {
    lines.push(`Still needed: ${state.missing_details.join(", ")}.`);
    lines.push(
      `If caller asks what details you need, answer with ONLY what is still needed: "Just your ${state.missing_details.join(", ")}." Do not list things already collected.`
    );
    lines.push("Do not ask for any detail already marked as collected above.");
    lines.push('Use "is that right?" for confirmations. Do not say "Correct?"');
  } else {
    lines.push(
      "All key callback details collected. Confirm them back briefly, tell the caller Jayson will follow up personally, then close warmly."
    );
  }

  return lines.join("\n");
}
