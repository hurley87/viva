"use client";

// Browser providers: Privy for authentication, Convex for data, bridged.
//
// Privy is not one of Convex's pre-integrated providers, so the bridge is the
// generic `ConvexProviderWithAuth` with a `useAuth`-shaped adapter that hands
// Convex the Privy access token. Convex verifies it against the app's JWKS
// (see convex/auth.config.ts); `ctx.auth.getUserIdentity().subject` is then the
// Privy DID that convex/lib/identity.ts resolves to a `users` row.
//
// Privy config: email login only, embedded wallets explicitly off. Viva has no
// use for a wallet; `createOnLogin` already defaults to 'off', and it is set
// anyway so a future default change cannot quietly create one. The matching
// app-level settings (email login on, wallet login off, allowlist enabled) live
// in the Privy app itself — see the README.

import {
  PrivyProvider,
  getAccessToken,
  usePrivy,
} from "@privy-io/react-auth";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useMemo, type ReactNode } from "react";

function requirePublicEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. See the README for .env.local setup.`);
  }
  return value;
}

const privyAppId = requirePublicEnv(
  "NEXT_PUBLIC_PRIVY_APP_ID",
  process.env.NEXT_PUBLIC_PRIVY_APP_ID,
);

const convex = new ConvexReactClient(
  requirePublicEnv("NEXT_PUBLIC_CONVEX_URL", process.env.NEXT_PUBLIC_CONVEX_URL),
);

/**
 * Fetch the current Privy access token for Convex.
 *
 * Defined at module scope on purpose. Convex documents that if the `useAuth`
 * prop's returned `fetchAccessToken` identity changes, auth transitions back to
 * loading and the token is fetched again — a function rebuilt on every render
 * would keep auth permanently unsettled. This uses the standalone
 * `getAccessToken` export (not the `usePrivy()` method, whose identity is not
 * guaranteed stable) so there is nothing to memoize.
 *
 * `forceRefreshToken` is accepted and ignored: Privy owns its own refresh, and
 * `getAccessToken` already returns a freshly refreshed token when the current
 * one is expired or near expiry.
 */
async function fetchAccessToken({
  forceRefreshToken,
}: {
  forceRefreshToken: boolean;
}): Promise<string | null> {
  void forceRefreshToken;
  return await getAccessToken();
}

/** The `useAuth` adapter Convex expects, backed by Privy's session state. */
function useAuthFromPrivy() {
  const { ready, authenticated } = usePrivy();
  return useMemo(
    () => ({
      // `ready` is Privy rehydrating an existing session; until it settles we
      // do not yet know whether there is a caller.
      isLoading: !ready,
      isAuthenticated: ready && authenticated,
      fetchAccessToken,
    }),
    [ready, authenticated],
  );
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ["email"],
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
        appearance: { theme: "light" },
      }}
    >
      <ConvexProviderWithAuth client={convex} useAuth={useAuthFromPrivy}>
        {children}
      </ConvexProviderWithAuth>
    </PrivyProvider>
  );
}
