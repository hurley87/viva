"use client";

import { useLoginWithEmail, usePrivy } from "@privy-io/react-auth";
import { useConvexAuth, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "../../convex/_generated/api";

const fieldClassName =
  "w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";
const buttonClassName =
  "rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

export function AuthPanel() {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!privyAppId) {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Privy is not configured. Set{" "}
        <code className="font-mono">NEXT_PUBLIC_PRIVY_APP_ID</code> in{" "}
        <code className="font-mono">.env.local</code> after creating a Privy
        app (email login only, allowlist on).
      </p>
    );
  }

  return <PrivyAuthPanel />;
}

function PrivyAuthPanel() {
  const { ready, authenticated, logout } = usePrivy();
  const { isLoading: isConvexAuthLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");

  if (!ready) {
    return <p>Loading authentication…</p>;
  }

  if (!authenticated) {
    return <EmailOtpForm />;
  }

  if (isConvexAuthLoading) {
    return <p>Connecting to Convex…</p>;
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col gap-3">
        <p>
          Your sign-in session is no longer valid. Sign out and request a new
          email code.
        </p>
        <button type="button" className={buttonClassName} onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    );
  }

  if (me === undefined) {
    return <p>Connecting to Convex…</p>;
  }

  if (me === null) {
    return (
      <div className="flex flex-col gap-3">
        <p>
          Signed in with Privy, but there is no active Viva account for this
          email. Ask an Operator to provision you.
        </p>
        <button type="button" className={buttonClassName} onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p>
        Signed in as <span className="font-medium">{me.displayName}</span>{" "}
        <span className="text-zinc-600 dark:text-zinc-400">
          ({me.email}, {me.role})
        </span>
      </p>
      <button type="button" className={buttonClassName} onClick={() => void logout()}>
        Sign out
      </button>
    </div>
  );
}

function EmailOtpForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { sendCode, loginWithCode, state } = useLoginWithEmail();

  const isSending = state.status === "sending-code";
  const isSubmitting = state.status === "submitting-code";
  const awaitingCode =
    state.status === "awaiting-code-input" ||
    state.status === "submitting-code" ||
    state.status === "done";

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await sendCode({ email: email.trim() });
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await loginWithCode({ code: code.trim() });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Provisioned accounts sign in with a one-time code emailed by Privy.
      </p>
      <form className="flex flex-col gap-2" onSubmit={(event) => void handleSend(event)}>
        <label className="text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={fieldClassName}
        />
        <button type="submit" className={buttonClassName} disabled={isSending || email.trim() === ""}>
          {isSending ? "Sending code…" : "Send code"}
        </button>
      </form>
      {awaitingCode ? (
        <form className="flex flex-col gap-2" onSubmit={(event) => void handleLogin(event)}>
          <label className="text-sm font-medium" htmlFor="code">
            One-time code
          </label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className={fieldClassName}
          />
          <button
            type="submit"
            className={buttonClassName}
            disabled={isSubmitting || code.trim() === ""}
          >
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      ) : null}
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
