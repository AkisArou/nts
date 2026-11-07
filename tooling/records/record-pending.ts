// The full check's recorder (docs/workflow.md, Records: "The full check writes
// them. Nobody records by hand."). A case whose source exists and whose record
// has no row yet is pending: every record check lists it and does not fail on
// it, and this writes its row after landing. A recorded case whose change the
// shared ratchet accepts (an improvement, or a refusal for other reasons) has
// its row rewritten too. Every other row stays byte for byte. It prints what it
// recorded, and it does not commit.
//
//   NTS_BIN=<main's pin> node tooling/records/record-pending.ts [kind ...]
//
// The kinds are oracle-counts, typescript, benchmarks, benchmark-runs and
// outcomes, all five when none is named, in that order: a benchmark's run is
// recorded once its oracle count is. Each is recorded by its own recorder, in
// its pending mode, with the compiler NTS_BIN names:
//
//   oracle-counts   tooling/differential/record-oracles.ts <pending fixture>, per fixture
//   typescript      tooling/census/conformance262.ts --record-pending, per backend
//   benchmarks      tooling/bench/build-records.ts --record-pending
//   benchmark-runs  tooling/differential/check-consumers.ts benchmarks --record-pending (bench-agree's JVM record)
//   outcomes        tooling/conformance/outcomes-check.ts --record-pending
//
// The pending cases come from the tree alone. Accepted changes need a
// measurement, so the last three recorders run whether or not anything is
// pending. Each writes only from a comparison with nothing worse, so run this on
// `verified` main: a change that a red commit caused is then never recorded
// ahead of that commit's revert.
//
// What the recorders wrote is then audited against the rule: a removed row, a
// row added for a case that was not pending, or a rewritten row whose change
// the ratchet does not accept is refused, and that record's bytes are put back.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { benchmarkCases } from "../bench/build-records.ts";
import { compareBenchmarkOutcome, parseBenchmarkOutcome, parseBenchmarkRecord } from "../bench/outcomes.ts";
import { selectTypescript } from "../census/suites/typescript.ts";
import { compareTypeScriptObservation, parseObservation, parseTypeScriptRecord, pendingCases } from "../census/typescript-record.ts";
import { acceptedChange, improves, type OutcomeTransition } from "../conformance/outcome-transition.ts";
import { outcomeFixtures } from "../conformance/outcomes-project.ts";
import { judge, outcomeInventory, RECORD } from "../conformance/outcomes-verdict.ts";
import { pendingFixtures, recordPath, RECORDS } from "../differential/oracle-records.ts";
import { BENCH_AGREE_BACKENDS, compareBenchmarkRun, parseBenchmarkRun, parseRunRecord, pendingRuns, runsRecord } from "../bench/run-outcomes.ts";
import { inventory, pendingLine } from "./pending.ts";

export const KINDS = ["oracle-counts", "typescript", "benchmarks", "benchmark-runs", "outcomes"] as const;
export type Kind = typeof KINDS[number];
const BACKENDS = ["c", "llvm", "jvm"] as const;

/** A case with no row yet, and the record it lacks, relative to the root. */
export interface Pending { kind: Kind; name: string; record: string }

const typescriptRecord = (backend: string) => `results/typescript/${backend}/cases.tsv`;
const benchmarkRecord = (backend: string) => `results/benchmarks/${backend}/outcomes.tsv`;
const outcomesRecord = (name: string) => `tests/outcomes/${name}/${RECORD}`;
const read = (root: string, file: string) => readFileSync(join(root, file), "utf8");

/** Every pending case of one kind on the tree at `root`, from its sources and records alone. */
export function findPending(root: string, kind: Kind): Pending[] {
  switch (kind) {
    case "oracle-counts":
      return pendingFixtures(root).map(name => ({ kind, name, record: recordPath(name) }));
    case "typescript": {
      const sources = selectTypescript(root, "tests/typescript").map(row => row.path);
      return BACKENDS.flatMap(backend => pendingCases(parseTypeScriptRecord(read(root, typescriptRecord(backend))), sources)
        .map(name => ({ kind, name, record: typescriptRecord(backend) })));
    }
    case "benchmarks":
      return BACKENDS.flatMap(backend => {
        const recorded = parseBenchmarkRecord(read(root, benchmarkRecord(backend))).rows.filter(row => row.scope === "compile").map(row => row.path);
        return inventory(recorded, benchmarkCases(root)).pending.map(name => ({ kind, name, record: benchmarkRecord(backend) }));
      });
    case "benchmark-runs":
      return BENCH_AGREE_BACKENDS.flatMap(backend => {
        const file = runsRecord(backend), record = existsSync(join(root, file)) ? parseRunRecord(read(root, file)) : null;
        return pendingRuns(record, benchmarkCases(root)).map(name => ({ kind, name, record: file }));
      });
    case "outcomes": {
      const directory = join(root, "tests/outcomes");
      return outcomeInventory(directory, outcomeFixtures(directory)).pending
        .map(name => ({ kind, name: `tests/outcomes/${name}`, record: outcomesRecord(name) }));
    }
  }
}

/** The recorder runs one kind needs, as node arguments from the root. */
export function recorderRuns(kind: Kind, pending: readonly Pending[]): string[][] {
  switch (kind) {
    case "oracle-counts":
      // One run per fixture: the recorder writes nothing when any fixture it
      // was given cannot be measured, so one such fixture would keep every
      // other pending one unrecorded.
      return [...new Set(pending.map(one => one.name))].map(name => ["tooling/differential/record-oracles.ts", name]);
    case "typescript":
      return BACKENDS.map(backend => ["tooling/census/conformance262.ts", "--suite", "typescript", "--backend", backend, "--record-pending", typescriptRecord(backend)]);
    case "benchmarks":
      return [["tooling/bench/build-records.ts", "--record-pending"]];
    case "benchmark-runs":
      // The JVM, which bench-agree checks (BENCH_AGREE_BACKENDS).
      return [["tooling/differential/check-consumers.ts", "benchmarks", "--record-pending"]];
    case "outcomes":
      return [["tooling/conformance/outcomes-check.ts", "--record-pending"]];
  }
}

/** The record files a kind's recorder may write, relative to the root. */
function recordFiles(root: string, kind: Kind): string[] {
  const under = (directory: string): string[] => !existsSync(join(root, directory)) ? [] :
    readdirSync(join(root, directory), { withFileTypes: true, recursive: true })
      .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
      .map(entry => relative(root, join(entry.parentPath, entry.name))).sort();
  switch (kind) {
    case "oracle-counts": return under(RECORDS);
    case "typescript": return BACKENDS.map(typescriptRecord);
    case "benchmarks": return BACKENDS.map(benchmarkRecord);
    case "benchmark-runs": return BENCH_AGREE_BACKENDS.map(runsRecord);
    case "outcomes": return outcomeFixtures(join(root, "tests/outcomes")).map(outcomesRecord);
  }
}

function snapshot(root: string, kind: Kind, pending: readonly Pending[]): Map<string, string | null> {
  const files = new Set([...recordFiles(root, kind), ...pending.map(one => one.record)]);
  return new Map([...files].map(file => [file, existsSync(join(root, file)) ? read(root, file) : null]));
}

/** One row of a line record: its key, its case, and its exact line. */
type LineKind = "typescript" | "benchmarks" | "benchmark-runs";
function rows(text: string, kind: LineKind): { header: string; rows: Map<string, { name: string; line: string }> } {
  const [header = "", ...lines] = text.split("\n");
  const result = new Map<string, { name: string; line: string }>();
  for (const line of lines) {
    if (line === "" || line.startsWith("#")) continue;
    const [name, value] = line.split("\t") as [string, string];
    result.set(kind === "benchmarks" ? `${name}\0${JSON.parse(value).scope}` : name, { name, line });
  }
  return { header, rows: result };
}

/** How the ratchet takes a rewrite, as the audit's label: an improvement, or a refusal for other reasons. */
const label = (transition: OutcomeTransition) => improves(transition) ? "improved" : "refuses differently";

/** A rewritten row the ratchet accepts, described, or null when it does not accept it. */
function acceptedRow(kind: LineKind, before: string, after: string): string | null {
  const value = (line: string) => JSON.parse(line.split("\t")[1]!);
  if (kind === "benchmark-runs") {
    const was = parseBenchmarkRun(value(before)), now = parseBenchmarkRun(value(after)), change = compareBenchmarkRun(was, now);
    return acceptedChange(change) ? `${JSON.stringify(was)} -> ${JSON.stringify(now)} (${label(change)})` : null;
  }
  if (kind === "typescript") {
    const was = parseObservation(value(before)), now = parseObservation(value(after)), change = compareTypeScriptObservation(was, now);
    return acceptedChange(change) ? `${JSON.stringify(was)} -> ${JSON.stringify(now)} (${label(change)})` : null;
  }
  const was = value(before), now = value(after);
  if (was.source !== now.source || was.driver !== now.driver) return null;
  const outcome = (cell: { outcome: unknown }) => parseBenchmarkOutcome(cell.outcome);
  const change = compareBenchmarkOutcome(outcome(was), outcome(now));
  return acceptedChange(change) ? `${JSON.stringify(was.outcome)} -> ${JSON.stringify(now.outcome)} (${label(change)})` : null;
}

/**
 * What changed in one record file, as the rows it recorded. Throws when the
 * change breaks the rule: only pending rows added, and only rows rewritten
 * whose change the ratchet accepts.
 */
export function auditRecord(kind: Kind, file: string, before: string | null, after: string | null, pending: ReadonlySet<string>): string[] {
  if (before === after) return [];
  assert.ok(after !== null, `${file} was removed`);
  if (kind === "typescript" || kind === "benchmarks" || kind === "benchmark-runs") {
    // bench-agree's record starts from its pending rows: with no file, every benchmark is pending.
    if (before === null && kind === "benchmark-runs") {
      const now = rows(after, kind);
      for (const row of now.rows.values()) assert.ok(pending.has(row.name), `${file}: a row was added for ${row.name}, which was not pending`);
      return [...now.rows.values()].map(row => `${row.name} ${row.line.split("\t")[1]} (pending)`);
    }
    assert.ok(before !== null, `${file} was created; a line record is written by a full --record`);
    const was = rows(before, kind), now = rows(after, kind);
    assert.equal(now.header, was.header, `${file}: the header changed`);
    const recorded: string[] = [];
    for (const [key, row] of was.rows) {
      const next = now.rows.get(key);
      assert.ok(next, `${file}: the row of ${row.name} was removed`);
      if (next.line === row.line) continue;
      const change = acceptedRow(kind, row.line, next.line);
      assert.ok(change, `${file}: the row of ${row.name} was rewritten, and the ratchet does not accept it`);
      recorded.push(`${row.name} ${change}`);
    }
    for (const [key, row] of now.rows) {
      if (was.rows.has(key)) continue;
      assert.ok(pending.has(row.name), `${file}: a row was added for ${row.name}, which was not pending`);
      recorded.push(`${row.name} ${row.line.split("\t")[1]} (pending)`);
    }
    return recorded;
  }
  if (kind === "oracle-counts") {
    assert.equal(before, null, `${file}: a recorded population was rewritten; a count has no improvement`);
    const fixture = file.slice(`${RECORDS}/`.length, -".json".length);
    assert.ok(pending.has(fixture), `${file} was written for ${fixture}, which was not pending`);
    return [`${fixture} (pending)`];
  }
  const fixture = file.slice(0, -`/${RECORD}`.length), now = JSON.parse(after);
  if (before === null) {
    assert.ok(pending.has(fixture), `${file} was written for ${fixture}, which was not pending`);
    return [`${fixture} ${now.category} (pending)`];
  }
  const was = JSON.parse(before), change = judge(was, now);
  assert.ok(acceptedChange(change), `${file} was rewritten, and the ratchet does not accept it`);
  return [`${fixture} ${was.category} -> ${now.category} (${label(change)})`];
}

export type Runner = (args: string[], root: string) => number;
// **Each recorder runs under the shared supervisor** (tooling/gate/case-bound.ts):
// its cases are bounded one by one inside it, and these bound the recorder
// itself, so one past them fails here instead of holding the full check.
export const RECORDER_CPU_SECONDS = 4 * 3600;
export const RECORDER_IDLE_SECONDS = 30 * 60;
const CASE_BOUND = fileURLToPath(new URL("../gate/case-bound.ts", import.meta.url));
/** The command one recorder run is: node, through the supervisor. */
export function recorderCommand(args: readonly string[]): [string, string[]] {
  return [process.execPath, [CASE_BOUND, "--cpu", String(RECORDER_CPU_SECONDS), "--idle", String(RECORDER_IDLE_SECONDS), "--", process.execPath, ...args]];
}
const runNode: Runner = (args, root) => {
  const [command, argv] = recorderCommand(args);
  return spawnSync(command, argv, { cwd: root, stdio: "inherit", env: process.env }).status ?? 1;
};

/** Record every pending row of the named kinds, and every change the ratchet accepts. Returns the exit status. */
export function recordPending(root: string, kinds: readonly Kind[], run: Runner = runNode, say = (line: string) => console.log(line)): number {
  let failed = 0, recorded = 0;
  for (const kind of kinds) {
    const pending = findPending(root, kind);
    say(`${kind}: ${pending.length} pending`);
    for (const one of pending) say(`  ${pendingLine(one.name, one.record)}`);
    const before = snapshot(root, kind, pending);
    for (const args of recorderRuns(kind, pending)) {
      say(`  running: node ${args.join(" ")}`);
      const status = run(args, root);
      if (status !== 0) { say(`  ${kind}: the recorder exited ${status}`); failed += 1; }
    }
    for (const [file, was] of before) {
      const now = existsSync(join(root, file)) ? read(root, file) : null;
      const names = new Set(pending.filter(one => one.record === file).map(one => one.name));
      try {
        for (const row of auditRecord(kind, file, was, now, names)) { say(`  recorded ${file}: ${row}`); recorded += 1; }
      } catch (error) {
        say(`  REFUSED ${error instanceof Error ? error.message : String(error)}; put back as it was`);
        if (was === null) rmSync(join(root, file), { force: true }); else writeFileSync(join(root, file), was);
        failed += 1;
      }
    }
    // A record file outside the snapshot is one no recorder of this kind may write.
    for (const file of recordFiles(root, kind)) {
      if (before.has(file)) continue;
      say(`  REFUSED ${file} was written, and no pending case lacks it; removed`);
      rmSync(join(root, file), { force: true });
      failed += 1;
    }
  }
  say(`record-pending: ${recorded} row(s) recorded${failed ? `, ${failed} problem(s)` : ""}; nothing is committed`);
  return failed ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const named = process.argv.slice(2);
  const unknown = named.filter(kind => !(KINDS as readonly string[]).includes(kind));
  if (unknown.length || !process.env.NTS_BIN) {
    console.error(`usage: NTS_BIN=<main's pin> node tooling/records/record-pending.ts [${KINDS.join("|")} ...]${unknown.length ? `; unknown: ${unknown.join(" ")}` : ""}`);
    process.exitCode = 2;
  } else {
    const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
    process.exitCode = recordPending(root, named.length ? named as Kind[] : KINDS);
  }
}
