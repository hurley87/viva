// Privy → Convex identity bridge.
//
// Privy is not one of Convex's pre-integrated providers, so the bridge is the
// generic Custom JWT provider. Privy's access token is an ES256 JWT whose
// `sub` is the user's Privy DID (`did:privy:…`), `iss` is the bare string
// `privy.io` — not a URL — and `aud` is the Privy app id. Convex requires
// `issuer` and `applicationID` to match those claims exactly.
//
// `PRIVY_APP_ID` must be set on the Convex *deployment*, not just in
// `.env.local`: Convex functions never read the Next.js env file.
//
//     npx convex env set PRIVY_APP_ID <app id>
//
// The JWKS URL has no `.well-known` segment. The `.well-known` form cited in
// the research ticket (.scratch/viva-mvp/issues/06-auth-magic-links.md) 404s;
// this form was curl-verified against this deployment's app id and returns two
// EC P-256 keys with `"alg":"ES256"`. The equivalent
// `https://api.privy.io/v1/apps/<app-id>/jwks.json` also serves them.

import type { AuthConfig } from "convex/server";

const appId = process.env.PRIVY_APP_ID;
if (!appId) {
  throw new Error(
    "PRIVY_APP_ID is not set on this Convex deployment. " +
      "Run `npx convex env set PRIVY_APP_ID <app id>` before deploying.",
  );
}

export default {
  providers: [
    {
      type: "customJwt",
      // Must equal the access token's `aud`.
      applicationID: appId,
      // Must equal the access token's `iss` exactly — a bare string.
      issuer: "privy.io",
      jwks: `https://auth.privy.io/api/v1/apps/${appId}/jwks.json`,
      algorithm: "ES256",
    },
  ],
} satisfies AuthConfig;
