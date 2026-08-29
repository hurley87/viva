// Reading the source of the codebase as data, so an invariant that is about
// *structure* can be asserted instead of reviewed.
//
// Two of the four invariants are structural. INV-3 says the Standard is not
// merely absent from the live-Session path today, but unreachable from it; INV-2
// says a transcript share cannot be deleted, which is a claim about which
// mutations exist. Neither is provable by calling functions: they are claims
// about code that has not been written yet. So the suite reads the sources.
//
// Callers pass the map from a vite `import.meta.glob(..., { query: "?raw" })`.
// Globbing the directories rather than listing files is deliberate: a module
// added to `convex/examiner/` next month is scanned without anybody
// remembering to add it here.

/** Source text keyed by the glob's relative path. */
export type SourceMap = Record<string, string>;

/** `"../examiner/realtime.ts"` -> `"convex/examiner/realtime.ts"`. */
export function convexPath(globPath: string): string {
  return globPath.replace(/^(\.\.\/)+/, "convex/");
}

/** Real Convex modules: no codegen output, no test suites, no fixtures. */
export function convexModules(sources: SourceMap): SourceMap {
  return Object.fromEntries(
    Object.entries(sources).filter(
      ([path]) =>
        !path.includes("_generated") &&
        !path.endsWith(".test.ts") &&
        !path.includes("/tests/"),
    ),
  );
}

/** The subset of `sources` whose normalized path matches one of `patterns`. */
export function matching(sources: SourceMap, patterns: RegExp[]): SourceMap {
  return Object.fromEntries(
    Object.entries(sources).filter(([path]) =>
      patterns.some((pattern) => pattern.test(convexPath(path))),
    ),
  );
}

export type SourceHit = {
  file: string;
  line: number;
  text: string;
  match: string;
};

/** Every match of `pattern` in every source, with the line it sits on. */
export function findAll(sources: SourceMap, pattern: RegExp): SourceHit[] {
  const hits: SourceHit[] = [];
  for (const [path, source] of Object.entries(sources)) {
    const lines = source.split("\n");
    lines.forEach((text, index) => {
      for (const match of text.matchAll(new RegExp(pattern, "g"))) {
        hits.push({
          file: convexPath(path),
          line: index + 1,
          text: text.trim(),
          match: match[0],
        });
      }
    });
  }
  return hits.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  );
}

/** A hit, formatted the way a failing invariant test should report it. */
export function describeHit(hit: SourceHit): string {
  return `${hit.file}:${hit.line}  ${hit.text}`;
}

/** Every `ctx.db.<insert|patch|replace|delete>("<table>"` in `sources`. */
export function tableWrites(
  sources: SourceMap,
  table: string,
): (SourceHit & { operation: string })[] {
  return findAll(
    sources,
    new RegExp(`\\.(insert|patch|replace|delete)\\(\\s*"${table}"`),
  ).map((hit) => ({
    ...hit,
    operation: /\.(\w+)\(/.exec(hit.match)?.[1] ?? "unknown",
  }));
}

/** Every `ctx.db.query("<table>")` / `ctx.db.get("<table>"` in `sources`. */
export function tableReads(sources: SourceMap, table: string): SourceHit[] {
  return findAll(sources, new RegExp(`\\.(query|get)\\(\\s*"${table}"`));
}
