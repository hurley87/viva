# Viva MVP — Wayfinder map

Label: wayfinder:map
Tracker: local markdown — tickets live in `.scratch/viva-mvp/issues/`

## Destination

Every decision blocking the solo MVP build is made, resolved via a ticket, or consciously accepted as risk — and the PRD, ADRs, and CONTEXT.md are updated to match — so a build session can start writing code without hitting an undecided question.

## Notes

- Domain record: `docs/prd.md` (v1.3), `docs/adr/`, `CONTEXT.md`. Those are canonical; tickets here resolve only what they leave open. Use the glossary terms (Assignment, Standard, Session, Assessment, Examiner, Grader, Teacher, Student, Operator) exactly.
- Skills each session should consult: grilling + domain-modeling (source: github.com/mattpocock/skills — `skills/productivity/grilling`, `skills/engineering/domain-modeling`).
- Standing decisions from the charting grill (2026-08-26) — folded into the docs by [Fold charting decisions into the docs]:
  - Solo build, MVP posture. No timeline or date planning on this map; build ASAP.
  - No artifact / written submission: a Session is an oral answer to a prompted question. Confirms PRD v1.3; the pitch doc's "defend your own paper" framing is accepted drift.
  - Institutional network/policy verification is not a workstream here; a safe, secure test setting will be chosen later. References to it come out of the docs.
  - Shadow period for first real Sessions: Assessments visible to Teacher only until spot-checked, then steady-state immediate auto-release resumes.
  - Cost analysis is important but deliberately not up-front.
- For build sessions: AGENTS.md warns this repo's Next.js differs from training data — read `node_modules/next/dist/docs/` before writing code.

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [Fold charting decisions into the docs](issues/01-fold-charting-decisions-into-docs.md): PRD bumped to v1.4 (dates unpinned, verification caveats removed, shadow period added to §8, INV-4 build note corrected to scheduled server hangup); ADR-0003 status cleaned; CONTEXT.md gains **Shadow period**; pitch doc left as historical record.
- [MVP surface cut](issues/02-mvp-surface-cut.md): build session screen + Student feedback view + minimal Teacher review dashboard + full INV-4 enforcement + grader pipeline; seed authoring and cap config by hand; cut Operator view, roster/link UI, and settings UI; defer the async INV-1 classifier (Grader audit only, classifier required before real Students); auth provider is **Privy**.
- [Grader model choice](issues/04-grader-and-classifier-models.md): OpenAI-only (one bill, one data processor); top text tier, default gpt-5.6-sol, pinned at build time; Assessment defined by one Zod schema used as both strict structured output and the Convex table type.
- [Convex schema prototype](issues/05-convex-schema-prototype.md): approved schema — Standard physically separated (INV-3), Sessions pin immutable versions, cap forgiveness as flag, shadow release via config + released flag, failed/truncated transcript text modeled, transcriptShares break-glass, spendEvents breaker; asset `assets/05-schema.prototype.ts`.
- [Auth via Privy](issues/06-auth-magic-links.md): Privy email OTP (no magic links exist) + first-class allowlist blocks strangers; provision script = Privy user + allowlist + Convex row (CONTEXT.md: **provision** ≠ **mint**); 7-day expiry dropped for MVP, void = Convex status flip + Privy user delete; Convex bridge via customJwt/ES256/per-app JWKS.
- [Examiner prompt prototype](issues/07-examiner-prompt-prototype.md): approved — server-assembled template (only the pinned Assignment substituted), `end_session` tool with enumerated reasons, time via injected `[SYSTEM]` notes (sideband injection as hardening), steelman-probing allowed / argument-repair never; two-stage test plan (pre-build playground smoke, post-build 10-case + red-team suite); asset `assets/07-examiner-prompt.prototype.md`.
- [Transcript capture and server-enforced time-box](issues/03-transcript-capture-and-timebox.md): persist incremental client writes from `history_updated` snapshots keyed by `itemId` (user transcription must be explicitly enabled and is best-effort/late/unordered); the server CAN end a live session via `POST /v1/realtime/calls/{call_id}/hangup` — time-box = Convex scheduled hangup at 15:00 + client timer + server refuses to persist/grade past cutoff.

## Not yet specified

- Teacher engagement: walk the Teacher through v1.3, author the first real Assignment + Standard together, learn class size. Deliberately parked until the MVP is demoable.
- INV-1 red-team suite (≥20 extraction attempts, 0 un-flagged): prompt now exists — build post-MVP as text-mode regression tests with voice spot-checks, seeded from the 10-case plan in `assets/07-examiner-prompt.prototype.md` §4. Pre-build: Dave runs the 15-min playground smoke (probes 1–5, 7) — human step, existential check.
- Async INV-1 guardrail classifier: deferred out of the MVP ([MVP surface cut]) — must be in place before real Students take Sessions; slots into the flag-storage the Grader audit already uses.
- Grader prompt in detail: model decided ([Grader model choice]) and the Assessment schema is settled; the prompt wording waits on a real (or synthetic) Standard fixture to evaluate against.
- Deployment & environment setup (Vercel/Convex projects, secrets, OpenAI keys): mechanical; ticket when the build starts.
- Pilot logistics (dates, roster, physical/network setting): parked with Teacher engagement.
- ASR-quality fallback (watch item, 2026-08): if pilot transcripts prove unreliable — especially accented speech, the ADR-0001 risk — evaluate a parallel streaming tee to a dedicated ASR (e.g. Google's Gemini 3.5 Transcribe Live, ~2.6–4.0% WER, 85+ languages). Respects no-audio-at-rest; costs a second vendor + second data processor in the INV-2 disclosure. Do nothing unless the problem actually shows up.

## Out of scope

- Written-submission / owned-artifact handling — ruled out in the charting grill; Sessions probe a prompted question, not an uploaded artifact.
- Institutional network & policy verification workstream — ruled off this map in the charting grill; a safe test setting gets chosen later.
- Timeline / schedule planning — build ASAP, no dates.
- Litigation track, multi-tenancy, stakes-bearing features, French support — already out per PRD §3.
