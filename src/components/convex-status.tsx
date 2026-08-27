"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export function ConvexStatus() {
  const status = useQuery(api.health.status);

  if (status === undefined) {
    return <p>Connecting to Convex…</p>;
  }

  return (
    <p>
      Convex is connected
      {status.hasSeed ? " and seed data is present." : ". Seed has not been run."}
    </p>
  );
}
