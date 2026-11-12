import {runAsCommand} from "../gate/command-entry.ts";
// The full check's recorder (docs/workflow.md, Records: "The full check writes
// them. Nobody records by hand."). A case whose source exists and whose record
// has no row yet is pending: every record check lists it and does not fail on
// it, and this writes its row after landing. A recorded case whose change the
// shared ratchet accepts (an improvement, or a refusal for other reasons) has
// its row rewritten too. Every other row stays byte for byte. It prints what it
// recorded, and it does not commit.
//
//   NTS_BIN=<main's pin> node tooling/records/record-pending.ts [--delta <file>] [kind ...]
//   NTS_BIN=<verified's pin> node tooling/records/record-pending.ts --after core|wide <run> [--delta <file>] [kind ...]
//   node tooling/records/record-pending.ts --apply <delta>
//
// The kinds are oracle-counts, typescript, test262, benchmarks,
// benchmark-runs, outcomes, dex and compile-times, all eight when none is
// named, in that order: a benchmark's run is recorded once its oracle count
// is. Each is recorded by its own recorder, in its pending mode, with the
// compiler NTS_BIN names:
//
//   oracle-counts   tooling/differential/record-oracles.ts <pending fixture>, per fixture
//   typescript      tooling/census/conformance262.ts --record-pending, per backend
//   test262         tooling/census/conformance262.ts --record-pending <tsv> --case <listed> --repeats 3, per record
//   benchmarks      tooling/bench/build-records.ts --record-pending
//   benchmark-runs  tooling/differential/check-consumers.ts benchmarks --record-pending (bench-agree's JVM record)
//   outcomes        tooling/conformance/outcomes-check.ts --record-pending
//   dex             tooling/android/dex-record.ts record-pending (d8 over what can change a row)
//   compile-times   tooling/gate/compile-counter-calibrate.ts --module <module> --record, per module and arm
//
// A module's compile time is two records of its arm: its line in the table the
// tripwire reads, and its entry in the five-repeat evidence that line is
// proved from. Both are rows of its case, recorded, audited and applied together.
//
// test262's record holds only the cases that ran, so a case with no row is
// usually refused, not new: its pending cases are the ones its census listed
// as running now (a pending line naming the record), recorded only where three
// fresh repeats agree. Every other kind's pending cases come from the tree.
//
// The pending cases come from the tree alone. A kind's recorders run only
// when it has something to record: a pending case, a recorded budget to
// refresh, or an accepted change (an improvement, or a refusal for other
// reasons) that a check listed, in a line naming the record that holds its
// row (tooling/records/pending.ts). `--after <part> <run>` is the full check's
// call once that part is green: it records only the kinds whose checks the
// part runs (KIND_STEPS), with the accepted changes the run's logs list. A
// run by hand has no logs, so it records pending cases and refreshes alone.
// The TypeScript census runs only for the backends whose record has
// something to write. Each writes only from a comparison with nothing worse,
// so run this on `verified` main: a change that a red commit caused is then
// never recorded ahead of that commit's revert.
//
// What the recorders wrote is then audited against the rule: a removed row, a
// row added for a case that was not pending, or a rewritten row whose change
// the ratchet does not accept is refused, and that record's bytes are put back.
//
// `--delta <file>` writes what passed the audit as a delta (tooling/records/
// delta.ts): each changed row, by case, with the row before and after and a
// digest of the sources its case was measured from. The full check's call
// writes one into its run folder (DELTA_FILE) without being asked. It is
// rewritten after each kind, so a run that stops keeps the kinds it finished.
//
// `--apply <delta>` merges a delta into this tree, case by case, as main's
// own code reads its records. A row applies only when the tree left that
// case's row as the delta found it (its row equals the delta's "before"), and
// the case is still the one it was measured from: one it adds is pending here
// too, and its sources here have the delta's digest; a benchmark's compile
// row is held instead to its own source and driver digests, recomputed here,
// which cover exactly what a compile reads. What applies is then
// audited by this tree's rule, as the recorders' own writes are. Every row
// that does not apply is said, with why, and the next records run takes it
// up. A row this tree already has is already recorded. It exits 0 once it has
// merged what applies, 1 for a delta it cannot read or that names a record
// no recorder writes (before writing anything), and it does not commit.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {fileURLToPath} from "node:url";

import { benchmarkCases, benchmarkIdentities } from "../bench/build-records.ts";
import { compileKey } from "../bench/compile-producer.ts";
import { compareBenchmarkOutcome, mergeBenchmarkRecord, parseBenchmarkOutcome, parseBenchmarkRecord } from "../bench/outcomes.ts";
import { selectTypescript } from "../census/suites/typescript.ts";
import { compareTypeScriptObservation, mergeTypeScriptRecord, parseObservation, parseTypeScriptRecord, pendingCases } from "../census/typescript-record.ts";
import { acceptedChange, improves, type OutcomeTransition } from "../conformance/outcome-transition.ts";
import { outcomeFixtures } from "../conformance/outcomes-project.ts";
import { judge, outcomeInventory, RECORD } from "../conformance/outcomes-verdict.ts";
import { GENERATOR, pendingFixtures, recordPath, RECORDS, hintedOracleImprovements, parseShard, oracleImprovementPath, oracleBudgetFixtures, type OracleRow } from "../differential/oracle-records.ts";
import { BENCH_AGREE_BACKENDS, compareBenchmarkRun, mergeRunRecord, parseBenchmarkRun, parseRunRecord, pendingRuns, runsRecord } from "../bench/run-outcomes.ts";
import { compareDex, DEX_RECORD, dexOutcome, dexTargets, recordedTargets, written } from "../android/dex-record.ts";
import {oracleBudgetRevision,oracleUnplannedRevision} from "../differential/record-oracles.ts";
import { WIDE } from "../gate/owed.mjs";
import { mergeTest262Record, parseTest262Row } from "../census/test262-record.ts";
import { ARMS, COMPILE_ARMS, calibrationEntries, compileTimeModules, readCounterTable, tableLines, withCalibrationEntries, withTableLines, type CompileArm } from "../gate/compile-counter.ts";
import { appliedLine, DELTA_FILE, MalformedDelta, parseDelta, serializeDelta, type ApplyCounts, type Delta, type DeltaRow } from "./delta.ts";
import { inventory, listedIn, pendingLine } from "./pending.ts";

export const KINDS = ["oracle-counts", "typescript", "test262", "benchmarks", "benchmark-runs", "outcomes", "dex", "compile-times"] as const;
export type Kind = typeof KINDS[number];
const BACKENDS = ["c", "llvm", "jvm"] as const;

/**
 * The gate steps whose checks hold each kind's records: a kind is recorded
 * after the part that runs them is green. The oracle counts are checked
 * beside the programs, in the core.
 */
export const KIND_STEPS: Readonly<Record<Kind, readonly string[]>> = {
  "oracle-counts": [],
  typescript: ["typescript-c", "typescript-llvm", "typescript-jvm"],
  test262: ["test262-census-c", "test262-census-llvm", "test262-census-jvm"],
  benchmarks: ["benches"],
  "benchmark-runs": ["bench-agree"],
  outcomes: ["outcomes"],
  dex: ["dex"],
  "compile-times": ["compile-time", "compile-time-rc"],
};
export type Part = "core" | "wide";
/** The part of the full check that runs a kind's checks: a kind is recorded after that part is green. */
export const partOf = (kind: Kind): Part => KIND_STEPS[kind].some(step => WIDE.has(step)) ? "wide" : "core";

/** A case with no row yet, and the record it lacks, relative to the root. */
export interface Pending { kind: Kind; name: string; record: string }

const typescriptRecord = (backend: string) => `results/typescript/${backend}/cases.tsv`;
/** The test262 directories a record each, and the record of one on a backend. */
export const TEST262_SLICES = { language: "test/language", builtins: "test/built-ins", annexb: "test/annexB", staging: "test/staging", harness: "test/harness" } as const;
const test262Record = (backend: string, slice: string) => `results/test262/${backend}/${slice}.tsv`;
const TEST262_RECORDS = BACKENDS.flatMap(backend => Object.keys(TEST262_SLICES).map(slice => test262Record(backend, slice)));
/** The backend and directory a test262 record holds, or null for any other file. */
function test262Slice(record: string): { backend: string; under: string } | null {
  const found = /^results\/test262\/([a-z]+)\/([a-z]+)\.tsv$/.exec(record);
  const under = found ? (TEST262_SLICES as Record<string, string>)[found[2]!] : undefined;
  return found && under && (BACKENDS as readonly string[]).includes(found[1]!) ? { backend: found[1]!, under } : null;
}
const benchmarkRecord = (backend: string) => `results/benchmarks/${backend}/outcomes.tsv`;
const outcomesRecord = (name: string) => `tests/outcomes/${name}/${RECORD}`;
const read = (root: string, file: string) => readFileSync(join(root, file), "utf8");

/** The arm whose table or calibration evidence `record` is, or null for any other file. */
function compileTimeArm(record: string): CompileArm | null {
  return ARMS.find(arm => COMPILE_ARMS[arm].table === record || COMPILE_ARMS[arm].calibration === record) ?? null;
}
const isCompileTable = (record: string) => ARMS.some(arm => COMPILE_ARMS[arm].table === record);
/** Every compile-time record: each arm's table and its evidence. */
const COMPILE_TIME_RECORDS = ARMS.flatMap(arm => [COMPILE_ARMS[arm].table, COMPILE_ARMS[arm].calibration]);
/** A compile-time record's rows by module: a table's lines, or the evidence's entries, each one line. */
const compileRows = (record: string, text: string) => isCompileTable(record) ? tableLines(text) : calibrationEntries(text);

/** Every pending case of one kind on the tree at `root`, from its sources and records alone. */
export function findPending(root: string, kind: Kind): Pending[] {
  switch (kind) {
    case "oracle-counts":
      return pendingFixtures(root).map(name => ({ kind, name, record: recordPath(name) }));
    case "test262":
      // Its record holds the cases that ran, so the tree cannot say which are
      // new: they are what its census listed (acceptedIn's listed pending).
      return [];
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
    case "dex": {
      const recorded = existsSync(join(root, DEX_RECORD)) ? recordedTargets(read(root, DEX_RECORD)) : [];
      return inventory(recorded, dexTargets(root)).pending.map(name => ({ kind, name, record: DEX_RECORD }));
    }
    case "compile-times":
      // A module with no row in an arm's table lacks both of that arm's records.
      return ARMS.flatMap(arm => {
        const { table, calibration } = COMPILE_ARMS[arm], recorded = readCounterTable(read(root, table), arm).rows;
        return compileTimeModules(root).filter(name => !recorded.has(name))
          .flatMap(name => [{ kind, name, record: table }, { kind, name, record: calibration }]);
      });
  }
}

/** The kinds whose pending cases are the ones their checks listed, not ones the tree can find. */
const LISTS_PENDING: ReadonlySet<Kind> = new Set<Kind>(["test262"]);

/**
 * The accepted changes a run's checks listed, by the kind whose record each
 * names, and the pending cases listed for the kinds whose pending cases only a
 * check can find (test262's); `unowned` are the records no kind writes,
 * which are said and skipped.
 */
export function acceptedIn(root: string, run: string): { byKind: Map<Kind, Pending[]>; pendingByKind: Map<Kind, Pending[]>; unowned: string[] } {
  const owner = new Map<string, Kind>();
  for (const kind of KINDS) for (const file of recordFiles(root, kind)) owner.set(file, kind);
  const byKind = new Map<Kind, Pending[]>(), pendingByKind = new Map<Kind, Pending[]>(), unowned = new Set<string>();
  const listed = listedIn(run);
  for (const change of listed.accepted) {
    const kind = owner.get(change.record);
    if (kind === undefined) { unowned.add(change.record); continue; }
    byKind.set(kind, [...byKind.get(kind) ?? [], { kind, name: change.name, record: change.record }]);
  }
  for (const one of listed.pending) {
    const kind = owner.get(one.record);
    if (kind !== undefined && LISTS_PENDING.has(kind)) pendingByKind.set(kind, [...pendingByKind.get(kind) ?? [], { kind, name: one.name, record: one.record }]);
  }
  return { byKind, pendingByKind, unowned: [...unowned].sort() };
}

/** These are refresh requests, not pending cases and not reused answers. */
export function oracleRefreshes(root:string):Pending[]{
  const names=new Set(hintedOracleImprovements(root));
  for(const name of oracleBudgetFixtures(root)){
    const file=join(root,recordPath(name));if(!existsSync(file))continue;
    const raw=JSON.parse(read(root,recordPath(name)));
    if(!('unplanned' in raw)&&!raw.rows?.some((row:{kind?:string})=>row.kind==='budget'))continue;
    const shard=parseShard(raw,name);
    for(const row of shard.rows)if(row.kind==='budget'&&JSON.stringify(row.revision)!==JSON.stringify(oracleBudgetRevision(root,row.source)))names.add(name);
    // A plan budget's provenance is its fixture's files, its Node, producer and policy.
    if(shard.unplanned&&JSON.stringify(shard.unplanned.revision)!==JSON.stringify(oracleUnplannedRevision(root,name)))names.add(name);
  }
  return [...names].sort().map(name=>({kind:'oracle-counts',name,record:recordPath(name)}));
}

/** The recorder runs one kind needs for its pending cases and accepted changes, as node arguments from the root. */
export function recorderRuns(kind: Kind, pending: readonly Pending[]): string[][] {
  switch (kind) {
    case "oracle-counts":
      // One run per fixture: the recorder writes nothing when any fixture it
      // was given cannot be measured, so one such fixture would keep every
      // other pending one unrecorded.
      return [...new Set(pending.map(one => one.name))].map(name => ["tooling/differential/record-oracles.ts", name]);
    case "typescript":
      // Each backend's census takes most of an hour: only one with a row to write runs.
      return BACKENDS.filter(backend => pending.some(one => one.record === typescriptRecord(backend)))
        .map(backend => ["tooling/census/conformance262.ts", "--suite", "typescript", "--backend", backend, "--record-pending", typescriptRecord(backend)]);
    case "test262":
      // One writer per record, over exactly the cases listed in it, believed
      // only where three fresh repeats agree.
      return [...Map.groupBy(pending, one => one.record)].sort(([a], [b]) => a.localeCompare(b)).flatMap(([record, listed]) => {
        const where = test262Slice(record);
        if (!where) return [];
        const cases = [...new Set(listed.map(one => one.name))].sort();
        return [["tooling/census/conformance262.ts", "--suite", "test262", "--backend", where.backend, "--under", where.under,
          "--record-pending", record, "--repeats", "3", ...cases.flatMap(name => ["--case", name])]];
      });
    case "benchmarks":
      return [["tooling/bench/build-records.ts", "--record-pending"]];
    case "benchmark-runs":
      // The JVM, which bench-agree checks (BENCH_AGREE_BACKENDS).
      return [["tooling/differential/check-consumers.ts", "benchmarks", "--record-pending"]];
    case "outcomes":
      return [["tooling/conformance/outcomes-check.ts", "--record-pending"]];
    case "dex":
      return [["tooling/android/dex-record.ts", "record-pending"]];
    case "compile-times": {
      // One calibration per module and arm, which writes both of its records.
      const runs = new Map<string, string[]>();
      for (const one of pending) {
        const arm = compileTimeArm(one.record);
        if (arm) runs.set(`${arm}\0${one.name}`, ["tooling/gate/compile-counter-calibrate.ts", "--arm", arm, "--module", one.name, "--record"]);
      }
      return [...runs.keys()].sort().map(key => runs.get(key)!);
    }
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
    case "test262": return TEST262_RECORDS;
    case "benchmarks": return BACKENDS.map(benchmarkRecord);
    case "benchmark-runs": return BENCH_AGREE_BACKENDS.map(runsRecord);
    case "outcomes": return outcomeFixtures(join(root, "tests/outcomes")).map(outcomesRecord);
    case "dex": return [DEX_RECORD];
    case "compile-times": return COMPILE_TIME_RECORDS;
  }
}

function snapshot(root: string, kind: Kind, pending: readonly Pending[]): Map<string, string | null> {
  const files = new Set([...recordFiles(root, kind), ...pending.map(one => one.record)]);
  return new Map([...files].map(file => [file, existsSync(join(root, file)) ? read(root, file) : null]));
}

/** One row of a line record: its key, its case, and its exact line. */
type LineKind = "typescript" | "test262" | "benchmarks" | "benchmark-runs" | "dex";
const isLine = (kind: Kind): kind is LineKind => kind === "typescript" || kind === "test262" || kind === "benchmarks" || kind === "benchmark-runs" || kind === "dex";
/** The case a file-per-case record holds: an oracle-count shard's fixture, or an outcome.json's fixture. */
const caseOfRecord = (kind: "oracle-counts" | "outcomes", file: string): string =>
  kind === "oracle-counts" ? file.slice(`${RECORDS}/`.length, -".json".length) : file.slice(0, -`/${RECORD}`.length);
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
  // A test262 row is rewritten only when a recorded fail passes.
  if (kind === "test262") return parseTest262Row(before).outcome === "fail" && parseTest262Row(after).outcome === "pass" ? "fail -> pass (improved)" : null;
  const value = (line: string) => JSON.parse(line.split("\t")[1]!);
  if (kind === "benchmark-runs") {
    const was = parseBenchmarkRun(value(before)), now = parseBenchmarkRun(value(after)), change = compareBenchmarkRun(was, now);
    return acceptedChange(change) ? `${JSON.stringify(was)} -> ${JSON.stringify(now)} (${label(change)})` : null;
  }
  if (kind === "typescript") {
    const was = parseObservation(value(before)), now = parseObservation(value(after)), change = compareTypeScriptObservation(was, now);
    return acceptedChange(change) ? `${JSON.stringify(was)} -> ${JSON.stringify(now)} (${label(change)})` : null;
  }
  if (kind === "dex") {
    const path = before.split("\t")[0]!, was = dexOutcome(path, value(before)), now = dexOutcome(path, value(after)), change = compareDex(was, now);
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
  if (kind === "compile-times") return auditCompileTimes(file, before, after, pending);
  if (kind === "typescript" || kind === "test262" || kind === "benchmarks" || kind === "benchmark-runs" || kind === "dex") {
    // A test262 record's header names the run that wrote it, on all three of its lines.
    if (kind === "test262" && before !== null) {
      const header = (text: string) => text.split("\n").filter(line => line.startsWith("#"));
      assert.deepEqual(header(after), header(before), `${file}: the header changed`);
    }
    // bench-agree's and dex's records start from their pending rows: with no
    // file, every benchmark (every dex target) is pending.
    if (before === null && (kind === "benchmark-runs" || kind === "dex")) {
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
    const fixture = caseOfRecord(kind, file);
    if (before !== null) return auditOracleRefresh(file, fixture, before, after);
    assert.ok(pending.has(fixture), `${file} was written for ${fixture}, which was not pending`);
    return [`${fixture} (pending)`];
  }
  const fixture = caseOfRecord("outcomes", file), now = JSON.parse(after);
  if (before === null) {
    assert.ok(pending.has(fixture), `${file} was written for ${fixture}, which was not pending`);
    return [`${fixture} ${now.category} (pending)`];
  }
  const was = JSON.parse(before), change = judge(was, now);
  assert.ok(acceptedChange(change), `${file} was rewritten, and the ratchet does not accept it`);
  return [`${fixture} ${was.category} -> ${now.category} (${label(change)})`];
}

/**
 * One refreshed fixture record's change: only what a budget answered may
 * change. A budget row becomes measured or changes its identity. Where the
 * plan budget named a backend its entry planned nothing on, a population of
 * that entry may gain the backend's key or appear, keyed only on such
 * backends. The plan budget itself may narrow, go, or change its identity,
 * and a new one may name only backends its entry has no measured row on.
 * Every other row stays as it was.
 */
function auditOracleRefresh(file: string, fixture: string, before: string, after: string): string[] {
  const old = JSON.parse(before), next = JSON.parse(after);
  assert.ok(old.rows?.some((row: { kind?: string }) => row.kind === "budget") || "unplanned" in old, `${file}: a recorded population was rewritten; a count has no improvement`);
  const was = parseShard(old, fixture), now = parseShard(next, fixture), improved: string[] = [];
  const unplanned = was.unplanned, same = (a: OracleRow, b: OracleRow) => a.source === b.source && a.signature === b.signature;
  // The backends a row of the plan budget's entry gained, when it gained keys only on backends the budget named.
  const planned = (row: OracleRow, replacement: OracleRow): string[] => {
    if (unplanned?.source !== row.source || JSON.stringify({ ...replacement, keys: row.keys }) !== JSON.stringify(row)) return [];
    const gained = Object.keys(replacement.keys).filter(backend => row.keys[backend] === undefined);
    return gained.length && gained.every(backend => unplanned.backends.includes(backend)) && Object.entries(row.keys).every(([backend, key]) => replacement.keys[backend] === key) ? gained : [];
  };
  for (const row of was.rows) {
    const replacement = now.rows.find(one => same(one, row));
    assert.ok(replacement, "oracle refresh removed a population");
    if (JSON.stringify(row) === JSON.stringify(replacement)) continue;
    const gained = planned(row, replacement);
    if (gained.length) { improved.push(`${row.source} planned on ${gained.join(", ")}`); continue; }
    assert.ok(row.kind === "budget" && (replacement.kind === "measured" || replacement.kind === "budget" && JSON.stringify(row.revision) !== JSON.stringify(replacement.revision)), "only a budget -> measured improvement or changed budget identity may replace a recorded row");
    improved.push(row.source + " budget -> " + replacement.kind);
  }
  for (const row of now.rows.filter(one => !was.rows.some(other => same(one, other)))) {
    assert.ok(unplanned?.source === row.source && Object.keys(row.keys).every(backend => unplanned.backends.includes(backend)), "oracle refresh changed its population inventory");
    improved.push(`${row.source} plan budget -> ${row.kind}`);
  }
  if (JSON.stringify(was.unplanned) !== JSON.stringify(now.unplanned)) {
    const changed = now.unplanned;
    if (changed === undefined) improved.push(`${unplanned!.source} plan budget gone: planned on every backend`);
    else if (unplanned?.source === changed.source && JSON.stringify(changed.revision) !== JSON.stringify(unplanned.revision)) improved.push(`${changed.source} plan budget identity changed`);
    else if (unplanned?.source === changed.source && JSON.stringify({ ...changed, backends: unplanned.backends }) === JSON.stringify(unplanned) && changed.backends.every(backend => unplanned.backends.includes(backend))) improved.push(`${changed.source} plan budget narrowed to ${changed.backends.join(", ")}`);
    else {
      assert.ok(unplanned === undefined && !now.rows.some(row => row.source === changed.source && row.kind === "measured" && changed.backends.some(backend => row.keys[backend] !== undefined)), "a plan budget may only narrow, go or change its identity, and a new one cannot replace a measured population");
      improved.push(`${changed.source} budget -> plan budget`);
    }
  }
  assert.ok(improved.length, "a recorded population was rewritten without an improvement");
  return improved;
}

/**
 * One compile-time record's change: rows added only for pending modules, a row
 * rewritten only when its count fell (an improvement), none removed, and the
 * table's header lines and the evidence's policy and provenance as they were.
 * Only the evidence's observed spread follows its entries.
 */
function auditCompileTimes(file: string, before: string | null, after: string, pending: ReadonlySet<string>): string[] {
  assert.ok(before !== null, `${file} was created; a compile-time record is written whole by a full --record`);
  const table = isCompileTable(file);
  if (table) {
    // A legacy single-compiler table names its compiler; the first row published names each row's instead.
    const provenance = `# compiler-provenance: per-module in ${COMPILE_ARMS[compileTimeArm(file)!].calibration}`;
    const header = (text: string) => text.split("\n").filter(line => line.startsWith("#")).map(line => line.startsWith("# compiler-sha256:") ? provenance : line);
    assert.deepEqual(header(after), header(before), `${file}: the header changed`);
  } else {
    const rest = (text: string) => {
      const { modules: _, tripwire_policy: { observed_max_spread: __, ...policy }, ...record } = JSON.parse(text);
      return { ...record, policy };
    };
    assert.deepEqual(rest(after), rest(before), `${file}: its policy or work profile changed`);
  }
  // A table line's count is its second column; an entry's, its median.
  const count = (line: string) => table ? Number(line.split("\t")[1]) : (JSON.parse(line) as { median_instructions: number }).median_instructions / 1e9;
  const was = compileRows(file, before), now = compileRows(file, after), recorded: string[] = [];
  for (const [module, line] of was) {
    const next = now.get(module);
    assert.ok(next !== undefined, `${file}: the row of ${module} was removed`);
    if (next === line) continue;
    assert.ok(count(next) < count(line), `${file}: the row of ${module} was rewritten, and the ratchet does not accept it`);
    recorded.push(`${module} ${count(line).toFixed(3)} G -> ${count(next).toFixed(3)} G (improved)`);
  }
  for (const [module, line] of now) {
    if (was.has(module)) continue;
    assert.ok(pending.has(module), `${file}: a row was added for ${module}, which was not pending`);
    recorded.push(`${module} ${count(line).toFixed(3)} G (pending)`);
  }
  return recorded;
}

/**
 * The cases one audited change of a record file records, row by row: a line
 * record's changed lines, or a file-per-case record's whole file. What the
 * delta holds, before each case's sources are digested.
 */
function changedRows(kind: Kind, file: string, before: string | null, after: string): Omit<DeltaRow, "sources">[] {
  if (kind === "compile-times") {
    const was = before === null ? new Map<string, string>() : compileRows(file, before);
    return [...compileRows(file, after)].filter(([module, line]) => was.get(module) !== line)
      .map(([module, line]) => ({ kind, record: file, case: module, key: module, before: was.get(module) ?? null, after: line }));
  }
  if (isLine(kind)) {
    const was = before === null ? new Map<string, { name: string; line: string }>() : rows(before, kind).rows;
    return [...rows(after, kind).rows].filter(([key, row]) => was.get(key)?.line !== row.line)
      .map(([key, row]) => ({ kind, record: file, case: row.name, key, before: was.get(key)?.line ?? null, after: row.line }));
  }
  const name = caseOfRecord(kind, file);
  return [{ kind, record: file, case: name, key: name, before, after }];
}

/**
 * What a case's row is measured from, relative to the root: a TypeScript case
 * is its file, a benchmark or an example its directory, an outcomes fixture
 * its directory without its own record, and an oracle count its fixture and
 * the case generator the store's header names.
 */
function sourcesOf(kind: Kind, name: string): { paths: string[]; except: string | null } {
  switch (kind) {
    case "outcomes": return { paths: [name], except: `${name}/${RECORD}` };
    case "oracle-counts": return { paths: [name, GENERATOR], except: null };
    default: return { paths: [name], except: null };
  }
}

/** Whether `root` is a checkout: its sources are then the files git tracks there. */
const inCheckout = (root: string) => existsSync(join(root, ".git"));

/** The files under each of `paths` (a file or a directory): those git tracks in a checkout, else every regular file there. */
function filesUnder(root: string, paths: readonly string[]): Map<string, string[]> {
  const under = new Map(paths.map(path => [path, [] as string[]]));
  if (!inCheckout(root)) {
    for (const path of paths) {
      const full = join(root, path);
      if (!existsSync(full)) continue;
      under.set(path, statSync(full).isDirectory()
        ? readdirSync(full, { withFileTypes: true, recursive: true }).filter(entry => entry.isFile()).map(entry => relative(root, join(entry.parentPath, entry.name)))
        : [path]);
    }
    return under;
  }
  // One listing of the whole tree, each file then given to the path it is under.
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  if (listed.status !== 0) throw new Error(`git ls-files in ${root}: ${(listed.stderr ?? listed.error?.message ?? "").trim()}`);
  for (const file of listed.stdout.split("\0").filter(Boolean)) {
    for (let at = file; ; at = at.slice(0, at.lastIndexOf("/"))) {
      under.get(at)?.push(file);
      if (!at.includes("/")) break;
    }
  }
  return under;
}

const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * A digest of each case's sources, by `kind\0name`: every file of them, by
 * path and content (sourcesOf, filesUnder); null for a case none of whose
 * sources is there. Two trees agree on it only where the case is the one its
 * row was measured from. A source outside a case's own paths, such as a
 * benchmark's shared module, is not in it; a benchmark's compile row carries
 * its whole source graph's digest, which --apply holds to the tree's too.
 */
export function sourceDigests(root: string, cases: readonly { kind: Kind; name: string }[]): Map<string, string | null> {
  // A test262 case is a file of the test262 checkout, which nts's git does not track: its digest is its own bytes.
  const digests = new Map<string, string | null>();
  for (const one of cases.filter(one => one.kind === "test262")) {
    const file = join(root, "third_party/test262", one.name);
    digests.set(`test262\0${one.name}`, existsSync(file) ? sha256(JSON.stringify([[one.name, sha256(readFileSync(file))]])) : null);
  }
  const wanted = new Map(cases.filter(one => one.kind !== "test262").map(one => [`${one.kind}\0${one.name}`, sourcesOf(one.kind, one.name)]));
  const files = filesUnder(root, [...new Set([...wanted.values()].flatMap(one => one.paths))]);
  const content = new Map<string, string>();
  const digestOf = (file: string) => {
    if (!content.has(file)) content.set(file, sha256(readFileSync(join(root, file))));
    return content.get(file)!;
  };
  for (const [id, { paths, except }] of wanted) {
    const present = [...new Set(paths.flatMap(path => files.get(path) ?? []))].filter(file => file !== except && existsSync(join(root, file))).sort();
    digests.set(id, present.length ? sha256(JSON.stringify(present.map(file => [file, digestOf(file)]))) : null);
  }
  return digests;
}

/** The commit a checkout is at, or null outside one. */
function headCommit(root: string): string | null {
  if (!inCheckout(root)) return null;
  const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, encoding: "utf8" });
  return head.status === 0 ? head.stdout.trim() : null;
}

/** A delta written whole and renamed into place, so a reader never sees half of one. */
function keepDelta(file: string, delta: Delta): void {
  mkdirSync(dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.partial`;
  writeFileSync(partial, serializeDelta(delta));
  renameSync(partial, file);
}

/**
 * An arm whose table and evidence no longer list the same modules after its
 * recorders ran (one written and not the other) has both put back as they
 * were: a row is kept only with its proof. Returns how many arms were.
 */
function unpairedCompileTimes(root: string, before: ReadonlyMap<string, string | null>, say: (line: string) => void): number {
  let unpaired = 0;
  for (const arm of ARMS) {
    const files = [COMPILE_ARMS[arm].table, COMPILE_ARMS[arm].calibration];
    const modules = (file: string) => {
      try { return existsSync(join(root, file)) ? JSON.stringify([...compileRows(file, read(root, file)).keys()].sort()) : null; }
      catch { return null; }
    };
    const [listed, proved] = files.map(modules);
    if (listed !== null && listed === proved) continue;
    say(`  REFUSED ${files.join(" and ")} do not list the same modules; both put back as they were`);
    for (const file of files) {
      const was = before.get(file);
      if (was === null || was === undefined) rmSync(join(root, file), { force: true }); else writeFileSync(join(root, file), was);
    }
    unpaired += 1;
  }
  return unpaired;
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

/**
 * Record every pending row of the named kinds, and every change the ratchet
 * accepts. A kind runs only with something to record: a pending case (found in
 * the tree, or for test262 listed by a check: `listed`, by kind), a budget to
 * refresh, or an accepted change a check listed (`accepted`, by kind). With
 * `delta`, what passed the audit is written there too, after each kind.
 * Returns the exit status.
 */
export function recordPending(root: string, kinds: readonly Kind[], run: Runner = runNode, say = (line: string) => console.log(line), accepted: ReadonlyMap<Kind, readonly Pending[]> = new Map(), delta?: string, listed: ReadonlyMap<Kind, readonly Pending[]> = new Map()): number {
  let failed = 0, recorded = 0;
  const out: Delta = { version: 1, commit: headCommit(root), headers: {}, rows: [] };
  if (delta) keepDelta(delta, out);
  for (const kind of kinds) {
    const missing = [...findPending(root, kind), ...listed.get(kind) ?? []];
    const refreshes = kind === 'oracle-counts' ? oracleRefreshes(root) : [];
    const pending = [...missing, ...refreshes], changes = accepted.get(kind) ?? [];
    if (!pending.length && !changes.length) { say(`${kind}: nothing pending and no accepted change listed; not run`); continue; }
    say(`${kind}: ${missing.length} pending${refreshes.length ? `, ${refreshes.length} recorded budget refresh(es)` : ''}${changes.length ? `, ${changes.length} accepted change(s) listed` : ''}`);
    for (const one of missing) say(`  ${pendingLine(one.name, one.record)}`);
    for (const one of refreshes) say(`  ORACLE BUDGET refresh ${one.name} (${one.record})`);
    for (const one of changes) say(`  accepted: ${one.name} in ${one.record}`);
    // New rows only for pending cases; accepted changes rewrite rows the ratchet allows (auditRecord).
    const before = snapshot(root, kind, pending);
    for (const args of recorderRuns(kind, [...pending, ...changes])) {
      say(`  running: node ${args.join(" ")}`);
      const status = run(args, root);
      if (status !== 0) { say(`  ${kind}: the recorder exited ${status}`); failed += 1; }
      else if(kind==='oracle-counts')for(const name of args.slice(1))rmSync(oracleImprovementPath(name),{force:true});
    }
    if (kind === "compile-times") failed += unpairedCompileTimes(root, before, say);
    const changed: Omit<DeltaRow, "sources">[] = [];
    for (const [file, was] of before) {
      const now = existsSync(join(root, file)) ? read(root, file) : null;
      const names = new Set(pending.filter(one => one.record === file).map(one => one.name));
      try {
        for (const row of auditRecord(kind, file, was, now, names)) { say(`  recorded ${file}: ${row}`); recorded += 1; }
        if (now !== null && now !== was) changed.push(...changedRows(kind, file, was, now));
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
    if (delta && changed.length) {
      const sources = sourceDigests(root, changed.map(row => ({ kind, name: row.case })));
      for (const row of changed) {
        const digest = sources.get(`${kind}\0${row.case}`);
        if (!digest) { say(`  REFUSED ${row.record}: ${row.case} is recorded, but none of its sources is in the tree; it is not in the delta`); failed += 1; continue; }
        out.rows.push({ ...row, sources: digest });
        // What a tree without this record yet starts it from.
        if (isLine(kind)) out.headers[row.record] ??= read(root, row.record).split("\n", 1)[0]!;
      }
      keepDelta(delta, out);
    }
  }
  if (delta) say(`record-pending: the delta of its ${out.rows.length} row(s) is ${delta}`);
  say(`record-pending: ${recorded} row(s) recorded${failed ? `, ${failed} problem(s)` : ""}; nothing is committed`);
  return failed ? 1 : 0;
}

/** The digests the benchmark check holds a compile row to, by benchmark: its source graph's and the compile driver's. */
export type BenchmarkDigests = (root: string, paths: readonly string[]) => Promise<Map<string, { source: string; driver: string }>>;

/** build-records.ts's own identities of these benchmarks, computed in `root`. */
export const benchmarkDigests: BenchmarkDigests = async (root, paths) => {
  const base = process.env.TMPDIR ?? join(homedir(), ".cache/nts/benchmark-records");
  mkdirSync(base, { recursive: true });
  const scratch = mkdtempSync(join(base, "apply-"));
  try {
    const sources = await benchmarkIdentities(root, [...paths], scratch), driver = compileKey(root);
    return new Map(paths.map(path => [path, { source: sources.get(path)!, driver }]));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
};

/**
 * A delta row no recorder could have written fails the whole delta, before
 * anything is written: an unknown kind, a record its kind does not write, a
 * line of another case, or a key that is not the row's own.
 */
function checkDelta(delta: Delta): void {
  const bad = (row: DeltaRow, why: string): never => { throw new MalformedDelta(`malformed records delta: ${row.record}: ${row.case}: ${why}`); };
  for (const row of delta.rows) {
    if (!(KINDS as readonly string[]).includes(row.kind)) bad(row, `no recorder is of kind ${row.kind}`);
    const kind = row.kind as Kind;
    const records = kind === "typescript" ? BACKENDS.map(typescriptRecord) : kind === "test262" ? TEST262_RECORDS : kind === "benchmarks" ? BACKENDS.map(benchmarkRecord)
      : kind === "benchmark-runs" ? BENCH_AGREE_BACKENDS.map(runsRecord) : kind === "dex" ? [DEX_RECORD]
      : kind === "outcomes" ? (/^tests\/outcomes\/[^/]+$/.test(row.case) ? [outcomesRecord(row.case.slice("tests/outcomes/".length))] : [])
      : kind === "compile-times" ? COMPILE_TIME_RECORDS
      : (() => { try { return [recordPath(row.case)]; } catch { return []; } })();
    if (!records.includes(row.record)) bad(row, `no ${kind} recorder writes that record`);
    if (kind === "compile-times") {
      if (row.key !== row.case) bad(row, "its key is not its case");
      for (const line of [row.before, row.after]) {
        if (line === null) continue;
        let found = new Map<string, string>();
        try { found = compileRows(row.record, isCompileTable(row.record) ? `${line}\n` : `{"modules":[${line}]}`); } catch { /* not a row */ }
        if (line.includes("\n") || found.size !== 1 || found.get(row.case) !== line) bad(row, "it is not one row of its case");
      }
      continue;
    }
    if (!isLine(kind)) { if (row.key !== row.case) bad(row, "its key is not its case"); continue; }
    for (const line of [row.before, row.after]) {
      if (line === null) continue;
      let keys: string[] = [];
      try { keys = [...rows(`\n${line}\n`, kind).rows.keys()]; } catch { /* not a row */ }
      if (line.includes("\n") || !line.startsWith(`${row.case}\t`) || keys.length !== 1 || keys[0] !== row.key) bad(row, "it is not one row of its case");
    }
  }
  for (const [record, header] of Object.entries(delta.headers)) {
    if (header.includes("\n")) throw new MalformedDelta(`malformed records delta: the header of ${record} is not one line`);
  }
  // A module's compile time is its table line and its evidence entry: a delta carries both or neither.
  const compiled = delta.rows.filter(row => row.kind === "compile-times");
  for (const row of compiled) {
    const arm = compileTimeArm(row.record)!, other = isCompileTable(row.record) ? COMPILE_ARMS[arm].calibration : COMPILE_ARMS[arm].table;
    if (!compiled.some(one => one.record === other && one.case === row.case)) bad(row, `it comes without its row in ${other}`);
  }
}

/** `text` with these rows in: a line record's own merge (started from the delta's header where there is no record yet), or a case's whole file. */
function merged(kind: Kind, text: string | null, these: readonly DeltaRow[], header: string | undefined): string {
  if (kind === "compile-times") {
    assert.ok(text !== null, "there is no such record; a compile-time record is written whole by a full --record");
    const rows = new Map(these.map(row => [row.key, row.after]));
    return isCompileTable(these[0]!.record) ? withTableLines(text, rows) : withCalibrationEntries(text, rows);
  }
  if (kind === "test262") {
    assert.ok(text !== null, "there is no such record; a test262 record is written whole by a full --record");
    return mergeTest262Record(text, new Map(these.map(row => { const one = parseTest262Row(row.after); return [one.path, { outcome: one.outcome, detail: one.detail }]; })));
  }
  if (!isLine(kind)) { assert.equal(these.length, 1, "a file-per-case record has one row"); return these[0]!.after; }
  if (text === null) {
    assert.ok(header !== undefined, "there is no such record, and the delta has no header for one");
    // A record of one row, which the merge then reads, checks and writes in its own order.
    text = `${header}\n${these[0]!.after}\n`;
  }
  const updates = these.map(row => { const tab = row.after.indexOf("\t"); return { path: row.after.slice(0, tab), value: JSON.parse(row.after.slice(tab + 1)) }; });
  switch (kind) {
    case "typescript": return mergeTypeScriptRecord(text, new Map(updates.map(one => [one.path, one.value])));
    case "benchmarks": return mergeBenchmarkRecord(text, updates.map(one => ({ path: one.path, ...one.value })));
    case "benchmark-runs": return mergeRunRecord(text, new Map(updates.map(one => [one.path, one.value])));
    case "dex": return written(text, updates);
  }
}

export type ApplyOptions = { say?: (line: string) => void; benchmarks?: BenchmarkDigests };

/**
 * Merge a delta into the tree at `root`, case by case (the rule is this
 * module's comment's), write the records it applies to, and say what applied,
 * what was there already, and what did not apply and why. A malformed delta
 * throws a MalformedDelta before anything is written.
 */
export async function applyDelta(root: string, delta: Delta, options: ApplyOptions = {}): Promise<ApplyCounts> {
  const say = options.say ?? ((line: string) => console.log(line));
  checkDelta(delta);
  const counts: ApplyCounts = { applied: 0, already: 0, skipped: 0 };
  const since = delta.commit ? ` since ${delta.commit.slice(0, 12)}` : "";
  const head = headCommit(root);
  say(`record-pending --apply: ${delta.rows.length} row(s) recorded${delta.commit ? ` at ${delta.commit.slice(0, 12)}` : ""}, into ${root}${head ? ` at ${head.slice(0, 12)}` : ""}`);
  const skipped = new Set<DeltaRow>();
  const skip = (row: DeltaRow, why: string) => { skipped.add(row); say(`  skipped ${row.record}: ${row.case}: ${why}; the next records run takes it up`); counts.skipped += 1; };

  // The tree's own records: each one's text, and a line record's rows by key.
  const texts = new Map<string, string | null>(), lines = new Map<string, Map<string, string>>();
  const textOf = (record: string) => {
    if (!texts.has(record)) texts.set(record, existsSync(join(root, record)) ? read(root, record) : null);
    return texts.get(record)!;
  };
  const rowOf = (row: DeltaRow): string | null => {
    const kind = row.kind as Kind, text = textOf(row.record);
    if (kind === "compile-times") {
      // A record this tree cannot read holds no row of the case.
      if (text === null) return null;
      if (!lines.has(row.record)) { try { lines.set(row.record, compileRows(row.record, text)); } catch { lines.set(row.record, new Map()); } }
      return lines.get(row.record)!.get(row.key) ?? null;
    }
    if (!isLine(kind) || text === null) return text;
    if (!lines.has(row.record)) lines.set(row.record, new Map([...rows(text, kind).rows].map(([key, one]) => [key, one.line])));
    return lines.get(row.record)!.get(row.key) ?? null;
  };
  // The cases pending in the tree, by kind, as every check finds them; or why they cannot be found.
  const pendingByKind = new Map<Kind, Set<string> | Error>();
  const pendingAt = (kind: Kind) => {
    if (!pendingByKind.has(kind)) {
      try { pendingByKind.set(kind, new Set(findPending(root, kind).map(one => `${one.record}\0${one.name}`))); }
      catch (error) { pendingByKind.set(kind, error instanceof Error ? error : new Error(String(error))); }
    }
    return pendingByKind.get(kind)!;
  };
  // A compile row is held to its own digests below; every other row to its case's files.
  const sources = sourceDigests(root, delta.rows.filter(row => row.kind !== "benchmarks").map(row => ({ kind: row.kind as Kind, name: row.case })));

  let ready: DeltaRow[] = [];
  for (const row of delta.rows) {
    const here = rowOf(row);
    if (here === row.after) { say(`  already recorded ${row.record}: ${row.case}`); counts.already += 1; continue; }
    if (here !== row.before) {
      skip(row, here === null ? `its row is gone${since}` : row.before === null ? `a row of another measurement was recorded for it${since}` : `its row changed${since}`);
      continue;
    }
    // A test262 case with no row here may take one: what makes it pending is
    // that it runs now, which the recorder measured; the tree cannot list it.
    if (row.before === null && row.kind !== "test262") {
      const pending = pendingAt(row.kind as Kind);
      if (pending instanceof Error) { skip(row, `the pending ${row.kind} cases cannot be listed here: ${pending.message}`); continue; }
      if (!pending.has(`${row.record}\0${row.case}`)) { skip(row, "it is not a pending case here"); continue; }
    }
    const digest = row.kind === "benchmarks" ? row.sources : sources.get(`${row.kind}\0${row.case}`);
    if (digest !== row.sources) { skip(row, digest === null ? "its sources are gone" : `its sources changed${since}`); continue; }
    ready.push(row);
  }

  // A benchmark's compile row is held to the digests of its whole source graph
  // and of the compile driver, as the benchmark check holds it: a change to
  // what they cover, or to how they are computed, makes the row another case's.
  // Its directory's digest would be both less and more: a shared module is
  // outside it, and a population declaration (case.domains.json), which no
  // compile reads, inside.
  const compile = ready.filter(row => row.kind === "benchmarks");
  if (compile.length) {
    let digests = new Map<string, { source: string; driver: string }>(), failure = "";
    try { digests = await (options.benchmarks ?? benchmarkDigests)(root, [...new Set(compile.map(row => row.case))]); }
    catch (error) { failure = `: ${error instanceof Error ? error.message : String(error)}`; }
    const refused = new Set<DeltaRow>();
    for (const row of compile) {
      const cell = JSON.parse(row.after.slice(row.after.indexOf("\t") + 1)) as { source: string; driver: string }, here = digests.get(row.case);
      const why = !here ? `its source digest cannot be computed here${failure}`
        : cell.source !== here.source ? `its source digest is ${here.source.slice(0, 12)} here, not the recorded ${cell.source.slice(0, 12)}`
        : cell.driver !== here.driver ? `its compile driver's digest is ${here.driver.slice(0, 12)} here, not the recorded ${cell.driver.slice(0, 12)}` : null;
      if (why) { skip(row, why); refused.add(row); }
    }
    ready = ready.filter(row => !refused.has(row));
  }

  // A module's table line and its evidence entry apply together: one whose
  // partner does not apply is not applied either, so no row lands without its proof.
  for (const row of ready.filter(one => one.kind === "compile-times")) {
    const partner = delta.rows.find(one => one !== row && one.kind === "compile-times" && one.case === row.case && compileTimeArm(one.record) === compileTimeArm(row.record));
    if (partner && skipped.has(partner)) skip(row, `its row in ${partner.record} does not apply here`);
  }
  ready = ready.filter(row => !skipped.has(row));

  // Each record takes its rows by its own merge, and what that makes is
  // audited by the rule the recorders' writes are held to. One row the format
  // or the rule refuses keeps no other from its record: each is then taken alone.
  for (const [record, group] of Map.groupBy(ready, row => row.record)) {
    const kind = group[0]!.kind as Kind, was = textOf(record), pending = pendingAt(kind);
    // A test262 case is pending here when the delta adds it, it has no row here
    // and its file is the one measured, all of which the rows above passed.
    const names = new Set(kind === "test262" ? group.filter(row => row.before === null).map(row => row.case)
      : pending instanceof Error ? [] : [...pending].filter(id => id.startsWith(`${record}\0`)).map(id => id.slice(record.length + 1)));
    const merge = (text: string | null, these: readonly DeltaRow[]) => {
      const next = merged(kind, text, these, delta.headers[record]);
      auditRecord(kind, record, text, next, names);
      return next;
    };
    let text = was, applied: DeltaRow[] = [];
    try { text = merge(was, group); applied = group; }
    catch {
      for (const row of group) {
        try { text = merge(text, [row]); applied.push(row); }
        catch (error) { skip(row, `its record refuses it here: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
    if (!applied.length) continue;
    mkdirSync(dirname(join(root, record)), { recursive: true });
    writeFileSync(join(root, record), text!);
    for (const row of applied) { say(`  applied ${record}: ${row.case} (${row.before === null ? "pending" : "an accepted change"})`); counts.applied += 1; }
  }
  say(appliedLine(counts));
  return counts;
}

/** `--apply <delta>` on the command line: 0 once what applies is merged, 1 for a delta it cannot take, 2 for a wrong call. */
export async function applyCommand(root: string, args: readonly string[], say = (line: string) => console.log(line)): Promise<number> {
  if (args.length !== 1) { console.error("usage: node tooling/records/record-pending.ts --apply <delta>"); return 2; }
  let delta: Delta;
  try { delta = parseDelta(readFileSync(args[0]!, "utf8")); }
  catch (error) { console.error(`record-pending --apply: ${args[0]}: ${error instanceof Error ? error.message : String(error)}`); return 1; }
  try { await applyDelta(root, delta, { say }); }
  catch (error) {
    if (!(error instanceof MalformedDelta)) throw error;
    console.error(`record-pending --apply: ${args[0]}: ${error.message}`);
    return 1;
  }
  return 0;
}

runAsCommand(import.meta.url,async()=>{
  const argv = process.argv.slice(2);
  const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  if (argv[0] === "--apply") process.exitCode = await applyCommand(root, argv.slice(1));
  else {
    const after = argv[0] === "--after" ? { part: argv[1], run: argv[2] } : null;
    let named = after ? argv.slice(3) : argv;
    // The full check's call leaves its delta in its run's folder.
    let delta = after?.run ? join(after.run, DELTA_FILE) : undefined, badDelta = false;
    if (named[0] === "--delta") { delta = named[1]; badDelta = !delta; named = named.slice(2); }
    const unknown = named.filter(kind => !(KINDS as readonly string[]).includes(kind));
    const badAfter = after && ((after.part !== "core" && after.part !== "wide") || !after.run || !existsSync(after.run));
    if (unknown.length || badAfter || badDelta || !process.env.NTS_BIN) {
      console.error(`usage: NTS_BIN=<main's pin> node tooling/records/record-pending.ts [--after core|wide <run>] [--delta <file>] [${KINDS.join("|")} ...]`
        + ` | node tooling/records/record-pending.ts --apply <delta>${unknown.length ? `; unknown: ${unknown.join(" ")}` : ""}`
        + `${badAfter ? `; --after needs core or wide and an existing run folder` : ""}${badDelta ? "; --delta needs a file" : ""}`);
      process.exitCode = 2;
    } else {
      const kinds = (named.length ? named as Kind[] : KINDS).filter(kind => !after || partOf(kind) === after.part);
      const accepted = after ? acceptedIn(root, after.run!) : { byKind: new Map<Kind, Pending[]>(), pendingByKind: new Map<Kind, Pending[]>(), unowned: [] };
      for (const record of accepted.unowned) console.log(`an accepted change names ${record}, which no kind records; skipped`);
      process.exitCode = recordPending(root, kinds, runNode, line => console.log(line), accepted.byKind, delta && resolve(delta), accepted.pendingByKind);
    }
  }
});
