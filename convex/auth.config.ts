import type { AuthConfig } from "convex/server";

const privyAppId = process.env.PRIVY_APP_ID ?? "";

/**
 * Convex verifies Privy access tokens as custom JWTs.
 * issuer must be exactly `privy.io` (not a URL). applicationID must equal the
 * token `aud` (Privy app ID). JWKS URL is community-documented — curl-verify
 * `https://auth.privy.io/api/v1/apps/<PRIVY_APP_ID>/.well-known/jwks.json`
 * after setting PRIVY_APP_ID. If that 404s, pin the dashboard SPKI/JWKS as a
 * data URI on `jwks` instead.
 */
export default {
  providers: [
    {
      type: "customJwt",
      issuer: "privy.io",
      applicationID: privyAppId,
      algorithm: "ES256",
      jwks: `https://auth.privy.io/api/v1/apps/${privyAppId}/.well-known/jwks.json`,
    },
  ],
} satisfies AuthConfig;
