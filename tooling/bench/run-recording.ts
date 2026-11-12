// Publish independent completed benchmark rows, then report the batch's
// unresolved observations. A failed case never supplies a replacement row.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync,renameSync} from "node:fs";
import {dirname} from "node:path";
import {CaseBudgetError} from "../gate/step-result.ts";
import {checkFailurePolicy,reportCheckFailure} from "../differential/check-report.ts";
import type {DecodedCheck} from "../differential/check-report-types.ts";
import {recordPath} from "../differential/oracle-records.ts";
import {acceptedChange} from "../conformance/outcome-transition.ts";
import {acceptedLine,pendingLine} from "../records/pending.ts";
import {benchmarkRun,compareBenchmarkRun,mergeRunRecord,runsRecord,serializeRunRecord,type BenchmarkRun,type RunBackend,type RunRecord} from "./run-outcomes.ts";

type Entry = {name:string;fixture?:string};
type Completed = {entry:Entry;record:DecodedCheck;disposition:number};
type Incomplete = {entry:Entry;error:unknown};
export type RunPlan = {backend:RunBackend;file:string;record:RunRecord|null;pending:Set<string>;recordPending:boolean};
type RecordingOptions = {
  binary:string;
  parentEnv:NodeJS.ProcessEnv;
  log?:(line:string)=>void;
  write?:(rows:ReadonlyMap<string,BenchmarkRun>)=>Promise<void>;
};

/**
 * bench-agree against its record: each recorded benchmark's run held to its
 * row by the shared ratchet. Reproducing passes, a loud defect included; a
 * change the ratchet accepts passes and is listed; anything else is red. With
 * --record-pending (the full check's writer, after landing) every benchmark
 * runs. Its completed pending rows and accepted changes are written
 * independently, every other line byte for byte; incomplete cases retain
 * their named failures and missing rows.
 */
export async function finishBenchmarks(plan: RunPlan, all: readonly Entry[], completed: readonly Completed[], incomplete: readonly Incomplete[], options: RecordingOptions): Promise<number> {
  const say = options.log ?? console.log;
  const record = runsRecord(plan.backend), updates = new Map<string, BenchmarkRun>();
  let reproduced = 0, changed = 0, accepted = 0;
  for (const row of completed) {
    const path = row.entry.fixture!;
    // No oracle record yet: nothing compared, and nothing to record.
    if (row.disposition === 4) { say(`  ${pendingLine(path, recordPath(path))}`); continue; }
    if (row.disposition === 5) { say(`ORACLE BUDGET ${path}: ${row.record.first}`); continue; }
    const now = benchmarkRun(row.record)!, before = plan.record?.rows.get(path);
    if (!before) { updates.set(path, now); say(`  ${pendingLine(path, record)}`); continue; }
    const change = compareBenchmarkRun(before, now);
    if (!change.ok) { changed += 1; say(`${change.word}  ${path}: ${JSON.stringify(before)} -> ${JSON.stringify(now)}`); }
    else if (acceptedChange(change)) { accepted += 1; updates.set(path, now); say(`  ${acceptedLine(change, path, record, JSON.stringify(before), JSON.stringify(now))}`); }
    else reproduced += 1;
  }
  const waiting = all.filter(entry => plan.pending.has(entry.fixture!) && (!plan.recordPending || !updates.has(entry.fixture!))).map(entry => entry.fixture!);
  for (const path of waiting) say(`  ${pendingLine(path, record)}`);
  for (const row of incomplete) say(`${row.error instanceof CaseBudgetError?"ORACLE BUDGET":"NOT MEASURED"} ${row.entry.name}: ${row.error instanceof Error ? row.error.message : String(row.error)}`);
  say(`  ${completed.length} benchmark cases through the ${plan.backend} backend: ${reproduced} as recorded, ${accepted} accepted, ${changed} changed; ${waiting.length} not recorded yet`);
  if (plan.recordPending && changed) say(`not recorded: ${changed} recorded run(s) changed`);
  // Each update was either pending or accepted by its own ratchet. Another
  // case's incomplete observation or regression cannot discard that evidence.
  if (plan.recordPending && updates.size) {
    await (options.write ?? (rows => writeRunRecord(plan, rows, options.binary)))(updates);
    say(`${plan.backend} recorded ${updates.size} row(s) into ${record}`);
  }
  if (incomplete.length) {
    const chosen = incomplete.find(row => checkFailurePolicy(row.error, changed).disposition !== "verdict") ?? incomplete[0]!;
    return reportCheckFailure(chosen.error, options.parentEnv, changed);
  }
  return changed ? 1 : 0;
}

/** Merge rows into the record, or start it: its header names the clean pin of main that measured them. */
async function writeRunRecord(plan: RunPlan, updates: ReadonlyMap<string, BenchmarkRun>, binary: string): Promise<void> {
  const {provenanceOf} = await import("../conformance/pin-provenance.ts");
  const pin = provenanceOf(binary);
  const compiler = createHash("sha256").update(readFileSync(binary)).digest("hex");
  assert.ok(pin?.clean && !pin.applied && /^[0-9a-f]{40}$/.test(pin.sha) && pin.binary_sha256 === compiler,
    "--record-pending requires a clean, unpatched pin of main as NTS_BIN; build it with tooling/conformance/pin.ts");
  const contents = plan.record ? mergeRunRecord(readFileSync(plan.file, "utf8"), updates)
    : serializeRunRecord({metadata: {version: 1, backend: plan.backend, commit: pin.sha, compiler: compiler.slice(0, 16), under: "benchmarks/cases"}, rows: new Map(updates)});
  mkdirSync(dirname(plan.file), {recursive: true});
  const temporary = `${plan.file}.partial-${process.pid}`;
  writeFileSync(temporary, contents); renameSync(temporary, plan.file);
}

