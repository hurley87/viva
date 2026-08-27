# Fold charting decisions into the docs

Type: task
Status: resolved

## Question

Apply the charting-grill decisions (2026-08-26, see map Notes) so the docs stop disagreeing with the map:

- `docs/prd.md`: remove the pilot-window date framing ("Course weeks 5–9 (hard external deadline — date TBC)") and any schedule language; remove the institutional network/policy verification caveats (§3 Transport row, §1 if present); add a shadow-period paragraph to §8 Release (first real Sessions: Assessments Teacher-only until spot-checked, then steady-state auto-release); state plainly that a Session probes a prompted question with no artifact.
- `docs/adr/0003-openai-realtime-webrtc-transport.md`: update the `status` line and consequence clause that hinge on institutional verification.
- `CONTEXT.md`: add any term that crystallised (candidate: **Shadow period**).
- `docs/prd.md` §INV-4 build note: correct "Nothing upstream ends a session at 15:00 for us" — [Transcript capture and server-enforced time-box](03-transcript-capture-and-timebox.md) found the server can hang up a live call via `POST /v1/realtime/calls/{call_id}/hangup`; the note should describe the actual mechanism (scheduled server hangup + client timer + refuse-to-grade-past-cutoff).

Done when the three files carry the decisions and nothing in them contradicts the map.

## Answer

Applied 2026-08-26:

- `docs/prd.md` bumped to **v1.4** with a delta line. Pilot window is now "TBD — scheduling parked; build proceeds now" (dates removed). §3 Transport consequence no longer cites institutional verification. §INV-4 build note corrected per [Transcript capture and server-enforced time-box](03-transcript-capture-and-timebox.md): the server ends a live call via `POST /v1/realtime/calls/{call_id}/hangup`, scheduled at mint; client countdown is UX only; server refuses to persist/grade past cutoff. §8 gains the shadow-period cold-start exception (Teacher-only release until spot-checked, then steady-state auto-release; the gate exists once per deployment). Oral-only scope reconfirmed in the delta.
- `docs/adr/0003-openai-realtime-webrtc-transport.md`: status is plain `accepted`; consequence clause drops the verification caveat and notes the test setting is chosen at deployment.
- `CONTEXT.md`: added **Shadow period** (avoid: soft launch, review gate).
- `docs/viva-pitch-and-cosmos-program.md` deliberately untouched — it's a historical record of what was funded; the accepted drift (no artifact) is recorded on the map, not by rewriting the pitch.
