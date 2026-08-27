"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../../convex/_generated/api";

const buttonClassName =
  "rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

export function StartSession() {
  const me = useQuery(api.users.me);
  const mint = useMutation(api.sessions.mint);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isMinting, setIsMinting] = useState(false);

  if (me === undefined) {
    return null;
  }

  if (me === null) {
    return null;
  }

  if (me.role !== "student") {
    return (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Live Sessions are started by Students. Sign in with a provisioned
        Student account to begin.
      </p>
    );
  }

  async function handleStart() {
    setError(null);
    setIsMinting(true);
    try {
      const result = await mint({});
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(`/session/${result.sessionId}`);
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : String(startError),
      );
    } finally {
      setIsMinting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={buttonClassName}
        disabled={isMinting}
        onClick={() => void handleStart()}
      >
        {isMinting ? "Starting Session…" : "Start Session"}
      </button>
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      <Link className="text-sm underline" href="/feedback">
        Your Sessions
      </Link>
    </div>
  );
}
