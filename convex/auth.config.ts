import type { AuthConfig } from "convex/server";

const privyAppId = process.env.PRIVY_APP_ID ?? "";

/**
 * Convex verifies Privy access tokens as custom JWTs.
 * issuer must be exactly `privy.io` (not a URL). applicationID must equal the
 * token `aud` (Privy app ID). Privy publishes JWKS at a non-OIDC path:
 * `https://auth.privy.io/api/v1/apps/<PRIVY_APP_ID>/jwks.json`
 * (the `.well-known/` variant 404s and leaves the client waiting on auth).
 */
export default {
  providers: [
    {
      type: "customJwt",
      issuer: "privy.io",
      applicationID: privyAppId,
      algorithm: "ES256",
      jwks: `https://auth.privy.io/api/v1/apps/${privyAppId}/jwks.json`,
    },
  ],
} satisfies AuthConfig;
