"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { api } from "../../convex/_generated/api";

const frameClassName =
  "mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-12";

export function SignedInStudent({
  title,
  signedOutCopy,
  wrongRoleCopy,
  loadingCopy,
  children,
}: {
  title: string;
  signedOutCopy: string;
  wrongRoleCopy: string;
  loadingCopy: string;
  children: ReactNode;
}) {
  const me = useQuery(api.users.me);

  if (me === undefined) {
    return (
      <main className={frameClassName}>
        <p>{loadingCopy}</p>
      </main>
    );
  }

  if (me === null) {
    return (
      <main className={frameClassName}>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p>{signedOutCopy}</p>
        <Link className="text-sm underline" href="/">
          Back home
        </Link>
      </main>
    );
  }

  if (me.role !== "student") {
    return (
      <main className={frameClassName}>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p>{wrongRoleCopy}</p>
        <Link className="text-sm underline" href="/">
          Back home
        </Link>
      </main>
    );
  }

  return <>{children}</>;
}

export function StudentResourceGate<T>({
  title,
  loadingCopy,
  notFoundCopy,
  notFoundHref = "/",
  notFoundHrefLabel = "Back home",
  resource,
  children,
}: {
  title: string;
  loadingCopy: string;
  notFoundCopy: string;
  notFoundHref?: string;
  notFoundHrefLabel?: string;
  resource: T | null | undefined;
  children: (resource: T) => ReactNode;
}) {
  if (resource === undefined) {
    return (
      <main className={frameClassName}>
        <p>{loadingCopy}</p>
      </main>
    );
  }

  if (resource === null) {
    return (
      <main className={frameClassName}>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p>{notFoundCopy}</p>
        <Link className="text-sm underline" href={notFoundHref}>
          {notFoundHrefLabel}
        </Link>
      </main>
    );
  }

  return <>{children(resource)}</>;
}
