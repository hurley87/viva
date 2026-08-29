---
status: accepted
---

# The Transcript is client-authored, and therefore forgeable

The browser holds the WebRTC leg, so the browser is the only party that sees the conversation: it derives Transcript rows from the SDK's reconciled history snapshots and upserts them through the public `transcript.upsert`. The server checks who is calling and whether the Session's write window is still open, but it has no independent copy of what was said, so `itemId`, `speaker`, `text` and `textStatus` are all taken on the client's word. A Student can therefore fabricate a Session — including invented Examiner turns — which the Grader will evaluate and the Teacher will read as the record.

The alternative is a server-mediated transport (an SFU, or OpenAI's server-to-server call path) so the deployment sees the audio itself. That is a different architecture, it re-opens ADR-0001's no-audio-at-rest decision, and it costs the interruption and latency quality that ADR-0003 chose the WebRTC path for. Storing nothing and trusting the client is the consequence of those two decisions, not a separate one.

We accept it at v1 stakes. Assessments are formative and carry no course marks (ADR-0002), so forging a Transcript buys a Student nothing but feedback on a conversation they made up. It sits alongside the spoken prompt-injection risk PRD §8 already accepts, and closes the same way: **both must be closed before any stakes-bearing deployment.** What INV-4 does *not* leave to the client is the accounting — a Transcript written for a Session whose start was never reported starts that Session on the server clock, so fabricating one costs a real Session slot and records real spend.

Detection, not prevention, is what exists today: the Grader's audit reads the Transcript it is given, and a Teacher reading an implausible record is the backstop. Nothing in the system flags a forgery on its own.

## The inverse case, also accepted

A client can also persist *nothing*: take its `ek_` secret, converse with the Examiner, and neither report a start nor write a Transcript. The server has no independent evidence that call ever happened — OpenAI exposes no way to enumerate calls made against a secret we issued — so that Session is finalized with a zero duration, forgiven by the minimum-duration floor, and recorded as $0 of realtime spend. The realtime minutes are real and the breaker never sees them.

We accept it, bounded rather than closed. The Session row still counts against the Student's day and week caps from the moment it is minted until the mint-time backstop finalizes it (`timeboxSec + CONNECT_GRACE_SEC` later), so this buys at most a cap's worth of unrecorded conversation per window, not an unlimited supply — and it buys no Assessment, which is the only thing the product gives a Student. Closing it properly means either a server-mediated transport or per-secret usage reconciliation against OpenAI's billing, both of which are v2 work. The under-reported spend is a real gap in the breaker's picture and should be reconciled against the actual OpenAI bill during the pilot rather than assumed away.

