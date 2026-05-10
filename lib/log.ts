// Structured log helper. Emits a single JSON line per call to stdout
// (Vercel auto-captures stdout). The shape is stable enough that future
// log search by request_id, event, or userId works in Vercel's log
// inspector without an external sink.
//
// Conventions:
//   - `event` is dot-namespaced: "vision.start", "auth.login.failure".
//     Group similar events under a shared prefix so log filters work.
//   - `request_id` should always be passed when available — that's the
//     thread that ties an end-to-end flow together across services.
//   - Don't put secrets in fields. Passcodes, raw tokens, full vision
//     payloads all stay out. The point is operator visibility, not a
//     replay log.

export const REQUEST_ID_HEADER = "x-request-id";

// Pull the request-id the proxy injected into inbound headers. Routes
// call this once at handler entry and pass the result to every log()
// call in that request.
export function requestIdFrom(headers: Headers | { get: (name: string) => string | null }): string | null {
  return headers.get(REQUEST_ID_HEADER);
}

export type LogFields = Record<string, unknown>;

export function log(event: string, fields: LogFields = {}): void {
  // Drop null/undefined to keep lines lean. Booleans, numbers, and
  // empty strings are kept because absence-vs-explicit-empty is sometimes
  // load-bearing during a debug session.
  const cleaned: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) continue;
    cleaned[k] = v;
  }
  const line = {
    ts: new Date().toISOString(),
    event,
    ...cleaned,
  };
  // process.stdout.write avoids the second-newline that console.log
  // appends on some Node configs, so log lines are guaranteed
  // single-line JSON.
  process.stdout.write(JSON.stringify(line) + "\n");
}
