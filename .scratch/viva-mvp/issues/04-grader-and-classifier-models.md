# Grader model choice

Type: grilling
Status: resolved

## Question

The PRD says only "a stronger text model" for the Grader. (The async guardrail classifier was deferred out of the MVP by [MVP surface cut] — its model choice moved to that fog item.) Decide:

1. Which provider runs the **Grader** (transcript × Standard → Assessment + Examiner audit) — same OpenAI account as realtime (one bill, one data-flow/retention story) or a second vendor picked for evaluation quality?
2. Which model/tier — the Grader runs once per Session, so it's low-volume relative to realtime spend.
3. Structured-output approach for the Assessment (per-criterion ratings incl. "Not probed", evidence quotes, formative summary, INV-1 flags).

Input when available: [Cost model] ticket results. Constraint: all model spend counts against the INV-4 budget.

## Answer

Resolved 2026-08-26 by grilling.

1. **Provider: OpenAI-only** (user decision). One vendor, one bill against the $5K grant, one data processor in the INV-2 disclosure. Accepted trade-off: the Examiner's own vendor performs the INV-1 audit (less cross-vendor independence).
2. **Model: top OpenAI text tier**, default **gpt-5.6-sol** ($4/$20 per MTok as of 2026-08; gpt-5.5 at $5/$30 is the alternative). Grader runs once per Session (~5–10K tokens in, ~1–2K out ≈ a few cents), <5% of per-Session spend vs ~$1–3 of realtime audio — so quality over price; pin the exact model at build time against the then-current lineup. [Cost model] ticket validates.
3. **Structured output: confirmed important** (user). One Zod schema defines the Assessment — per-criterion rating enum (`established | partially_established | not_established | not_probed`), verbatim evidence quotes, formative summary, INV-1 audit flags — used both as OpenAI strict structured-output schema on the grader call and as the Convex Assessment table type. No parsing layer. Transcript enters the prompt as quoted, injection-inert evidence per prd.md §8.

Remaining detail (grader prompt wording, evaluating against a real Standard fixture) stays in fog until a Standard exists.
