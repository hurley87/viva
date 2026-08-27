"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";

export function TeacherHomeLink() {
  const me = useQuery(api.users.me);

  if (me?.role !== "teacher") {
    return null;
  }

  return (
    <p>
      <Link href="/teacher" className="text-sm underline">
        Open Teacher dashboard
      </Link>
    </p>
  );
}
