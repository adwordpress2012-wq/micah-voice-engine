/**
 * Lead collection state tracker for Micah voice calls.
 *
 * Scans conversation history for signals that each required detail (name,
 * business, phone, enquiry) has been provided. The result is injected into
 * the OpenAI system prompt so Micah can answer clarification questions like
 * "what details do you need?" with only the missing items, and can avoid
 * repeating questions that have already been answered.
 */

import type { ChatTurn } from "@/lib/voice-session";

export type LeadState = {
  has_name: boolean;
  has_business_name: boolean;
  has_business_type: boolean;
  has_phone: boolean;
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

// Australian phone number formats spoken in a call
const AU_PHONE_PATTERNS = [
  /\b0[2-57-9]\d[\s.-]?\d{4}[\s.-]?\d{4}\b/,
  /\b04\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/,
  /\+61[2-57-9]\d[\s.-]?\d{4}[\s.-]?\d{3}\b/,
  /\+614\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/,
  /\b(?:number|phone|mobile|contact)(?: number)? (?:is\s+)?[\d\s]{8,14}/i,
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

// Micah has started asking for caller details (so state block is useful)
const COLLECTING_PATTERNS = [
  /\bcan i (?:grab|get|take|have)\b.{0,50}\b(?:name|number|details|information)\b/i,
  /\byour (?:full )?(?:name|business\s+name|phone|contact|best)\b/i,
  /\btake (?:a few )?(?:your )?details\b/i,
  /\bpass (?:that|your details) (?:on )?to Jayson\b/i,
  /\bjot (?:that )?down\b/i,
  /\bgrab your\b/i,
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

  const has_name = matchesAny(userText, NAME_PATTERNS);
  // Phone is captured if Twilio gave us a caller ID or the caller spoke their number
  const has_phone =
    !!(callerNumber?.trim()) || matchesAny(userText, AU_PHONE_PATTERNS);
  const has_business_name = matchesAny(userText, BUSINESS_NAME_PATTERNS);
  const has_business_type = matchesAny(userText, BUSINESS_TYPE_PATTERNS);
  const has_enquiry = matchesAny(userText, ENQUIRY_PATTERNS);
  const currently_collecting_details = matchesAny(assistantText, COLLECTING_PATTERNS);

  const missing_details: string[] = [];
  if (!has_name) missing_details.push("name");
  if (!has_business_name) missing_details.push("business name");
  if (!has_phone) missing_details.push("best phone number");
  if (!has_enquiry) missing_details.push("what they need help with");

  return {
    has_name,
    has_business_name,
    has_business_type,
    has_phone,
    has_enquiry,
    currently_collecting_details,
    missing_details,
  };
}

/**
 * Builds a compact system prompt block that tells the LLM what lead details
 * have been collected and what is still needed. Injected alongside the main
 * persona only when Micah is actively collecting details.
 */
export function buildLeadStatePromptBlock(
  state: LeadState,
  callerNumber?: string
): string {
  // Skip injection early in the call before any detail collection has started
  if (
    !state.currently_collecting_details &&
    !state.has_name &&
    !state.has_business_name &&
    !state.has_enquiry &&
    !state.has_phone
  ) {
    return "";
  }

  const collected: string[] = [];
  if (state.has_name) collected.push("name");
  if (state.has_business_name) collected.push("business name");
  if (state.has_phone) {
    collected.push(
      callerNumber ? `phone (${callerNumber} via caller ID)` : "phone number"
    );
  }
  if (state.has_enquiry) collected.push("what they need help with");

  const lines: string[] = ["## Lead collection state (this call)"];

  if (collected.length > 0) {
    lines.push(`Already collected: ${collected.join(", ")}.`);
  }

  if (state.missing_details.length > 0) {
    lines.push(`Still needed: ${state.missing_details.join(", ")}.`);
    lines.push(
      `If caller asks what details you need, answer with ONLY what is still needed: "Just your ${state.missing_details.join(", ")}." Do not list things already collected.`
    );
    lines.push("Do not ask for any detail already marked as collected.");
  } else {
    lines.push(
      "All key details collected. Confirm them back briefly, say Jayson will follow up personally, then close the call warmly."
    );
  }

  return lines.join("\n");
}
