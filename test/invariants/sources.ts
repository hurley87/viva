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

/**
 * Every match of `pattern` in every source, with the line it starts on.
 *
 * Scans the whole file, not line by line, and derives the line number from the
 * match offset. That difference is the whole point: a static gate that reads
 * one line at a time cannot see a call whose arguments wrap, and
 *
 *     await ctx.db.delete(
 *       "transcriptShares",
 *       id,
 *     );
 *
 * would sit invisible to the "a share is permanent" check while the check went
 * on reporting green. A gate that silently stops covering things is worse than
 * no gate, because the suite still reads as a guarantee.
 */
export function findAll(sources: SourceMap, pattern: RegExp): SourceHit[] {
  const hits: SourceHit[] = [];
  for (const [path, source] of Object.entries(sources)) {
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;
    for (const match of source.matchAll(new RegExp(pattern, flags))) {
      const index = match.index ?? 0;
      const before = source.slice(0, index);
      const line = before.split("\n").length;
      const lineStart = before.lastIndexOf("\n") + 1;
      const lineEnd = source.indexOf("\n", index);
      hits.push({
        file: convexPath(path),
        line,
        text: source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim(),
        match: match[0],
      });
    }
  }
  return hits.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  );
}

/**
 * A string literal holding exactly `value`, in either quoting style.
 *
 * This repo has no Prettier and no ESLint quote rule, so nothing stops a
 * `ctx.db.delete('transcriptShares', id)` from being written tomorrow. A gate
 * that only matched double quotes would not see it.
 */
function quoted(value: string): string {
  return `["']${value}["']`;
}

/** A hit, formatted the way a failing invariant test should report it. */
export function describeHit(hit: SourceHit): string {
  return `${hit.file}:${hit.line}  ${hit.text}`;
}

/**
 * Every `ctx.db.<insert|patch|replace|delete>(<table>` in `sources`, in either
 * quoting style and however the call is wrapped across lines.
 */
export function tableWrites(
  sources: SourceMap,
  table: string,
): (SourceHit & { operation: string })[] {
  return findAll(
    sources,
    new RegExp(`\\.(insert|patch|replace|delete)\\(\\s*${quoted(table)}`),
  ).map((hit) => ({
    ...hit,
    operation: /\.(\w+)\(/.exec(hit.match)?.[1] ?? "unknown",
  }));
}

/** Every `ctx.db.query(<table>)` / `ctx.db.get(<table>` in `sources`. */
export function tableReads(sources: SourceMap, table: string): SourceHit[] {
  return findAll(sources, new RegExp(`\\.(query|get)\\(\\s*${quoted(table)}`));
}
