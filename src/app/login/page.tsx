"use client";

// Sign-in: Privy email one-time code. Two steps — enter the email, then the
// six-digit code Privy emails back.
//
// Accounts are not created here. They are created by the provision script
// (`npm run provision`), which pre-creates the Privy user and allowlists the
// email. This page enforces that twice over: the Privy app's allowlist rejects
// an unknown email server-side, and `disableSignup: true` makes `sendCode`
// fail outright for an email that has no Privy user. Either way a stranger
// gets a refusal, not an account.

import { useLoginWithEmail, usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

/**
 * Privy's rejection messages are terse and mention Privy, not Viva. Translate
 * the ones a Student can actually hit into something that says what to do.
 */
function explainError(error: Error | null): string {
  const raw = error?.message ?? "";
  const lowered = raw.toLowerCase();
  if (
    lowered.includes("allowlist") ||
    lowered.includes("not allowed") ||
    lowered.includes("disabled signup") ||
    lowered.includes("signup") ||
    lowered.includes("does not exist") ||
    lowered.includes("user not found")
  ) {
    return (
      "This address has not been provisioned for Viva. Accounts are created " +
      "by hand — ask your Teacher to have yours provisioned, then try again."
    );
  }
  if (lowered.includes("code") && lowered.includes("invalid")) {
    return "That code was not correct. Check it and try again, or request a new one.";
  }
  if (lowered.includes("expired")) {
    return "That code has expired. Request a new one.";
  }
  return raw === "" ? "Sign-in failed. Try again." : raw;
}

export default function LoginPage() {
  const router = useRouter();
  const { ready, authenticated } = usePrivy();
  const { sendCode, loginWithCode, state } = useLoginWithEmail();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  // Which step to render. Tracked locally rather than read off `state.status`
  // because Privy collapses a failed code to `status: "error"`, which would
  // otherwise throw the Student back to the email field with their code lost.
  const [step, setStep] = useState<"email" | "code">("email");

  // A signed-in visitor has no business on the sign-in page.
  useEffect(() => {
    if (ready && authenticated) {
      router.replace("/");
    }
  }, [ready, authenticated, router]);

  const awaitingCode = step === "code";
  const busy =
    state.status === "sending-code" ||
    state.status === "submitting-code" ||
    state.status === "done";
  const errorMessage =
    state.status === "error" ? explainError(state.error) : null;

  function requestCode() {
    setCode("");
    void sendCode({ email: email.trim(), disableSignup: true }).then(
      () => setStep("code"),
      // The error surfaces through `state`; the step must not advance.
      () => setStep("email"),
    );
  }

  function onSendCode(event: FormEvent) {
    event.preventDefault();
    requestCode();
  }

  function onVerifyCode(event: FormEvent) {
    event.preventDefault();
    void loginWithCode({ code: code.trim() });
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-24 dark:bg-black">
      <main className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Sign in to Viva
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {awaitingCode
            ? `Enter the six-digit code sent to ${email}.`
            : "Enter the address your account was provisioned with. Viva will email you a six-digit code."}
        </p>

        {!ready ? (
          <p className="mt-8 text-sm text-zinc-500">Loading…</p>
        ) : awaitingCode ? (
          <form onSubmit={onVerifyCode} className="mt-8 space-y-4">
            <div>
              <label
                htmlFor="code"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Six-digit code
              </label>
              <input
                id="code"
                name="code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                autoFocus
                className="mt-1.5 w-full rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-lg tracking-[0.3em] text-black outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-300"
              />
            </div>
            <button
              type="submit"
              disabled={busy || code.trim().length === 0}
              className="w-full rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-black"
            >
              {state.status === "submitting-code" ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              onClick={requestCode}
              className="w-full text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400"
            >
              Send a new code
            </button>
          </form>
        ) : (
          <form onSubmit={onSendCode} className="mt-8 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                autoFocus
                className="mt-1.5 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-base text-black outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-300"
              />
            </div>
            <button
              type="submit"
              disabled={busy || email.trim().length === 0}
              className="w-full rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-black"
            >
              {state.status === "sending-code" ? "Sending…" : "Send code"}
            </button>
          </form>
        )}

        {errorMessage !== null && (
          <p
            role="alert"
            className="mt-4 border-l-2 border-red-600 pl-3 text-sm leading-6 text-red-700 dark:text-red-400"
          >
            {errorMessage}
          </p>
        )}
      </main>
    </div>
  );
}
