// Operator mailtos. Shared by the TopBar / Guide page (bug reports)
// and the Login page (passcode reset request). Stub bodies so the
// operator (Jonathan) gets enough context to act without a follow-up.
//
// Email hardcoded for now — easy to bump if it ever rotates; not
// worth env-var indirection at the current scale.
const OPERATOR_EMAIL = "dr.jmk@pm.me";

// Mailto bodies are single sentences on purpose. Line breaks in
// mailto bodies are flaky across clients (iOS Mail, ProtonMail web,
// Gmail web all handle %0A vs %0D%0A differently, and several strip
// them entirely). One-line prompts render identically everywhere —
// the user reads, clears, types their report. Loses the "field per
// line" affordance, gains universal legibility.
const FEEDBACK_SUBJECT = "Carnegie bug report";
const FEEDBACK_BODY =
  "What happened? Include the batch name (if applicable), roughly when, and attach a screenshot if you have one.";

const FORGOT_PASSCODE_SUBJECT = "Carnegie passcode reset";
const FORGOT_PASSCODE_BODY =
  "Hi Jonathan — please reset my Carnegie passcode. My name on the account is: ";

export const FEEDBACK_MAILTO = `mailto:${OPERATOR_EMAIL}?subject=${encodeURIComponent(
  FEEDBACK_SUBJECT,
)}&body=${encodeURIComponent(FEEDBACK_BODY)}`;

export const FORGOT_PASSCODE_MAILTO = `mailto:${OPERATOR_EMAIL}?subject=${encodeURIComponent(
  FORGOT_PASSCODE_SUBJECT,
)}&body=${encodeURIComponent(FORGOT_PASSCODE_BODY)}`;
