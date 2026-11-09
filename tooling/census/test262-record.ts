// The test262 record (results/test262/<backend>/<slice>.tsv): the cases of one
// directory of test262 that ran to a verdict on one backend, and what each
// did, one per line. conformance262.ts --record writes it, --recorded and
// --check hold a run to it, and the conformance summary
// (tooling/records/summary.ts) counts it; this is the one place its lines are
// written and read.
//
//   # Test262 <under> cases that ran, and what each did. Written by
//   # tooling/census/conformance262.ts --record; compared by --check.
//   # compiler <fingerprint>[, commit <sha>], backend <name>, harness <hash>; machine at start: <...>; <n> worker(s)
//   <path>\tpass\t
//   <path>\tfail\t<what it threw>
//
// Only the cases that ran are recorded, pass and fail: refused and
// unsupported cases churn with every compiler change, and the census's
// rankings are where they are read. A fail keeps what it threw, so the record
// fails when the answer changes in either direction. Any other `#` line is a
// comment. A record written before records named their backend is C's, and
// one written before they named their commit names none.
import assert from "node:assert/strict";

export type Test262Outcome = "pass" | "fail";
export interface Test262Row { path: string; outcome: Test262Outcome; detail: string }
/** What a record's header says. Null where a record written before it said so says nothing. */
export interface Test262Header {
  under: string | null;
  compiler: string | null;
  commit: string | null;
  backend: string;
  harness: string | null;
}
export interface Test262Record { header: Test262Header; rows: Test262Row[] }
/** What a run writes in a record's header: its commit only when the compiler is a clean pin of one. */
export interface Test262Writer {
  under: string;
  compiler: string;
  commit: string | null;
  backend: string;
  harness: string;
  machine: string;
  jobs: number;
}

export function serializeTest262Record(writer: Test262Writer, rows: readonly Test262Row[]): string {
  return `# Test262 ${writer.under} cases that ran, and what each did. Written by\n` +
    `# tooling/census/conformance262.ts --record; compared by --check.\n` +
    `# compiler ${writer.compiler}${writer.commit ? `, commit ${writer.commit}` : ""}, backend ${writer.backend}, harness ${writer.harness}; machine at start: ${writer.machine}; ${writer.jobs} worker(s)\n` +
    rows.map(row => `${row.path}\t${row.outcome}\t${row.outcome === "fail" ? row.detail : ""}`).sort().join("\n") + "\n";
}

/** One row's line, as a record holds it: a fail keeps what it threw. */
export const test262Line = (row: Test262Row): string => `${row.path}\t${row.outcome}\t${row.outcome === "fail" ? row.detail : ""}`;

/**
 * The record with these rows in, each in its place: every header line and
 * every other row byte for byte. How the full check's writer and --apply add
 * a case that runs now, or rewrite a recorded fail that passes now.
 */
export function mergeTest262Record(contents: string, updates: ReadonlyMap<string, { outcome: Test262Outcome; detail: string }>): string {
  const record = parseTest262Record(contents);
  const lines = new Map(record.rows.map(row => [row.path, test262Line(row)]));
  for (const [path, { outcome, detail }] of updates) lines.set(path, test262Line({ path, outcome, detail }));
  return [...contents.split("\n").filter(line => line.startsWith("#")), ...[...lines.values()].sort(), ""].join("\n");
}

export function parseTest262Record(contents: string): Test262Record {
  const lines = contents.split("\n");
  const written = lines.find(line => line.startsWith("# compiler ")) ?? "";
  const header: Test262Header = {
    under: /^# Test262 (\S+) cases that ran/.exec(lines[0] ?? "")?.[1] ?? null,
    compiler: /^# compiler ([0-9a-f]+)/.exec(written)?.[1] ?? null,
    commit: /, commit ([0-9a-f]{40})/.exec(written)?.[1] ?? null,
    backend: /, backend ([a-z]+)/.exec(written)?.[1] ?? "c",
    harness: /, harness ([0-9a-f]+)/.exec(written)?.[1] ?? null,
  };
  const rows: Test262Row[] = [], seen = new Set<string>();
  for (const line of lines) {
    if (line === "" || line.startsWith("#")) continue;
    const row = parseTest262Row(line);
    assert.ok(!seen.has(row.path), `duplicate recorded case: ${row.path}`);
    seen.add(row.path);
    rows.push(row);
  }
  return { header, rows };
}

/** One row of a record. What a fail threw is the rest of the line, whatever it holds. */
export function parseTest262Row(line: string): Test262Row {
  const first = line.indexOf("\t"), second = line.indexOf("\t", first + 1);
  assert.ok(first > 0 && second > first, `malformed test262 record row: ${line}`);
  const path = line.slice(0, first), outcome = line.slice(first + 1, second);
  assert.ok(outcome === "pass" || outcome === "fail", `unknown test262 outcome ${outcome}: ${path}`);
  return { path, outcome, detail: line.slice(second + 1) };
}
