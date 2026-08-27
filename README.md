# Viva

Viva is a voice-based proof-of-understanding product for education. A Teacher creates an Assignment and private evaluation Standard; a Student responds in a live voice Session; Viva evaluates the transcript and returns formative feedback.

## Status

Viva is at the product-definition and application-scaffold stage. The repository currently contains the approved PRD, architecture decisions, and a Next.js foundation. The live examination flow is not implemented yet.

## Core flow

```text
Assignment → Session → Transcript → Assessment
```

- The live Examiner receives the Assignment prompt, but never the private Standard.
- The Grader evaluates the Session transcript against the pinned Standard.
- Assessments are formative only; they are not grades or high-stakes decisions.
- Raw Session audio is never stored.

## Documentation

- [Product requirements](docs/prd.md)
- [Product language](CONTEXT.md)
- [Architecture decisions](docs/adr)

## Local development

```bash
npm install
npm run dev
```

`npm run dev` starts Convex and Next.js together. Open [http://localhost:3000](http://localhost:3000).

After Convex is configured, seed the demo Teacher, Assignment, published version, Standard, and deployment config:

```bash
npm run seed
```

## Auth (Privy + Convex)

Accounts are **provisioned**, not self-serve. Copy `.env.example` to `.env.local` and fill in Convex plus Privy values. Also set the app ID on the Convex deployment (read by `convex/auth.config.ts`):

```bash
npx convex env set PRIVY_APP_ID "<your-privy-app-id>"
```

Privy dashboard (leftover until done once): enable **email** login only, turn **allowlist** on, do not configure embedded wallets.

Provision a Teacher, Student, or Operator in one command (creates the Privy user, allowlists the email, inserts the Convex row):

```bash
npm run provision -- --email you@example.com --role student --displayName "Ada Lovelace"
```

`--role` is `student`, `teacher`, or `operator`.

Void an account (Convex `status=voided` and delete the Privy user):

```bash
npm run provision:void -- --email you@example.com
```

Useful checks:

```bash
npm run lint
npm run build
```
