// Feedback / bug-report mailto. Shared by the TopBar icon and the
// Guide page's troubleshooting section. Stub body so the operator
// (Jonathan) gets enough context to look the request up in Vercel
// logs without having to ask follow-up questions.
//
// Email hardcoded for now — easy to bump if it ever rotates; not
// worth env-var indirection at the current scale.
const FEEDBACK_EMAIL = "dr.jmk@pm.me";

const FEEDBACK_SUBJECT = "Carnegie bug report";

const FEEDBACK_BODY = `What happened:


Batch name (if applicable):


Roughly when:


Screenshot (attach if you have one):
`;

export const FEEDBACK_MAILTO = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
  FEEDBACK_SUBJECT,
)}&body=${encodeURIComponent(FEEDBACK_BODY)}`;
