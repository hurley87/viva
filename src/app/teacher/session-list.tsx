"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import {
  assessmentStatusLabel,
  formatWhen,
  sessionStatusLabel,
} from "./copy";
import { TeacherShell } from "./teacher-shell";

export function TeacherSessionList() {
  return (
    <TeacherShell>
      <SessionListBody />
    </TeacherShell>
  );
}

function SessionListBody() {
  const dashboard = useQuery(api.teacher.listSessions, {});

  if (dashboard === undefined) {
    return <p>Loading Sessions…</p>;
  }

  return (
    <>
      <p>
        <Link href="/" className="text-sm underline">
          Back home
        </Link>
      </p>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Teacher dashboard
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {dashboard.releaseMode === "shadow"
            ? "Shadow period: Assessments stay with you until you release each one to the Student."
            : "Assessments release to Students automatically. No action is needed."}
        </p>
      </div>
      {dashboard.sessions.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No Sessions yet. Students mint Sessions from the home page.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {dashboard.sessions.map((session) => (
            <li key={session._id}>
              <Link
                href={`/teacher/sessions/${session._id}`}
                className="block rounded-lg border border-zinc-200 p-4 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-500"
              >
                <p className="font-medium">{session.studentDisplayName}</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {session.assignmentTitle}
                </p>
                <p className="mt-2 text-sm">
                  {sessionStatusLabel(session.status)}
                  {" · "}
                  {assessmentStatusLabel(session.assessmentStatus)}
                  {session.assessmentStatus === "complete"
                    ? session.released
                      ? " · Released"
                      : " · Not released"
                    : null}
                  {session.inv1FlagCount > 0
                    ? ` · ${session.inv1FlagCount} INV-1 flag${session.inv1FlagCount === 1 ? "" : "s"}`
                    : null}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Started {formatWhen(session.startedAt)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
