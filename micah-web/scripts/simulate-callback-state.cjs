const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const routePath = path.join(
  __dirname,
  "..",
  "app",
  "api",
  "voice",
  "process",
  "route.ts"
);

const source = `${fs.readFileSync(routePath, "utf8")}

const __micahCallbackSimulation = (() => {
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  // A. Website pricing path — Micah offer must enter callbackMode
  assert(
    replyIsCallbackMode(WEBSITE_BUILD_LEAD_OFFER),
    "A failed: WEBSITE_BUILD_LEAD_OFFER must trigger callbackMode detection"
  );
  const websiteContinuation = resolveCallbackContinuationState(
    WEBSITE_BUILD_LEAD_OFFER,
    false,
    emptyCallbackFieldState(),
    "I need help with website build pricing."
  );
  assert(
    websiteContinuation.inCallbackMode,
    "A failed: website pricing continuation must set callbackMode"
  );
  assert(
    websiteContinuation.callbackFieldState.captured.reason,
    "A failed: website pricing should pre-capture reason metadata"
  );

  const twilioFrom = "+61411111222";
  const initialState = callbackFieldStateWithAsked(
    emptyCallbackFieldState(),
    ["name", "phone"]
  );

  // B. Callback details — mobile confirm then email (not mobile again)
  const firstSpeech = "My name is Daniel. My mobile number is 0434 666 080.";
  const firstOutcome = callbackDetailReply(
    extractCallbackDetails(firstSpeech),
    firstSpeech,
    initialState,
    twilioFrom
  );

  assert(
    firstOutcome.reply === "Thanks Daniel. Just confirming, your mobile is 0434 666 080, is that right?",
    "B failed: expected mobile confirmation after first caller turn"
  );
  assert(firstOutcome.state.pendingConfirm === "phone", "B failed: phone should be pending confirmation");

  const yesOutcome = callbackDetailReply(
    extractCallbackDetails("Yes."),
    "Yes.",
    firstOutcome.state,
    twilioFrom
  );

  assert(yesOutcome.state.confirmed.phone === true, "B failed: mobile was not locked confirmed after yes");
  assert(yesOutcome.state.pendingConfirm !== "phone", "B failed: phone remained pending after yes");
  assert(yesOutcome.reply === "Great. And your email?", "B failed: expected email ask after mobile confirmation");
  assert(!/mobile|phone|say that again/i.test(yesOutcome.reply || ""), "B failed: reply repeated mobile question");

  const emailSpeech = "My email is daniel@example.com.";
  const emailOutcome = callbackDetailReply(
    extractCallbackDetails(emailSpeech),
    emailSpeech,
    yesOutcome.state,
    twilioFrom
  );

  assert(emailOutcome.state.confirmed.phone === true, "B failed: mobile confirmation was lost");
  assert(
    emailOutcome.reply ===
      "Thanks. Just confirming, your email is Daniel at Example dot com, is that right?",
    "B failed: expected email confirmation next"
  );
  assert(!/mobile|phone/i.test(emailOutcome.reply || ""), "B failed: asked for phone instead of confirming email");

  const emailYesOutcome = callbackDetailReply(
    extractCallbackDetails("Yes."),
    "Yes.",
    emailOutcome.state,
    twilioFrom
  );

  assert(
    emailYesOutcome.reply === "When is the best time for Jayson to contact you?",
    "B failed: expected callback time after email confirmation"
  );

  // C. Complete path — clear callback time locks immediately and closes
  const timeSpeech = "This afternoon.";
  const timeOutcome = callbackDetailReply(
    extractCallbackDetails(timeSpeech),
    timeSpeech,
    emailYesOutcome.state,
    twilioFrom
  );

  assert(timeOutcome.completed === true, "C failed: clear callback time should complete immediately");
  assert(timeOutcome.state.confirmed.time === true, "C failed: callback time should be confirmed");
  assert(callbackLeadComplete(timeOutcome.state), "C failed: callbackLeadComplete should be true");
  assert(/Thanks for calling DOS/.test(timeOutcome.reply || ""), "C failed: expected natural close");

  // E. "today at 4pm" must not loop CALLBACK_TIME_ASK
  const todayAtState = callbackFieldStateWithAsked(
    {
      captured: { name: true, phone: true, email: true, reason: false, time: false },
      confirmed: { name: true, phone: true, email: true, reason: false, time: false },
      asked: { name: true, phone: true, email: true, reason: false, time: false },
      values: {
        name: "Dave",
        phone: "+61400111222",
        email: "dave@gmail.com",
        reason: null,
        time: null,
      },
      pendingConfirm: null,
    },
    []
  );
  const todayAtSpeech = "today at 4pm";
  const todayAtOutcome = callbackDetailReply(
    extractCallbackDetails(todayAtSpeech),
    todayAtSpeech,
    todayAtState,
    twilioFrom
  );
  assert(todayAtOutcome.state.confirmed.time === true, "E failed: today at 4pm should confirm time");
  assert(todayAtOutcome.completed === true, "E failed: today at 4pm should complete callback");
  assert(
    todayAtOutcome.reply !== "When is the best time for Jayson to contact you?",
    "E failed: must not repeat CALLBACK_TIME_ASK after clear time"
  );

  // D. Reason missing — completion must not require reason
  const noReasonState = callbackFieldStateWithAsked(
    {
      captured: { name: true, phone: true, email: true, reason: false, time: true },
      confirmed: { name: true, phone: true, email: true, reason: false, time: true },
      asked: { name: true, phone: true, email: true, reason: false, time: true },
      values: {
        name: "Sam",
        phone: "+61400111222",
        email: "sam@example.com",
        reason: null,
        time: "tomorrow morning",
      },
      pendingConfirm: null,
    },
    []
  );
  assert(
    callbackLeadComplete(noReasonState),
    "D failed: callback should complete without reason/enquiry type"
  );

  return {
    simulationA: {
      websiteOfferEntersCallbackMode: replyIsCallbackMode(WEBSITE_BUILD_LEAD_OFFER),
      continuationCallbackMode: websiteContinuation.inCallbackMode,
    },
    simulationB: {
      firstReply: firstOutcome.reply,
      afterMobileConfirmationReply: yesOutcome.reply,
      mobileConfirmed: yesOutcome.state.confirmed.phone,
    },
    simulationC: {
      completed: timeOutcome.completed,
      finalReply: timeOutcome.reply,
    },
    simulationE: {
      timeConfirmed: todayAtOutcome.state.confirmed.time,
      completed: todayAtOutcome.completed,
    },
    simulationD: {
      completesWithoutReason: callbackLeadComplete(noReasonState),
    },
  };
})();

module.exports = { __micahCallbackSimulation };
`;

const output = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: routePath,
});

function stubRequire(id) {
  if (id === "openai") return class OpenAI {};
  if (id === "twilio") {
    return {
      twiml: {
        VoiceResponse: class VoiceResponse {
          gather() {}
          redirect() {}
          pause() {}
          hangup() {}
          toString() {
            return "";
          }
        },
      },
    };
  }
  if (id.startsWith("@/")) {
    return new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "__esModule") return true;
          if (prop === "MICAH_VOICE_CHAT_MODEL") return "gpt-4o-mini";
          if (prop === "MICAH_VOICE_CHAT_TEMPERATURE") return 0.2;
          if (prop === "MICAH_SAY_LANGUAGE") return "en-AU";
          if (prop === "MICAH_ELEVENLABS_VOICE_ID") return "4Nz4vG2f9omkfcS8r4PJ";
          if (prop === "MICAH_OPENAI_OFFLINE_FALLBACK") return "Sorry, could you please repeat that?";
          return () => null;
        },
      }
    );
  }
  return require(id);
}

const sandbox = {
  module: { exports: {} },
  exports: {},
  require: stubRequire,
  console,
  process,
  URL,
  Response,
  FormData,
  setTimeout,
  clearTimeout,
  Date,
};
sandbox.exports = sandbox.module.exports;

vm.runInNewContext(output.outputText, sandbox, { filename: routePath });

console.log(JSON.stringify(sandbox.module.exports.__micahCallbackSimulation, null, 2));
