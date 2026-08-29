"use client";

import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import {
  ConvexProvider,
  ConvexProviderWithAuth,
  ConvexReactClient,
} from "convex/react";
import { useCallback, useMemo, type ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

if (!convexUrl) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
}

const convex = new ConvexReactClient(convexUrl);

function useAuthFromPrivy() {
  const { ready, authenticated, getAccessToken } = usePrivy();

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      void forceRefreshToken;
      if (!authenticated) {
        return null;
      }
      try {
        return (await getAccessToken()) ?? null;
      } catch {
        return null;
      }
    },
    [authenticated, getAccessToken],
  );

  return useMemo(
    () => ({
      isLoading: !ready,
      isAuthenticated: authenticated,
      fetchAccessToken,
    }),
    [ready, authenticated, fetchAccessToken],
  );
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!privyAppId) {
    return <ConvexProvider client={convex}>{children}</ConvexProvider>;
  }

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "dark" },
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
      }}
    >
      <ConvexProviderWithAuth client={convex} useAuth={useAuthFromPrivy}>
        {children}
      </ConvexProviderWithAuth>
    </PrivyProvider>
  );
}
