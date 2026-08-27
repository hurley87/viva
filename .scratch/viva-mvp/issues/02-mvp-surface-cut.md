# MVP surface cut

Type: grilling
Status: resolved

## Question

Which of the PRD's surfaces and flows are **built**, **seeded** (config/script instead of UI), or **cut** for the solo MVP?

Inventory from prd.md §5–6: Student session screen (countdown, examiner captions), Student feedback view, Teacher dashboard (Assignment/Standard authoring + versioning, roster upload, link issue/void, cap settings, Assessment review), Operator view (aggregates, spend, INV-1 flag rates).

Shape to react to: build the session screen + grader pipeline + Student view + a minimal Teacher review dashboard; seed Teacher/Assignment/Standard by config or a bare form; defer the Operator view to logs/queries; hand-mint Student links. Downstream tickets (schema, auth) block on this cut.

## Answer

Resolved 2026-08-26 by grilling.

**Built:**
- Student session screen: countdown, live captions of Examiner speech only, hangup.
- Student feedback view: formative summary + own transcript.
- Minimal read-only Teacher dashboard: Session list, transcript + Assessment + INV-1 flags, shadow-period release control.
- Full INV-4 *enforcement*: mint-time cap checks, budget breaker, minimum-duration forgiveness, scheduled server hangup at 15:00.
- Grader pipeline including the INV-1 Grader-side audit.

**Seeded (no UI):**
- Teacher, Assignment, and Standard rows inserted via script/Convex dashboard; version immutability + pinning enforced in schema regardless.
- Cap values live in config, edited by hand — no settings UI.
- Student identities/links hand-minted and distributed out-of-band.

**Cut or deferred:**
- Teacher authoring UI (comes with Teacher engagement).
- Roster upload + link issue/void UI (void = manual field flip).
- Operator view (Convex dashboard + logs suffice; the INV-2 access rule still ships in code).
- Async INV-1 guardrail classifier — deferred to fog with a hard condition: **in place before real Students**. MVP detection = Grader audit only, which still meets INV-1's "unnoticed" bar.

**Auth provider decision (user):** **Privy** — email magic-link auth is its core flow. Reshapes [Auth and magic-link mechanics](06-auth-magic-links.md) into a Privy↔Convex integration question.

**Accepted caveat:** while Dave is the only human in the system, Operator-via-Convex-dashboard can technically see transcript rows; INV-2-as-code matters at deployment, not during solo build.
