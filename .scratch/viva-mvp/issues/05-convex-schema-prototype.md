# Convex schema prototype

Type: prototype
Status: resolved
Blocked by: 02

## Question

Turn the domain model into a concrete Convex schema + access-rule stub to react to:

- Assignment/Standard with published-version immutability; Session pinning of exact versions at mint.
- Session → one transcript, one Assessment; minimum-duration floor + cap accounting (INV-4 edge semantics).
- Roles (Teacher/Student/Operator) and the INV-2 rule as code: Operator cannot read transcript bodies; Teacher-granted single-transcript share is logged and permanently visible.
- Magic-link/roster tables: cut ([MVP surface cut] resolved) — identity comes from **Privy**, users are hand-minted; schema needs a user row with role + Privy identity link, no roster/link tables. Coordinate with [Auth via Privy](06-auth-magic-links.md).
- Shadow-period release state (prd.md §8 v1.4): per-deployment flag governing whether Assessments are Teacher-only or auto-released.

Deliverable: `schema.ts` + access-rules sketch linked from this ticket, not merged code.

**Asset:** [05-schema.prototype.ts](../assets/05-schema.prototype.ts) — awaiting reaction.

## Answer

Resolved 2026-08-26 — user reviewed the prototype and approved it as-is ("looks right").

Validated decisions the build inherits:
1. Standard in its own table + module (INV-3 physical separation; mint path lint-checked to never import it).
2. Sessions pin `assignmentVersionId`; versions immutable by construction (no update mutation).
3. Cap forgiveness is a `countsAgainstCaps` flag, not a status; status machine stays `minted → live → ended`.
4. Shadow period = `deploymentConfig.releaseMode` + per-assessment `released` flag; Student view projects only formativeSummary + own transcript.
5. Missing/truncated transcript text is a modeled legal state (`textStatus: failed | truncated`).
Plus: permanent `transcriptShares` break-glass log (INV-2), `spendEvents` monthly breaker checked at mint only, four-step mint mutation with scheduled hangup.

Asset: [05-schema.prototype.ts](../assets/05-schema.prototype.ts) (prototype, not merged; lift into `convex/schema.ts` at build time and verify Convex API syntax then).
