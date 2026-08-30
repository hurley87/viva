---
status: accepted
---

# INV-1's instruction integrity is a property of our client, not of the platform

The Examiner's instructions are assembled server-side and baked into the short-lived `ek_` client secret; the browser receives the secret and never sees or builds the text. That is INV-1 mechanism (a), and it holds.

What does not hold is the stronger claim the code used to make in comments: that the instructions therefore *cannot* be overwritten. Our `RealtimeAgent` deliberately carries no instructions of its own, so the `session.update` the SDK sends on connect omits the field — and the invariant suite fails if that guard is ever dropped. But the guard lives in code we ship to the browser. The same `ek_` secret authorises a `session.update` carrying any `instructions` a hand-rolled client cares to send, and whether OpenAI refuses an instruction change from an ephemeral credential is unverified (the SDK exposes `sendEvent` over exactly that transport). We did not probe it, and we do not depend on the answer.

We accept this, because INV-1's stated bar is already detection rather than prevention (PRD §4: "prevention is prompt-level only; the classifier and audit are post-hoc"). What the deployment guarantees is that no position-supply goes *unnoticed*: the Grader audits the Transcript independently and flags Examiner turns that supplied the Student's position, and it reads what the Examiner actually said whatever instructions produced it. A Student who replaced the instructions to get an Examiner that argues for them still ends up with those turns in the record, flagged, on the Teacher's dashboard and in the Operator's flag rate.

The residual is narrower than it looks and worth naming: prompt-level *prevention* is not enforced against a hostile client, and a Session run under replaced instructions is not blocked, invalidated, or state-changed — consistent with INV-1's own statement that a flagged Session is not. This must be revisited before any stakes-bearing deployment, alongside ADR-0004 and the spoken prompt-injection risk in PRD §8.
