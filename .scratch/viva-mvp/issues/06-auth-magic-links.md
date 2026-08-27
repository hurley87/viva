# Auth via Privy

Type: grilling
Status: resolved
Blocked by: 02

## Question

Provider is decided: **Privy** ([MVP surface cut]). Resolve the integration mechanics within prd.md §6's frame (magic links, no SSO/passwords) and the MVP cut (hand-minted Students, no roster UI):

- How Privy's email magic-link/OTP flow maps onto the PRD's "Teacher-issued link against a roster": does a Student get pre-provisioned in Privy (allowlist) or does first-login create them, and how do we stop strangers (leaked-link budget-drain threat, §6)?
- Privy ↔ Convex identity bridge: verifying Privy auth tokens in Convex (custom JWT/OIDC provider config), and which system owns the user record.
- Role assignment (Teacher / Student / Operator) — where it lives and how it's set for hand-minted users.
- Link/access expiry and void semantics with Privy in the loop (PRD default: 7 days, Teacher can void) — what's a Privy feature vs. our own field flip.
- What of Privy we deliberately don't use (wallets, etc.).

Likely wants a small research pass (Privy docs + Convex auth docs) before the decisions.

## Research findings

Researched 2026-08-26 from docs.privy.io and docs.convex.dev.

### 1. Privy email flow (magic link vs OTP, allowlist)

- Privy's current email login is **passwordless OTP (one-time code)**, driven by the `useLoginWithEmail` hook (`sendCode` → `loginWithCode`) in `@privy-io/react-auth`. The current docs do not offer a magic-link variant for email — OTP is the flow. Email auth must be enabled in the Privy Dashboard first. (https://docs.privy.io/authentication/user-authentication/login-methods/email)
  - Note for the PRD's "magic link" language: what Privy ships is a 6-digit emailed code, not a clickable link. Any "click a link to get in" UX would be our own layer on top. Magic-link support anywhere in current Privy docs: UNCONFIRMED (not found).
- **First-class allowlist exists.** Dashboard: Users → Access Control → toggle allowlist on; add comma-separated emails/phones/wallets. When enabled, "new users who have not been added to your allowlist will not be permitted to login" — enforcement is at Privy, before an account is created, which directly answers the leaked-link/stranger threat. Existing users keep access. The rejection screen is customizable (`error_title`, `error_detail`, `cta_text`, `cta_link`). (https://docs.privy.io/user-management/users/managing-users/allowlist)
- Allowlist API (usable from a Convex action or ops script):
  - `POST https://auth.privy.io/api/v1/apps/<app-id>/allowlist` — add entry (`{type: 'email', value: ...}`); Node SDK `privy.apps().inviteToAllowlist(...)`
  - `DELETE https://auth.privy.io/api/v1/apps/<app-id>/allowlist` — remove; `privy.apps().removeFromAllowlist(...)`
  - `GET https://auth.privy.io/api/v1/apps/<app-id>/allowlist` — list; `privy.apps().getAllowlist()`
  (https://docs.privy.io/user-management/users/managing-users/allowlist)
- Revocation caveat: once someone has logged in, removing their allowlist entry is NOT enough — "you must delete their user object" to revoke access. (same page)

### 2. Pre-provisioning users and the stable identifier

- Yes — users can be created ahead of first login via API: `POST /v1/users` ("Create user") with linked accounts (e.g. an email), and a batch import endpoint for migrations (array of `ImportUserInput`). When the user later logs in with that email, they get the pre-created user object. (https://docs.privy.io/api-reference/users/create, https://docs.privy.io/user-management/migrating-users-to-privy/import-a-user, https://docs.privy.io/guide/server/migration/batch)
- So for hand-minted Students we have two Privy-native options: (a) allowlist-only (user object created at first login), or (b) pre-create the user via API *and* allowlist the email. Either way the stranger-blocking is Privy-side via the allowlist.
- **Stable identifier: the Privy DID**, format `did:privy:<id>` (e.g. `did:privy:clfn2wysq01ijykc8gyq2j2t1`), returned on create and present in every access token's `sub` claim. (https://docs.privy.io/api-reference/users/create, https://docs.privy.io/authentication/user-authentication/access-tokens)

### 3. Privy ↔ Convex bridge

- **Privy access token shape**: ES256-signed JWT with claims `sub` (Privy DID), `sid` (session id), `iss` = `privy.io` (a bare string, not a URL), `aud` = your Privy app ID, `iat`, `exp` (~1 hour). Client obtains it via `getAccessToken()` from `@privy-io/react-auth`, which auto-refreshes near expiry. (https://docs.privy.io/authentication/user-authentication/access-tokens)
- **JWKS**: `https://auth.privy.io/api/v1/apps/<app-id>/.well-known/jwks.json`. This URL is widely used in third-party integrations (e.g. Supabase discussion) and matches Privy's auth host; docs.privy.io primarily documents verification via the app's SPKI public key (dashboard/API) or `@privy-io/node` `privy.utils().auth().verifyAccessToken()`. Exact JWKS URL on a docs.privy.io page: UNCONFIRMED — verify against the dashboard/`curl` before shipping. (https://github.com/orgs/supabase/discussions/34744, https://docs.privy.io/authentication/user-authentication/access-tokens)
- **Convex side**: no first-class Privy page in Convex docs (they cover Clerk/Auth0/WorkOS); the documented path is the **Custom JWT provider** (`type: "customJwt"`) in `convex/auth.config.ts` — Convex supports ES256, and requires `issuer` to exactly match `iss` and `applicationID` to exactly match `aud`. (https://docs.convex.dev/auth/advanced/custom-jwt)

  ```ts
  // convex/auth.config.ts (community-verified pattern, not an official Convex+Privy guide)
  export default {
    providers: [{
      type: "customJwt",
      issuer: "privy.io",                    // must equal the token's iss exactly
      applicationID: process.env.PRIVY_APP_ID, // matches aud
      jwks: "https://auth.privy.io/api/v1/apps/<app-id>/.well-known/jwks.json",
      algorithm: "ES256",
    }],
  };
  ```
  Convex requires the JWT to carry `kid`/`alg`/`typ` headers and `sub`/`iss`/`exp` (+`iat`) claims — Privy's access token satisfies all of these. A `jwks` data URI is also allowed if we want to pin the key and avoid the network fetch. (https://docs.convex.dev/auth/advanced/custom-jwt)
- **`ctx.auth.getUserIdentity()`**: returns the standard claims — `subject` = the Privy DID (`did:privy:...`), `issuer` = `privy.io`, and `tokenIdentifier` = issuer + subject. Custom nested claims are flattened (e.g. `authInfo["properties.id"]`), but Privy's access token carries no email/profile claims — only the DID — so Convex must map DID → its own `users` row (Convex owns the app-level user record: role, expiry, teacher links; Privy owns only authentication). To get the email server-side, either look it up once via `GET /v1/users/{user_id}` or use Privy's separate **identity token** feature. (https://docs.convex.dev/auth/advanced/custom-jwt, https://docs.privy.io/api-reference/users/get)
- Client wiring: Privy is not one of Convex's pre-integrated providers, so the React side uses `ConvexProviderWithAuth` (generic) with a `useAuth`-shaped adapter that calls Privy's `getAccessToken()` — the standard custom-provider pattern. (https://docs.convex.dev/auth/advanced/custom-auth)

### 4. Next.js integration

- Client SDK: **`@privy-io/react-auth`** — wrap the app in `<PrivyProvider appId=... config=...>`; for App Router this must live in a `'use client'` component near the root layout, and components should gate on the `ready` boolean from `usePrivy()`. (https://docs.privy.io/basics/react/setup)
- Server SDK: **`@privy-io/node`** is current; **`@privy-io/server-auth` is deprecated** (migration guide exists — new package uses `{appId, appSecret}` constructor, resource-scoped methods, snake_case params, throws `NotFoundError` instead of returning null). Token verification: `privy.utils().auth().verifyAccessToken()` returning `{userId, appId, sessionId, expiration}`; third-party verification via `jose`/`jsonwebtoken` against the ES256 public key is also documented. (https://docs.privy.io/basics/nodeJS/advanced/migrating-from-server-auth, https://docs.privy.io/authentication/user-authentication/access-tokens)
- For Viva, most server-side verification happens in Convex via JWKS (no `@privy-io/node` needed on the hot path); the Node SDK is only needed for ops (allowlist management, pre-creating/deleting users).

### 5. Sessions, revocation, and expiry

- Lifetimes: **access token ~1 hour**, **refresh token 30 days, single-use, rotated on each refresh** (refresh can only renew existing sessions, never create new ones). When refresh fails the user is logged out. (https://docs.privy.io/security/authentication/user-authentication, https://docs.privy.io/authentication/user-authentication/access-tokens)
- Force-revoke: **delete the user object** — `DELETE /v1/users/{user_id}` (204 on success; Basic Auth with app ID + secret). Per the allowlist doc this is the stated mechanism for revoking an already-logged-in user; combined with the 1-hour access token, lockout takes effect within ≤1 hour of deletion (Convex keeps honoring an already-issued JWT until its `exp`). A softer dashboard "ban/suspend" that preserves the user object: UNCONFIRMED — not found in current docs. There is also a Denylist feature for blocking identifiers (https://docs.privy.io/user-management/users/managing-users/denylist). (https://docs.privy.io/api-reference/users/delete, https://docs.privy.io/user-management/users/managing-users/allowlist)
- **No built-in "invite expires after N days"**: allowlist entries and pre-created users do not carry expiry in the docs. The PRD's 7-day link expiry and Teacher "void" are **application-level**: store `expiresAt`/`voided` on the Convex user/invite row, check it in every Convex function (and on void, optionally delete the Privy user + remove the allowlist entry to also block re-login). UNCONFIRMED that any Privy-native expiry exists — none found.
- Note: even with allowlist enforcement, per-user access checks belong in Convex functions anyway, since a valid Privy JWT only proves identity, not entitlement.

### 6. What to disable/ignore (non-crypto app)

- **Embedded wallet creation is opt-in**: wallets are auto-created only if you set `embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } }` (or similar) in the `PrivyProvider` config — "to disable wallet creation, simply omit this configuration." So: omit `embeddedWallets` entirely, and enable only Email as a login method in the dashboard (no wallet/SIWE/social login methods). (https://docs.privy.io/basics/react/setup, https://docs.privy.io/basics/get-started/dashboard/configure-login-methods)
- Ignore wholesale: wallet pregeneration, server wallets/session signers, policies/authorization keys, funding/on-ramp, and the `sid` session-signer machinery — all wallet-oriented. Nothing there needs active disabling beyond not enabling wallet login methods; the allowlist's wallet-address entry type is simply unused.
- The `did:privy:` DID format is cosmetic crypto heritage; it is just the stable user ID string (store it verbatim as the Convex `users.privyDid` / `tokenIdentifier` key).

## Answer

Resolved 2026-08-26 by grilling (research findings above).

1. **OTP accepted** — Privy's email login is a 6-digit one-time code, no magic-link variant; PRD §6 updated (same security property, zero custom build).
2. **Provision-script model** — one script pre-creates the Privy user (DID returned immediately, so the schema's required `privyDid` holds), adds the email to Privy's allowlist, and inserts the Convex user row with role. Terminology pinned in CONTEXT.md: **provision** = create an account; **mint** stays reserved for Sessions.
3. **7-day expiry dropped for MVP** — it protected mass-issued roster links, which the MVP doesn't have. Void = flip Convex `status` + delete the Privy user object (allowlist removal alone doesn't revoke; lockout ≤ 1h token window). Expiry returns with roster-era issuing.
4. **Bridge confirmed (fact-settled):** Convex owns the app user record; `customJwt` provider (`issuer: "privy.io"`, ES256, per-app JWKS — curl-verify the JWKS URL at build, it's UNCONFIRMED on official docs); client uses `ConvexProviderWithAuth` + Privy `getAccessToken()` adapter; server ops via `@privy-io/node` (`@privy-io/server-auth` is deprecated); email-only login, embedded wallets left unconfigured.

Docs updated: prd.md §5/§6 + v1.4 delta line; CONTEXT.md gains **Mint** / **Provision** under Operations.
