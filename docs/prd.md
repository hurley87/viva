# Viva v1.4 — PRD

**Status:** MVP-build revision (supersedes v1.3)
**Owner:** Dave
**Design partner (deployment #1):** Teacher (academic pilot lead)
**Pilot window:** TBD — scheduling parked with Teacher engagement; build proceeds now
**v1.1 delta:** education role model established (Standard / Session / Assessment; Teacher / Student), premise reframed as proof-of-understanding layer. **Build scope unchanged from v1.**
**v1.2 delta (grilling revision):** institution class named + policy risk split from technical; Assignment added to the domain model (1:1 with Standard); INV-1 bar stated as detect-not-prevent; INV-2 gains designed break-glass + honest OpenAI retention posture; spend-cap edge semantics added (forgiving caps, mint-only breaker, all spend counts) + server-enforced time-box note; magic links expire; no audio at rest (ADR-0001); Standard shape (criteria + descriptors) and 3-level qualitative ratings; immediate Assessment auto-release; fresh examiner per Session; French deliberately unhandled.
**v1.3 delta:** written submission removed from v1. Each Session is an oral response to an Assignment, and its transcript is the sole evidence evaluated against the pinned Standard.
**v1.4 delta (MVP charting):** pilot dates unpinned — solo MVP, build proceeds now; institutional network/policy verification dropped as a blocking caveat (a safe, secure test setting is chosen at deployment); shadow-period release added for a deployment's first real Sessions; INV-4 time-box build note corrected — the server *can* end a live call via the Realtime calls hangup endpoint; oral-only scope reconfirmed: a Session probes a prompted question, no artifact or written submission; auth concretized — Privy email OTP + allowlist, hand-provisioned accounts, 7-day link expiry deferred to roster era.

---

## 1. Premise

As AI produces more answers, the scarce thing is demonstrated understanding. Detection asks "did AI make this?", a question that is unanswerable and getting worse. Viva makes it irrelevant: demonstrate what you understand live, with your voice, against a standard written by a human expert.

Viva is the proof-of-understanding layer: a voice-based examination in which a **Student** responds to a **Teacher**-defined **Assignment**, is probed by an AI examiner, and is assessed against a private **Standard** written by the Teacher. Speech is the escape-hatch-free format — no copy-paste, no model supplying the position, no hiding behind a written submission.

Viva v1 is an education product with two primary roles: a **Teacher** defines an Assignment and its evaluation Standard, and a **Student** completes one or more oral Sessions for that Assignment. The first deployment is a single course at a Canadian military college, run as pedagogy, not research (INV-2). Other domains, including litigation, are deferred.

## 2. Domain model

| Object | Definition | Deployment #1 binding |
|---|---|---|
| **Assignment** | A Teacher-defined oral task with a prompt; owns exactly one Standard and may have many Student Sessions | Course assignment |
| **Standard** | Teacher-authored definition of what a competent oral response to the Assignment must demonstrate; owned 1:1 by an Assignment | Teacher's evaluation standard for the assignment |
| **Session** | One time-boxed live voice response to an Assignment, conducted by the AI examiner; owns its transcript | The viva |
| **Assessment** | Structured evaluation of one Session transcript against the pinned Standard, plus examiner audit | Formative feedback + Teacher view |

Published Assignment versions are immutable. Editing an Assignment prompt or Standard creates a new version for future Sessions. Every Session pins the exact Assignment and Standard versions active at mint, owns one transcript, and receives one Assessment. Earlier Sessions and Assessments never change when a Teacher publishes a new version.

| Role | Definition | Deployment #1 binding |
|---|---|---|
| **Teacher** | Human expert who writes Standards and reviews Assessments | Teacher |
| **Student** | Person who completes oral Sessions and receives formative Assessments | Student |
| **Operator** | Runs the deployment; aggregate visibility only | Dave |

Naming rule: code, schema, API, UI copy, and documentation use **Teacher** and **Student** consistently for the two product roles.

## 3. Locked decisions

| Decision | Value | Consequence |
|---|---|---|
| Stakes | Formative only — no course marks (ADR-0002) | No proctoring, no identity-integrity requirements, no appeal flow |
| Attempts | Unlimited, all informal | No "official attempt" state machine; cost caps required instead (INV-4) |
| Scope | Single academic deployment | Litigation track deferred to v2; no multi-tenant build, but domain model is tenant-shaped |
| REB posture | Pedagogy pilot under TCPS 2 Art. 2.5 QI carve-out | No control group, no research claims from this pilot, transcripts stay in course boundary |
| Transport | OpenAI Realtime via `openai-agents-js` (`RealtimeAgent` / `RealtimeSession`, WebRTC) (ADR-0003) | Vendor lock-in on the session path accepted; test setting chosen at deployment |
| App stack | Next.js / Vercel / Convex | Standard stack; no new infra |
| Audio retention | No audio at rest — transcript is the only Session record (ADR-0001) | ASR-error risk accepted (formative stakes); transcript disputes resolved by Teacher judgment |

## 4. Invariants

Enforced in code, not prose. Each maps to at least one mechanism and one test. All four apply across education deployments.

**INV-1 — The examiner never supplies the Student's position.**
The AI may question, challenge, present counterexamples, and press on weaknesses. It must not state, outline, complete, or improve the Student's argument, and must not answer its own questions when the Student stalls.
Enforcement bar: prevention is prompt-level only; the classifier and audit are post-hoc, and mechanism (a) below is server-side *assembly*, not tamper-proofing (ADR-0005). The invariant the system actually guarantees is that no position-supply goes *unnoticed* — flags surface in operator metrics and in the Assessment's examiner audit, but a flagged Session is not blocked, invalidated, or state-changed.
*Mechanisms:* (a) examiner instructions injected server-side only, never constructed or visible client-side; (b) output guardrail — async (non-blocking, latency-protected) classifier pass over examiner turns flagging "supplied position / answered for the Student," with flagged turns logged and surfaced in operator metrics; (c) grader-side audit — post-session Assessment independently flags examiner violations in the transcript.
*Done-means:* red-team suite of ≥20 extraction attempts ("just tell me what you'd argue," "summarize my thesis better," silence-baiting) with 0 un-flagged position-supplies.

**INV-2 — No research data leaves the deployment boundary.**
Deployment #1 is quality improvement, not human-subjects research. No control group. No Student-level data exported for analysis or reporting.
*Mechanisms:* (a) Operator role has no read access to transcript content — aggregate metrics and error logs only, enforced in Convex access rules, not convention; (b) no analytics events containing utterance content; (c) OpenAI data handling stated honestly: standard API retention applies (≈30 days for abuse monitoring, not used for training) — true zero-retention requires an enterprise ZDR agreement we do not have at grant scale. This transient retention is disclosed in the data-flow picture used for institutional policy sign-off; (d) Cosmos deliverable language references prototype + Teacher-authored Standards + examiner assessment, never study findings.
*Debugging path (designed, not improvised):* default is synthetic Sessions with fake Students. If a real transcript must be read, the Teacher — who already has read access — explicitly shares that single transcript with the Operator; the share is a Teacher action, logged and permanently visible on the transcript. The Operator access rule itself is never bypassed.
*Done-means:* access-rule test proving Operator role cannot query transcript bodies (including via the share path without a Teacher grant); retention posture documented in repo (OpenAI policy reference + disclosure language used for policy sign-off).

**INV-3 — The Standard never enters the live Session.**
The Standard is used only by the post-session grader. The live examiner receives the Assignment prompt and generic probing behavior — nothing extractable that changes the exam if leaked.
*Mechanisms:* separate context assembly paths for examiner vs. grader; lint/test that the session-mint code path cannot reference Standard storage.
*Done-means:* "what are you grading me on?" red-team prompts yield no Standard content in ≥20 attempts.

**INV-4 — Spend is capped in code.**
Unlimited informal attempts + realtime voice pricing + fixed $5K grant = per-Student and global caps, enforced server-side at session mint.
*Mechanisms:* per-Student cap (default: 2 sessions/day, 8/week), global monthly budget circuit-breaker, hard session time-box (default: 15 min) with 2-min warning, all configurable by the Teacher within Operator-set ceilings.
*Edge semantics:* (a) Sessions under a minimum-duration floor (default: 3 min — e.g. network drop) do not burn an attempt; the mint cost is sunk but the Student is not punished. (b) The breaker blocks new mints only — it never terminates a live Session. (c) *All* model spend counts against the budget: realtime, grader, and guardrail classifier.
*Build note:* the time-box is enforced by our own server logic. OpenAI ephemeral tokens only limit connection *start*, not session duration; the platform cap is 60 min. The server *can* end a live call: at mint, schedule a job (Convex scheduler) that calls `POST /v1/realtime/calls/{call_id}/hangup` at 15:00 (call ID surfaced by the SDK from the WebRTC SDP exchange). The client countdown is UX, not enforcement; the server additionally refuses to persist or grade content past the cutoff.
*Done-means:* cap-exceeded mint request returns friendly refusal; budget breaker tested; short-session cap-forgiveness tested.

## 5. Architecture

```
Student browser (Next.js)
  → POST /api/session/mint             [auth via Privy email OTP, cap check, Assignment version pinned]
  → ephemeral Realtime token returned   [instructions assembled + injected server-side only]
  → RealtimeAgent("Examiner") / RealtimeSession over WebRTC
  → live Session (time-boxed, VAD/interruption via SDK)
  → transcript persisted to Convex      [deployment boundary]
  → post-session Grader (text model)    [transcript × Standard → Assessment]
  → Teacher dashboard                   [transcript + Assessment + INV-1 flags]
  → Student view                        [own transcript + formative feedback]
  → Operator view                       [aggregates, costs, flag rates — no content]
```

Examiner and grader are separate models with separate contexts. The examiner is optimized for conversational pressure; the grader is a stronger text model doing careful evaluation against the Standard, and additionally audits the examiner for INV-1 violations.

## 6. Access

| Role | Can do | Cannot do |
|---|---|---|
| Teacher | Create/version Assignments and Standards; upload roster; issue links; read all transcripts + Assessments; set caps within ceilings | Touch Operator config |
| Student | Take unlimited Sessions within caps; read own transcripts + feedback | Read others' anything; see the private Standard verbatim |
| Operator | Deploy; view aggregate metrics, spend, INV-1 flag rates, error logs | Read transcript content (INV-2, enforced) |

Auth: passwordless email login via Privy (6-digit one-time code — Privy has no magic-link variant; same property, nothing to remember, no passwords, no SSO). MVP accounts are **provisioned** by hand: one script pre-creates the Privy user (returning its DID), adds the email to Privy's allowlist, and inserts the Convex user row with its role. The allowlist blocks strangers at Privy's door — a non-allowlisted email cannot create an account at all — which, with per-Student caps (INV-4), bounds the budget-drain/boundary-pollution threat of any leaked credential. Impersonation remains a non-threat in v1 (nothing at stake). Voiding a Student is two steps: flip the Convex user status *and* delete the Privy user object (removing the allowlist entry alone does not revoke an existing user; lockout completes within the 1-hour access-token window). Auto-expiry of invitations (formerly 7 days) is deferred to roster-era link issuing — hand-provisioned accounts don't need it. ("Provision" = create an account; "mint" stays reserved for creating Sessions.)

## 7. Session shape (defaults — Teacher redlines)

- Examiner opens with one standard orientation question ("In two minutes, what is your response to this Assignment, and why?"), then probes the Student's spoken answer.
- 15-minute time-box, 2-minute warning (visual + spoken), hard stop.
- Live screen: countdown timer + live captions of the examiner's speech only (accessibility backstop for accents/audio quality; no captions of the Student's own speech — no live relitigating of ASR).
- Stall protocol: after two consecutive non-answers on a thread, examiner names the gap neutrally ("noting we couldn't establish X") and moves to a new thread; after three dead threads, ends the Session early. Never fills silence with the answer (INV-1).
- Deflection protocol: Student questions about grading, the Standard, or the examiner's opinion get a one-line redirect back to the Assignment and the Student's own answer.
- Examiner receives: pinned Assignment prompt + probing instructions. Nothing else (INV-3). In particular, no memory of prior Sessions: every Session is a cold oral response to the pinned Assignment version. (Prior *Assessments* are Standard-contaminated by construction, so feeding them forward would breach INV-3; transcript-based continuity is a noted v2 idea.)

## 8. Standard shape & Assessment output (per Session)

A Standard is 3–7 named criteria, each with a 1–3 sentence descriptor of what a competent oral response to the Assignment must demonstrate.

The Assessment is a structured evaluation against the Standard: per-criterion rating on a 3-level qualitative scale — **Established / Partially established / Not established**, plus **Not probed** when a criterion never arose in the Session — + evidence quotes from transcript + formative summary written to the Student + INV-1 audit flags. Deliberately not numeric: numbers get averaged and averages become grades, which §3 locks out. Teacher sees everything; Student sees formative summary + own transcript.

The grader receives the transcript as quoted evidence, never as instructions. Student speech is attacker-controlled, so the grader prompt explicitly treats instructions inside the transcript as inert. Residual spoken prompt-injection risk is accepted in v1 because Assessments are formative; it must be closed before any stakes-bearing deployment.

Two further residuals are accepted on the same terms and for the same reason, and are written down rather than left implicit: the transcript is authored by the browser and is therefore forgeable (ADR-0004), and INV-1's instruction integrity is a property of the client we ship rather than one the platform enforces (ADR-0005). Both are bounded by formative-only stakes (ADR-0002) and both must be closed before any stakes-bearing deployment.

Release: immediate auto-release — grading runs directly after the Session and the formative summary reaches the Student within minutes, while the defense is warm. No Teacher gate (the loop's tempo must not depend on one busy person); the Teacher sees every Assessment on the dashboard and can flag bad feedback after the fact.

Cold-start exception — **shadow period**: a deployment's first real Sessions release Assessments to the Teacher only. Once the Teacher has spot-checked Grader quality, auto-release becomes the steady state. The gate exists once, at the start of a deployment — never per-Assessment.
