"use client";

// Landing page. Its only job in this ticket is to prove the browser reaches
// Convex: it subscribes to the deployment readiness query and reports what the
// backend says. Role routing (Student → /student, Teacher → /teacher) arrives
// with auth in ticket #2.

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function Home() {
  const readiness = useQuery(api.deployment.readiness);

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-24 dark:bg-black">
      <main className="w-full max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Viva
        </h1>
        <p className="mt-3 max-w-lg text-base leading-7 text-zinc-600 dark:text-zinc-400">
          A proof-of-understanding layer for education. A Teacher defines an
          Assignment and a private Standard, a Student responds in a live voice
          Session, and the transcript is assessed against that Standard.
        </p>

        <section className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Backend
          </h2>
          {readiness === undefined ? (
            <p className="mt-3 text-sm text-zinc-500">Connecting to Convex…</p>
          ) : (
            <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <Row
                label="Convex"
                value="connected"
              />
              <Row
                label="Deployment configured"
                value={readiness.seeded ? "yes" : "not seeded"}
              />
              <Row
                label="Assignments"
                value={String(readiness.assignmentCount)}
              />
              <Row
                label="Published versions"
                value={String(readiness.publishedVersionCount)}
              />
              <Row label="Release mode" value={readiness.releaseMode} />
            </dl>
          )}
          {readiness !== undefined && !readiness.seeded && (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              This deployment has no configuration row. Run{" "}
              <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
                npm run seed
              </code>
              .
            </p>
          )}
        </section>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-zinc-100 py-1.5 dark:border-zinc-900">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-medium text-black tabular-nums dark:text-zinc-50">
        {value}
      </dd>
    </div>
  );
}
