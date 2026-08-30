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

Open [http://localhost:3000](http://localhost:3000).

Useful checks:

```bash
npm run typecheck
npm run lint
npm run build
```

### Environment

`.env.local` (gitignored) holds:

| Variable | Used by |
| --- | --- |
| `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL` | Convex CLI and browser client |
| `NEXT_PUBLIC_PRIVY_APP_ID` | the browser Privy provider |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | the provision script |
| `OPENAI_API_KEY` | Sessions and the Grader |

Convex functions never read `.env.local`. Anything the backend needs must also
be set on the deployment:

```bash
npx convex env set PRIVY_APP_ID <app id>     # required by convex/auth.config.ts
npx convex env set OPENAI_API_KEY <key>
```

## Authentication

Privy owns authentication; Convex owns the user record. A Student or Teacher
signs in with a six-digit code emailed by Privy, the browser hands Convex the
resulting access token, and Convex verifies it against the Privy app's JWKS
(`convex/auth.config.ts`) to get the caller's Privy DID. `convex/lib/identity.ts`
resolves that DID to the `users` row that carries the role. Every non-public
Convex function resolves its caller that way — never from an argument.

There is no sign-up. Accounts exist only because somebody ran the provision
script.

### Privy app settings

These are app-level and must be true for the flow above to hold. They can be
read back with `GET https://api.privy.io/v1/apps/<app-id>` and are set in the
Privy Dashboard:

| Setting | Value | Dashboard location |
| --- | --- | --- |
| Email login | enabled | Login methods |
| Wallet / social / SMS / passkey login | disabled | Login methods |
| Embedded wallets (`create_on_login`) | `off` | Embedded wallets |
| Allowlist | enabled | Users → Access control |

The allowlist is what stops a stranger: Privy rejects a non-allowlisted email at
`passwordless/init` with `allowlist_rejected` before any account is created. The
client asks for a code with `disableSignup: true` as a second, independent
guard.

## Provisioning accounts

`provision` is the one command that creates an account (CONTEXT.md: *provision*
creates accounts; *mint* is only ever for Sessions). It creates the Privy user,
adds the email to the Privy allowlist, and inserts the Convex `users` row with
its role — all three, or the account is broken.

```bash
npm run provision -- --email=ada@example.edu --role=student --name="Ada Lovelace"
npm run provision -- --email=ada@example.edu --role=teacher --name="Ada Lovelace"
```

`--role` is `student`, `teacher`, or `operator`. Re-running for the same person
converges rather than duplicating; provisioning a Teacher while the seeded
placeholder Teacher is still unclaimed adopts that row, so the seeded
Assignment stays owned by a Teacher who can actually sign in.

Voiding removes access:

```bash
npm run provision -- --email=ada@example.edu --void
```

That flips the Convex row to `voided` (effective on the caller's very next
Convex function call), removes the allowlist entry, and deletes the Privy user
object. The deletion is required: removing an allowlist entry does not revoke
access for somebody who has already logged in.
