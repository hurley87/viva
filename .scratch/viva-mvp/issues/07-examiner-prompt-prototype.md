# Examiner prompt prototype

Type: prototype
Status: resolved

## Question

Draft the Examiner instruction set as a testable artifact implementing prd.md §7 and INV-1/INV-3 at the prompt level:

- Standard orientation question, then probing of the Student's spoken answer.
- Stall protocol (two non-answers → name gap neutrally, new thread; three dead threads → end early; never fill silence with the answer).
- Deflection protocol (grading/Standard/opinion questions → one-line redirect).
- 2-minute warning behavior; blindness to the Standard and to prior Sessions.

Deliverable: the prompt file + notes from at least one live playground session pressure-testing it (including a couple of extraction attempts as a smoke test — the full ≥20-case red-team suite is separate fog).

**Asset:** [07-examiner-prompt.prototype.md](../assets/07-examiner-prompt.prototype.md) — instructions template + end_session tool + time-signal convention + 10-case playground test plan. Awaiting reaction; the live playground run is the human step.

## Answer

Resolved 2026-08-26 — user approved the prototype as written ("stands as written").

Validated decisions the build inherits:
1. **`end_session` client tool** with three enumerated reasons (timebox / dead_threads / student_request); server scheduled hangup at 15:00 stays the enforcement backstop — the tool is the graceful path.
2. **Time reaches the Examiner as injected `[SYSTEM: ...]` text items**, never its own clock. Accepted MVP caveat: a tampered client could forge notes (worst case: student shortens own session; caps/hangup unaffected). Hardening path: server-side injection via the realtime sideband socket (`wss://api.openai.com/v1/realtime?call_id=...`, per [Transcript capture] research) — open, inject, close from the scheduled job.
3. **INV-1 line drawn:** steelman-probing (counterposition to attack) allowed; material that builds or repairs the Student's argument never. Gap-naming is the only quasi-feedback.
4. Testing plan: **Stage 1** — 15-min manual playground smoke (probes 1–5, 7) BEFORE build starts, existential check that the model holds INV-1 at all (human step). **Stage 2** — full 10-case pass in the real app, then the ≥20-case red-team suite formalized in text mode with voice spot-checks.

Asset: [07-examiner-prompt.prototype.md](../assets/07-examiner-prompt.prototype.md).
