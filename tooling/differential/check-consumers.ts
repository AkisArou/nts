// Batch owners count completed comparisons before publishing incomplete work.
import {existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {availableParallelism, homedir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import assert from "node:assert/strict";
import {withToken} from "../gate/tokens.mjs";
import {ToolingInstrumentError} from "../gate/step-result.ts";
import {checkFailurePolicy, reportCheckFailure, runConsumer} from "./check-report.ts";
import type {CheckConsumer, DecodedCheck} from "./check-report-types.ts";

type Mode = "programs" | "rc" | "benchmarks" | "compiled-web";
type Entry = {name: string; project: string; consumer: CheckConsumer; backend?: string};
type Completed = {entry: Entry; record: DecodedCheck; disposition: number};
type Incomplete = {entry: Entry; error: unknown};
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function entries(mode: Mode, only: string | undefined, scratch: string): Entry[] {
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
      if (!existsSync(join(ROOT, project))) {
        project = join(scratch, `${name}.tsconfig.json`);
        writeFileSync(project, JSON.stringify({extends: join(ROOT, "tsconfig.fixtures.json"), include: [join(ROOT, fixture, "case.ts")]}));
      }
    } else if (!existsSync(join(ROOT, project))) continue;
    result.push({name, project, consumer: benchmarks ? "benchmark" : ["invalid", "unsupported"].includes(name) ? "refusal" : "program"});
  }
  if (only) assert.equal(result.length, 1, `unknown check fixture ${only}`);
  assert.ok(result.length > 0, "check corpus contains no projects");
  return result;
}

function completedFailure(row: Completed, mode: Mode): boolean {
  // A compiled-axis probe requires an actual comparison in every column.
  return row.disposition === 1 || (mode === "compiled-web" && row.disposition !== 0);
}

function summary(mode: Mode, completed: Completed[], incomplete: Incomplete[]): number {
  const agreed = completed.filter(row => row.disposition === 0 && row.entry.consumer !== "refusal").length;
  const bare = completed.filter(row => row.disposition === 2).length;
  const declined = completed.filter(row => row.disposition === 3).length;
  const failed = completed.filter(row => completedFailure(row, mode));
  for (const row of failed) {
    console.log(`DIS  ${row.entry.name}: ${row.record.first}`);
    for (const answer of row.record.answers) console.log(answer);
  }
  for (const row of incomplete) console.log(`NOT MEASURED ${row.entry.name}: ${row.error instanceof Error ? row.error.message : String(row.error)}`);
  if (mode === "benchmarks") {
    const backend = process.env.NTS_BACKEND ?? "jvm";
    if (agreed + failed.length === 0) console.log(`  no compiled benchmark cases compared through the ${backend} backend`);
    else console.log(`  ${agreed} of ${agreed + failed.length} benchmark cases agree with node through the ${backend} backend`);
  } else if (mode === "compiled-web") {
    console.log(`  ${agreed} of ${completed.length} compiled Web-platform columns compared and agreed`);
  } else {
    console.log(mode === "rc" ? `${agreed} of ${agreed + failed.length} pass under reference counting`
      : `${agreed} of ${agreed + failed.length} agree with node`);
  }
  if (bare) console.log(`  ${bare} compared nothing (no drivable source exports)`);
  if (declined) console.log(`  ${declined} source populations measured, but no compiled bindings were available`);
  return failed.length;
}

async function runPreparedBatch(mode: Mode, only: string | undefined, scratch: string): Promise<number> {
  const work = entries(mode, only, scratch), completed: Completed[] = [], incomplete: Incomplete[] = [];
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
        const {record, exitCode} = await withToken(() => runConsumer(binary, entry.project, entry.consumer, {cwd: ROOT,
          env: entry.backend ? {...env, NTS_BACKEND: entry.backend} : env}), {project: entry.project});
        completed.push({entry, record, disposition: exitCode});
      } catch (error) { incomplete.push({entry, error}); }
    }
  }));
  completed.sort((a, b) => a.entry.name.localeCompare(b.entry.name));
  incomplete.sort((a, b) => a.entry.name.localeCompare(b.entry.name));
  const failures = summary(mode, completed, incomplete);
  if (incomplete.length) {
    // Setup/pressure evidence retains its shared hold policy. With only
    // liveness failures, completed definite failures make the batch red.
    const chosen = incomplete.find(row => checkFailurePolicy(row.error, failures).disposition !== "verdict") ?? incomplete[0]!;
    return reportCheckFailure(chosen.error, process.env, failures);
  }
  if (failures > 0) return 1;
  const compared = completed.filter(row => row.disposition === 0 && row.entry.consumer !== "refusal").length;
  if (mode === "benchmarks") {
    const floor = Number(process.env.NTS_BENCH_AGREE_FLOOR ?? 52);
    assert.ok(Number.isSafeInteger(floor) && floor >= 0, "benchmark agreement floor must be a nonnegative integer");
    if (!only && compared < floor) { console.log(`  floor is ${floor} and this run agreed on ${compared}`); return 1; }
  } else if (compared === 0) { console.log("  no example was compared, which is not agreement"); return 1; }
  return 0;
}

export async function runBatch(mode: Mode, only?: string): Promise<number> {
  let scratch: string | undefined, outcome = 124;
  try {
    const cache = join(homedir(), ".cache/nts-check-consumers"); mkdirSync(cache, {recursive: true});
    scratch = mkdtempSync(join(cache, "run-"));
    outcome = await runPreparedBatch(mode, only, scratch);
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
  const [mode, only, ...extra] = process.argv.slice(2);
  const selected = (["programs", "rc", "benchmarks", "compiled-web"] as const).find(candidate => candidate === mode);
  if (!selected || extra.length) {
    process.exitCode = reportCheckFailure(new Error("usage: check-consumers.ts programs|rc|benchmarks|compiled-web [fixture]"));
  } else process.exitCode = await runBatch(selected, only);
}
