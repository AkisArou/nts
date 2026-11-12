import {CaseBudgetError} from '../gate/step-result.ts';
// Batch owners count completed comparisons before publishing incomplete work.
import {existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {availableParallelism, homedir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import assert from "node:assert/strict";
import {openProgramOracleResults} from './oracle-results.ts';
import {oracleRecipeIdentity} from './oracle-emit.ts';
import {withToken} from "../gate/tokens.mjs";
import {ToolingInstrumentError} from "../gate/step-result.ts";
import {checkFailurePolicy, reportCheckFailure, runConsumer} from "./check-report.ts";
import type {CheckConsumer, DecodedCheck} from "./check-report-types.ts";
import {pendingContradiction, recordPath} from "./oracle-records.ts";
import {pendingLine} from "../records/pending.ts";
import {readFileSync} from "node:fs";
import {PROGRAM_DISAGREEMENTS} from "../gate/verdict-policy.ts";
import {parseRunRecord,pendingRuns,runsRecord,type RunBackend} from "../bench/run-outcomes.ts";
import {finishBenchmarks,type RunPlan} from "../bench/run-recording.ts";

type Mode = "programs" | "rc" | "benchmarks" | "compiled-web";
type Entry = {name: string; project: string; consumer: CheckConsumer; backend?: string; fixture?: string};
type Completed = {entry: Entry; record: DecodedCheck; disposition: number};
type Incomplete = {entry: Entry; error: unknown};
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function entries(mode: Mode, only: string | undefined, scratch: string): Entry[] {
  const references=mode==='benchmarks'&&process.env.NTS_PROGRAM_ORACLE
    ?openProgramOracleResults(JSON.parse(process.env.NTS_PROGRAM_ORACLE),oracleRecipeIdentity()):undefined;
  if (mode === "compiled-web") return ["jvm", "c", "llvm"].map(backend => ({name: backend, backend,
    project: "tooling/conformance/web-platform/compiled/tsconfig.json", consumer: "program"}));
  const benchmarks = mode === "benchmarks", area = benchmarks ? "benchmarks/cases" : "tests/programs";
  const result: Entry[] = [];
  for (const directory of readdirSync(join(ROOT, area), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!directory.isDirectory() || (only && only !== directory.name)) continue;
    const name = directory.name, fixture = join(area, name);
    let project = join(fixture, "tsconfig.json");
    if (benchmarks) {
      if (!existsSync(join(ROOT, fixture, "case.ts"))) continue;
      if(references&&existsSync(join(ROOT,recordPath(fixture))))project=references.project(fixture);
      else if (!existsSync(join(ROOT, project))) {
        project = join(scratch, `${name}.tsconfig.json`);
        writeFileSync(project, JSON.stringify({extends: join(ROOT, "tsconfig.fixtures.json"), include: [join(ROOT, fixture, "case.ts")]}));
      }
    } else if (!existsSync(join(ROOT, project))) continue;
    result.push({name, project, fixture, consumer: benchmarks ? "benchmark" : ["invalid", "unsupported"].includes(name) ? "refusal" : "program"});
  }
  if (only) assert.equal(result.length, 1, `unknown check fixture ${only}`);
  assert.ok(result.length > 0, "check corpus contains no projects");
  return result;
}

function completedFailure(row: Completed, mode: Mode): boolean {
  // A compiled-axis probe requires an actual comparison in every column.
  return row.disposition === 1 || (mode === "compiled-web" && row.disposition !== 0);
}

function namedDisagreement(row: Completed, mode: Mode): string | undefined {
  return (mode === "programs" || mode === "rc") && row.disposition === 1 && row.record.first === "disagrees" && !row.record.timeout
    ? PROGRAM_DISAGREEMENTS[row.entry.name] : undefined;
}

function summary(mode: Mode, completed: Completed[], incomplete: Incomplete[]): number {
  const agreed = completed.filter(row => row.disposition === 0 && row.entry.consumer !== "refusal").length;
  const bare = completed.filter(row => row.disposition === 2).length;
  const declined = completed.filter(row => row.disposition === 3).length;
  // No oracle record yet: not compared at landing, and not a failure.
  const pending = completed.filter(row => row.disposition === 4 && row.entry.fixture);
  const failed = completed.filter(row => completedFailure(row, mode));
  for (const row of failed) {
    const timeout = row.record.timeout;
    if (timeout) { console.log(`TIMEOUT  ${row.entry.name} (${timeout.stage}): ${timeout.reason}`); continue; }
    console.log(`DIS  ${row.entry.name}: ${row.record.first}`);
    for (const answer of row.record.answers) console.log(answer);
    const reason = namedDisagreement(row, mode);
    if (reason) console.log(`  allowed disagreement ${row.entry.name}: ${reason}`);
  }
  for(const row of completed.filter(row=>row.disposition===5))console.log(`ORACLE BUDGET ${row.entry.name}: ${row.record.first}`);
  for (const row of incomplete) console.log(`${row.error instanceof CaseBudgetError?"ORACLE BUDGET":"NOT MEASURED"} ${row.entry.name}: ${row.error instanceof Error ? row.error.message : String(row.error)}`);
  if (mode === "compiled-web") {
    console.log(`  ${agreed} of ${completed.length} compiled Web-platform columns compared and agreed`);
  } else {
    console.log(mode === "rc" ? `${agreed} of ${agreed + failed.length} pass under reference counting`
      : `${agreed} of ${agreed + failed.length} agree with node`);
  }
  if (bare) console.log(`  ${bare} compared nothing (no drivable source exports)`);
  for (const row of pending) console.log(`  ${pendingLine(row.entry.fixture!, recordPath(row.entry.fixture!))}`);
  if (declined) console.log(`  ${declined} source populations measured, but no compiled bindings were available`);
  return failed.filter(row => !namedDisagreement(row, mode)).length;
}

/** bench-agree's record for one backend (tooling/bench/run-outcomes.ts): which benchmarks it holds, and which it has no row for. */
function runPlan(all: Entry[], recordPending: boolean): RunPlan {
  const backend = (process.env.NTS_BACKEND ?? "jvm") as RunBackend, file = join(ROOT, runsRecord(backend));
  assert.ok(["c", "llvm", "jvm"].includes(backend), `unknown benchmark backend ${backend}`);
  const record = existsSync(file) ? parseRunRecord(readFileSync(file, "utf8")) : null;
  if (record) assert.equal(record.metadata.backend, backend, `${runsRecord(backend)} records another backend`);
  return {backend, file, record, pending: new Set(pendingRuns(record, all.map(entry => entry.fixture!))), recordPending};
}

async function runPreparedBatch(mode: Mode, only: string | undefined, scratch: string, recordPending = false): Promise<number> {
  const all = entries(mode, only, scratch), completed: Completed[] = [], incomplete: Incomplete[] = [];
  const plan = mode === "benchmarks" ? runPlan(all, recordPending) : null;
  // A benchmark with no row yet is not run at landing: the full check records it.
  const work = plan && !plan.recordPending ? all.filter(entry => !plan.pending.has(entry.fixture!)) : all;
  const binary = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
  // Only the owning batch publishes the final frame. Its children cannot
  // overwrite another child's evidence or hide a completed failure.
  const env = {...process.env}; delete env.NTS_GATE_STEP_RESULT;
  if (mode === "rc") env.NTS_RC = "1";
  if (mode === "benchmarks" && !env.NTS_BACKEND) env.NTS_BACKEND = "jvm";
  const jobs = mode === "compiled-web" ? 1 : Number(env.NTS_GATE_JOBS ?? Math.min(8, availableParallelism()));
  assert.ok(Number.isSafeInteger(jobs) && jobs > 0, "check worker count must be a positive integer");
  let next = 0;
  await Promise.all(Array.from({length: Math.min(jobs, work.length)}, async () => {
    for (;;) {
      const entry = work[next++]; if (!entry) return;
      try {
        // A case past its bound is a recorded timeout, and the next case runs.
        const {record, exitCode} = await withToken(() => runConsumer(binary, entry.project, entry.consumer, {cwd: ROOT, timeoutOutcome: true,
          env: entry.backend ? {...env, NTS_BACKEND: entry.backend} : env}), {project: entry.fixture??entry.project,backend:entry.backend??env.NTS_BACKEND??'c'});
        const contradiction = exitCode === 4 ? pendingContradiction(ROOT, entry.fixture) : null;
        completed.push(contradiction ? {entry, record: {...record, first: contradiction}, disposition: 1} : {entry, record, disposition: exitCode});
      } catch (error) { incomplete.push({entry, error}); }
    }
  }));
  completed.sort((a, b) => a.entry.name.localeCompare(b.entry.name));
  incomplete.sort((a, b) => a.entry.name.localeCompare(b.entry.name));
  if (plan) return finishBenchmarks(plan, all, completed, incomplete, {binary,parentEnv:process.env});
  const failures = summary(mode, completed, incomplete);
  if (incomplete.length) {
    // Setup/pressure evidence retains its shared hold policy. With only
    // liveness failures, completed definite failures make the batch red.
    const chosen = incomplete.find(row => checkFailurePolicy(row.error, failures).disposition !== "verdict") ?? incomplete[0]!;
    return reportCheckFailure(chosen.error, process.env, failures);
  }
  if (failures > 0) return 1;
  const compared = completed.filter(row => (row.disposition === 0 && row.entry.consumer !== "refusal") || namedDisagreement(row, mode)).length;
  if (compared === 0) { console.log("  no example was compared, which is not agreement"); return 1; }
  return 0;
}

export async function runBatch(mode: Mode, only?: string, recordPending = false): Promise<number> {
  let scratch: string | undefined, outcome = 124;
  try {
    const cache = join(homedir(), ".cache/nts-check-consumers"); mkdirSync(cache, {recursive: true});
    scratch = mkdtempSync(join(cache, "run-"));
    outcome = await runPreparedBatch(mode, only, scratch, recordPending);
  } catch (error) {
    console.error(`check NOT MEASURED: ${error instanceof Error ? error.message : String(error)}`);
    outcome = reportCheckFailure(error);
  } finally {
    if (scratch) {
      try { rmSync(scratch, {recursive: true, force: true}); }
      catch (error) {
        outcome = reportCheckFailure(new ToolingInstrumentError("tooling-cleanup", `cannot remove check scratch ${scratch}: ${error instanceof Error ? error.message : String(error)}`, {cause: error}));
      }
    }
  }
  return outcome;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, ...rest] = process.argv.slice(2);
  const recordPending = mode === "benchmarks" && rest[0] === "--record-pending";
  if (recordPending) rest.shift();
  const [only, ...extra] = rest;
  const selected = (["programs", "rc", "benchmarks", "compiled-web"] as const).find(candidate => candidate === mode);
  if (!selected || extra.length || (recordPending && only)) {
    process.exitCode = reportCheckFailure(new Error("usage: check-consumers.ts programs|rc|compiled-web [fixture] | benchmarks [--record-pending | fixture]"));
  } else process.exitCode = await runBatch(selected, only, recordPending);
}
