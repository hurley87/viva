/// <reference types="vite/client" />

/**
 * Module map for convex-test. Exclude generated types, tests, and Node
 * actions (`"use node"`) that cannot load in the edge-runtime test env.
 */
export const modules = import.meta.glob([
  "./**/*.{js,ts}",
  "!./**/*.d.ts",
  "!./**/*.test.ts",
  "!./realtime.ts",
  "!./grader/actions.ts",
]);
