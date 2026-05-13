// Feedback / bug-report mailto. Shared by the TopBar icon and the
// Guide page's troubleshooting section. Stub body so the operator
// (Jonathan) gets enough context to look the request up in Vercel
// logs without having to ask follow-up questions.
//
// Email hardcoded for now — easy to bump if it ever rotates; not
// worth env-var indirection at the current scale.
const FEEDBACK_EMAIL = "dr.jmk@pm.me";

const FEEDBACK_SUBJECT = "Carnegie bug report";

// Mailto body — single sentence on purpose. Line breaks in mailto
// bodies are flaky across clients (iOS Mail, ProtonMail web, Gmail
// web all handle %0A vs %0D%0A differently, and several strip them
// entirely). A one-line prompt renders identically everywhere — the
// user reads it, clears it, types their report. Loses the "field
// per line" affordance, gains universal legibility.
const FEEDBACK_BODY =
  "What happened? Include the batch name (if applicable), roughly when, and attach a screenshot if you have one.";

export const FEEDBACK_MAILTO = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
  FEEDBACK_SUBJECT,
)}&body=${encodeURIComponent(FEEDBACK_BODY)}`;
