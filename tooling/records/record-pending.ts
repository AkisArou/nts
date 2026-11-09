// The full check's recorder (docs/workflow.md, Records: "The full check writes
// them. Nobody records by hand."). A case whose source exists and whose record
// has no row yet is pending: every record check lists it and does not fail on
// it, and this writes its row after landing. A recorded case whose change the
// shared ratchet accepts (an improvement, or a refusal for other reasons) has
// its row rewritten too. Every other row stays byte for byte. It prints what it
// recorded, and it does not commit.
//
//   NTS_BIN=<main's pin> node tooling/records/record-pending.ts [kind ...]
//   NTS_BIN=<verified's pin> node tooling/records/record-pending.ts --after core|wide <run> [kind ...]
//
// The kinds are oracle-counts, typescript, benchmarks, benchmark-runs,
// outcomes and dex, all six when none is named, in that order: a benchmark's
// run is recorded once its oracle count is. Each is recorded by its own
// recorder, in its pending mode, with the compiler NTS_BIN names:
//
//   oracle-counts   tooling/differential/record-oracles.ts <pending fixture>, per fixture
//   typescript      tooling/census/conformance262.ts --record-pending, per backend
//   benchmarks      tooling/bench/build-records.ts --record-pending
//   benchmark-runs  tooling/differential/check-consumers.ts benchmarks --record-pending (bench-agree's JVM record)
//   outcomes        tooling/conformance/outcomes-check.ts --record-pending
//   dex             tooling/android/dex-record.ts record-pending (d8 over what can change a row)
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
import { pendingFixtures, recordPath, RECORDS, hintedOracleImprovements, parseShard, oracleImprovementPath, oracleBudgetFixtures } from "../differential/oracle-records.ts";
import { BENCH_AGREE_BACKENDS, compareBenchmarkRun, parseBenchmarkRun, parseRunRecord, pendingRuns, runsRecord } from "../bench/run-outcomes.ts";
import { compareDex, DEX_RECORD, dexOutcome, dexTargets, recordedTargets } from "../android/dex-record.ts";
import {oracleBudgetRevision} from "../differential/record-oracles.ts";
import { WIDE } from "../gate/owed.mjs";
import { inventory, listedIn, pendingLine } from "./pending.ts";

export const KINDS = ["oracle-counts", "typescript", "benchmarks", "benchmark-runs", "outcomes", "dex"] as const;
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
  benchmarks: ["benches"],
  "benchmark-runs": ["bench-agree"],
  outcomes: ["outcomes"],
  dex: ["dex"],
};
export type Part = "core" | "wide";
/** The part of the full check that runs a kind's checks: a kind is recorded after that part is green. */
export const partOf = (kind: Kind): Part => KIND_STEPS[kind].some(step => WIDE.has(step)) ? "wide" : "core";

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
    case "dex": {
      const recorded = existsSync(join(root, DEX_RECORD)) ? recordedTargets(read(root, DEX_RECORD)) : [];
      return inventory(recorded, dexTargets(root)).pending.map(name => ({ kind, name, record: DEX_RECORD }));
    }
  }
}

/**
 * The accepted changes a run's checks listed, by the kind whose record each
 * names; `unowned` are the records no kind writes, which are said and skipped.
 */
export function acceptedIn(root: string, run: string): { byKind: Map<Kind, Pending[]>; unowned: string[] } {
  const owner = new Map<string, Kind>();
  for (const kind of KINDS) for (const file of recordFiles(root, kind)) owner.set(file, kind);
  const byKind = new Map<Kind, Pending[]>(), unowned = new Set<string>();
  for (const change of listedIn(run).accepted) {
    const kind = owner.get(change.record);
    if (kind === undefined) { unowned.add(change.record); continue; }
    byKind.set(kind, [...byKind.get(kind) ?? [], { kind, name: change.name, record: change.record }]);
  }
  return { byKind, unowned: [...unowned].sort() };
}

/** These are refresh requests, not pending cases and not reused answers. */
export function oracleRefreshes(root:string):Pending[]{
  const names=new Set(hintedOracleImprovements(root));
  for(const name of oracleBudgetFixtures(root)){
    const file=join(root,recordPath(name));if(!existsSync(file))continue;
    const raw=JSON.parse(read(root,recordPath(name)));
    if(!raw.rows?.some((row:{kind?:string})=>row.kind==='budget'))continue;
    for(const row of parseShard(raw,name).rows)if(row.kind==='budget'&&JSON.stringify(row.revision)!==JSON.stringify(oracleBudgetRevision(root,row.source)))names.add(name);
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
    case "benchmarks":
      return [["tooling/bench/build-records.ts", "--record-pending"]];
    case "benchmark-runs":
      // The JVM, which bench-agree checks (BENCH_AGREE_BACKENDS).
      return [["tooling/differential/check-consumers.ts", "benchmarks", "--record-pending"]];
    case "outcomes":
      return [["tooling/conformance/outcomes-check.ts", "--record-pending"]];
    case "dex":
      return [["tooling/android/dex-record.ts", "record-pending"]];
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
    case "dex": return [DEX_RECORD];
  }
}

function snapshot(root: string, kind: Kind, pending: readonly Pending[]): Map<string, string | null> {
  const files = new Set([...recordFiles(root, kind), ...pending.map(one => one.record)]);
  return new Map([...files].map(file => [file, existsSync(join(root, file)) ? read(root, file) : null]));
}

/** One row of a line record: its key, its case, and its exact line. */
type LineKind = "typescript" | "benchmarks" | "benchmark-runs" | "dex";
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
  if (kind === "typescript" || kind === "benchmarks" || kind === "benchmark-runs" || kind === "dex") {
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
    const fixture = file.slice(`${RECORDS}/`.length, -".json".length);
    if(before!==null){
      const old=JSON.parse(before),next=JSON.parse(after);
      assert.ok(old.rows?.some((row:{kind?:string})=>row.kind==='budget'),`${file}: a recorded population was rewritten; a count has no improvement`);
      const was=parseShard(old,fixture),now=parseShard(next,fixture);const improved:string[]=[];
      assert.equal(was.rows.length,now.rows.length,'oracle refresh changed its population inventory');
      for(const row of was.rows){
        const replacement=now.rows.find(one=>one.source===row.source&&one.signature===row.signature);
        assert.ok(replacement,'oracle refresh removed a population');
        if(JSON.stringify(row)===JSON.stringify(replacement))continue;
        assert.ok(row.kind==='budget'&&(replacement.kind==='measured'||replacement.kind==='budget'&&JSON.stringify(row.revision)!==JSON.stringify(replacement.revision)),'only a budget -> measured improvement or changed budget identity may replace a recorded row');
        improved.push(row.source+' budget -> '+replacement.kind);
      }
      assert.ok(improved.length,'a recorded population was rewritten without an improvement');return improved;
    }
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

/**
 * Record every pending row of the named kinds, and every change the ratchet
 * accepts. A kind runs only with something to record: a pending case, a
 * budget to refresh, or an accepted change a check listed (`accepted`, by
 * kind). Returns the exit status.
 */
export function recordPending(root: string, kinds: readonly Kind[], run: Runner = runNode, say = (line: string) => console.log(line), accepted: ReadonlyMap<Kind, readonly Pending[]> = new Map()): number {
  let failed = 0, recorded = 0;
  for (const kind of kinds) {
    const missing = findPending(root, kind);
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
  const argv = process.argv.slice(2);
  const after = argv[0] === "--after" ? { part: argv[1], run: argv[2] } : null;
  const named = after ? argv.slice(3) : argv;
  const unknown = named.filter(kind => !(KINDS as readonly string[]).includes(kind));
  const badAfter = after && ((after.part !== "core" && after.part !== "wide") || !after.run || !existsSync(after.run));
  if (unknown.length || badAfter || !process.env.NTS_BIN) {
    console.error(`usage: NTS_BIN=<main's pin> node tooling/records/record-pending.ts [--after core|wide <run>] [${KINDS.join("|")} ...]${unknown.length ? `; unknown: ${unknown.join(" ")}` : ""}${badAfter ? `; --after needs core or wide and an existing run folder` : ""}`);
    process.exitCode = 2;
  } else {
    const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
    const kinds = (named.length ? named as Kind[] : KINDS).filter(kind => !after || partOf(kind) === after.part);
    const accepted = after ? acceptedIn(root, after.run!) : { byKind: new Map<Kind, Pending[]>(), unowned: [] };
    for (const record of accepted.unowned) console.log(`an accepted change names ${record}, which no kind records; skipped`);
    process.exitCode = recordPending(root, kinds, runNode, line => console.log(line), accepted.byKind);
  }
}
