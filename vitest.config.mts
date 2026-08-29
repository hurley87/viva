import { defineConfig } from "vitest/config";

// Convex function tests run under convex-test in the edge runtime, which is
// what the Convex isolate provides. Add a second `projects` entry with a jsdom
// environment when UI tests appear (jsdom is not installed yet).
export default defineConfig({
  test: {
    name: "convex",
    include: ["convex/**/*.test.ts"],
    environment: "edge-runtime",
    passWithNoTests: true,
  },
});
