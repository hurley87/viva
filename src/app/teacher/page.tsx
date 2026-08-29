"use client";

// The Teacher's home: every Session in the deployment, in one scannable list.
//
// Read-only. Authoring stays seeded in the MVP, so there is nothing to create
// here — this page exists so a Teacher can find the Session they want and open
// it. The one write on the Teacher's side, the shadow-period release, lives on
// the detail view, next to the Assessment it releases.
//
// Access is enforced in Convex, not here: `teacher.listSessions` throws for a
// Student, an Operator, an unauthenticated caller and a voided account. The
// role check below is so a signed-in Student gets a sentence instead of an
// error boundary — it is courtesy, not security.

import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "../../../convex/_generated/api";
import {
  describeAssessment,
  describeSession,
  formatDuration,
  formatWhen,
} from "../../lib/teacherFormat";

export default function TeacherPage() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="w-full max-w-5xl">
        <AuthLoading>
          <p className="text-sm text-zinc-500">Checking your session…</p>
        </AuthLoading>
        <Unauthenticated>
          <SignedOut />
        </Unauthenticated>
        <Authenticated>
          <TeacherHome />
        </Authenticated>
      </main>
    </div>
  );
}

function SignedOut() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login");
  }, [router]);
  return <p className="text-sm text-zinc-500">Redirecting to sign in…</p>;
}

function TeacherHome() {
  const me = useQuery(api.users.me);

  if (me === undefined) {
    return <p className="text-sm text-zinc-500">Resolving your account…</p>;
  }
  if (me === null) {
    return (
      <Notice title="Not provisioned">
        You are signed in, but this deployment has no account for you. Viva
        accounts are provisioned by hand.
      </Notice>
    );
  }
  if (me.role !== "teacher") {
    return (
      <Notice title="Not a Teacher account">
        This dashboard is for Teachers. You are signed in as a {me.role}.{" "}
        <Link href="/" className="underline underline-offset-4">
          Go back
        </Link>
        .
      </Notice>
    );
  }
  return <SessionList displayName={me.displayName} />;
}

function SessionList({ displayName }: { displayName: string }) {
  const data = useQuery(api.teacher.listSessions);

  return (
    <>
      <header className="border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Sessions
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Signed in as {displayName}. Every Session in this deployment, newest
          first. Open one to read its Transcript and its Assessment in full.
        </p>
      </header>

      {data === undefined ? (
        <p className="mt-8 text-sm text-zinc-500">Loading Sessions…</p>
      ) : (
        <>
          <ReleaseModeNote releaseMode={data.releaseMode} />
          {data.sessions.length === 0 ? (
            <p className="mt-8 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              No Session has been taken yet. A Session appears here the moment a
              Student mints one.
            </p>
          ) : (
            <div className="mt-8 overflow-x-auto">
              <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-300 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-700">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Student
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Assignment
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Taken
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Ran
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Session
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Assessment
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {data.sessions.map((session) => (
                    <tr key={session._id} className="align-top">
                      <td className="py-3 pr-4 text-zinc-900 dark:text-zinc-100">
                        {session.studentName}
                        <span className="block text-xs text-zinc-500">
                          {session.studentEmail}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                        {session.assignmentTitle}
                        <span className="block text-xs text-zinc-500">
                          Version {session.assignmentVersion}
                        </span>
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap text-zinc-600 tabular-nums dark:text-zinc-400">
                        {formatWhen(session.createdAt)}
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap text-zinc-600 tabular-nums dark:text-zinc-400">
                        {formatDuration(session.durationSec)}
                      </td>
                      <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                        {describeSession(session)}
                      </td>
                      <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                        {describeAssessment(session.assessment)}
                        {session.assessment !== null &&
                          session.assessment.inv1FlagCount > 0 && (
                            <span className="block text-xs font-medium text-amber-800 dark:text-amber-300">
                              {session.assessment.inv1FlagCount === 1
                                ? "1 INV-1 flag"
                                : `${session.assessment.inv1FlagCount} INV-1 flags`}
                            </span>
                          )}
                      </td>
                      <td className="py-3 whitespace-nowrap">
                        <Link
                          href={`/teacher/sessions/${session._id}`}
                          className="font-medium text-black underline underline-offset-4 dark:text-zinc-50"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

/**
 * What the release mode means for the Teacher's work, stated once at the top
 * rather than implied by whether a button appears further down.
 *
 * PRD §8: the shadow period is a property of the deployment, not of an
 * Assessment. Leaving it is flipping the mode, not releasing enough of them.
 */
function ReleaseModeNote({
  releaseMode,
}: {
  releaseMode: "shadow" | "auto" | null;
}) {
  if (releaseMode === null) {
    return (
      <p className="mt-6 border-l-2 border-red-700 px-4 py-3 text-sm leading-6 text-red-800 dark:border-red-500 dark:text-red-300">
        This deployment has no configuration row, so it has no release mode, no
        caps and no time-box. It needs seeding.
      </p>
    );
  }
  return (
    <p className="mt-6 border-l-2 border-zinc-400 px-4 py-3 text-sm leading-6 text-zinc-700 dark:border-zinc-600 dark:text-zinc-300">
      {releaseMode === "shadow" ? (
        <>
          <span className="font-medium text-black dark:text-zinc-50">
            Shadow period.
          </span>{" "}
          Assessments reach you only. Open one and release it to send its
          formative summary to the Student. This is the opening span of the
          deployment, not a standing review step — once you trust the Grader,
          the deployment moves to auto-release.
        </>
      ) : (
        <>
          <span className="font-medium text-black dark:text-zinc-50">
            Auto-release.
          </span>{" "}
          Every complete Assessment reaches its Student within minutes of the
          Session. Nothing here needs your action; read what you like, whenever
          you like.
        </>
      )}
    </p>
  );
}

function Notice({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </h2>
      <p className="mt-3 max-w-lg text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {children}
      </p>
    </section>
  );
}
