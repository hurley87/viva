"use client";

import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import { AuthPanel } from "@/components/auth-panel";
import { api } from "../../../convex/_generated/api";

export function TeacherShell({ children }: { children: ReactNode }) {
  const me = useQuery(api.users.me);

  if (me === undefined) {
    return <p>Loading…</p>;
  }

  if (me === null) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">
          Teacher dashboard
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Sign in with a provisioned Teacher account to review Sessions and
          Assessments.
        </p>
        <AuthPanel />
      </>
    );
  }

  if (me.role !== "teacher") {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">
          Teacher dashboard
        </h1>
        <p>
          Teacher access required. Signed in as {me.displayName} ({me.role}).
        </p>
        <AuthPanel />
      </>
    );
  }

  return <>{children}</>;
}
