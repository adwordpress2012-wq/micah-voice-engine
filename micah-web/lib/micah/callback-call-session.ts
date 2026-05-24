/**
 * Per-CallSid callback field state — survives warm serverless instances only.
 * Gather URLs still carry state; {@link callbackCallSidMatchesRequest} must match Twilio CallSid.
 */

export type CallbackCallField = "name" | "phone" | "email" | "reason" | "time";

export type CallbackCallSessionState = {
  captured: Record<CallbackCallField, boolean>;
  confirmed: Record<CallbackCallField, boolean>;
  asked: Record<CallbackCallField, boolean>;
  values: Record<CallbackCallField, string | null>;
  pendingConfirm: CallbackCallField | null;
};

const STORE_KEY = "__micahCallbackFieldStateByCallSid";

function sessionStore(): Map<string, CallbackCallSessionState> {
  const g = globalThis as typeof globalThis & Record<string, unknown>;
  if (!(g[STORE_KEY] instanceof Map)) {
    g[STORE_KEY] = new Map<string, CallbackCallSessionState>();
  }
  return g[STORE_KEY] as Map<string, CallbackCallSessionState>;
}

export function getMicahCallbackCallSession(
  callSid: string
): CallbackCallSessionState | null {
  const sid = callSid?.trim();
  if (!sid) return null;
  return sessionStore().get(sid) ?? null;
}

export function setMicahCallbackCallSession(
  callSid: string,
  state: CallbackCallSessionState
): void {
  const sid = callSid?.trim();
  if (!sid) return;
  sessionStore().set(sid, state);
}

export function clearMicahCallbackCallSession(callSid: string): void {
  const sid = callSid?.trim();
  if (!sid) return;
  sessionStore().delete(sid);
}
