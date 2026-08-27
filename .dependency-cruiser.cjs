/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "inv3-examiner-mint-no-standards",
      comment:
        "INV-3: examiner/mint/live-session path must not import standards storage",
      severity: "error",
      from: {
        path: "^convex/(examiner/|realtime\\.ts$|sessions\\.ts$)",
      },
      to: {
        path: "^convex/standards\\.ts$",
        reachable: true,
      },
    },
    {
      name: "inv3-examiner-no-grader",
      comment: "INV-3: examiner instructions must not import the grader",
      severity: "error",
      from: {
        path: "^convex/examiner/",
      },
      to: {
        path: "^convex/grader/",
        reachable: true,
      },
    },
    {
      name: "inv3-no-standards-except-grader",
      comment:
        "Only the grader (reader), seed (writer), and standards module itself may import standards storage",
      severity: "error",
      from: {
        path: "^convex/",
        pathNot:
          "^convex/(grader/|standards\\.ts$|seed\\.ts$|_generated/|test\\.(setup|fixtures)\\.ts$)",
      },
      to: {
        path: "^convex/standards\\.ts$",
        reachable: true,
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "^(node_modules|convex/_generated)",
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
