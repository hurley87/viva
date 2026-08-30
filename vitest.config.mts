import { defineConfig } from "vitest/config";

// Two suites, because they need two runtimes.
//
//   convex  Convex function tests run under convex-test in the edge runtime,
//           which is what the Convex isolate provides.
//   src     The browser-side modules that are pure enough to test without a
//           browser: the Transcript mapping and recorder, and the shared
//           formatters. Components are not tested here — jsdom is not
//           installed — so anything needing a DOM stays out.
export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: "convex",
          include: ["convex/**/*.test.ts"],
          environment: "edge-runtime",
        },
      },
      {
        test: {
          name: "src",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
