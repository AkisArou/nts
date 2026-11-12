import {runAsCommand} from '../differential/command-entry/main.ts';
import { FIXED_AMBIENT, measuredCompileEnvironment } from "./canonical-environment.ts";
// Five A/A repetitions of every compile-time module, on one immutable compiler.
// node tooling/gate/compile-counter-calibrate.ts --run-dir <evidence directory>
// --record measures then publishes; --publish <summary.json> uses retained raw evidence.
// --module <module> calibrates one module: it refreshes the module's row, or adds it
// when the module is pending, retaining every other row, its provenance and the policy.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reserveJob } from "./memory-ledger.ts";
import { COMPILE_ARMS, COMPILE_WORK_PROFILE, compileWorkSettings, COUNTER_SCOPE, compileArm, compileCommand, compileTimeModules, counterProblem, calibrationRecord, withCalibratedModule, readCounterTable, type Calibration, type CalibrationRun } from "./compile-counter.ts";
import { instructionsWork, parseMeasurement, spawnCounted } from "./cputime.mjs";

export async function calibrate():Promise<void>{
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const nts = resolve(process.env.NTS_BIN ?? join(root, "target/release/nts"));
const arm = compileArm(process.argv.slice(2));
const option = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
const jobs = Number(option("--jobs") ?? 4);
if (!Number.isInteger(jobs) || jobs < 1 || jobs > 8) throw new Error("--jobs must be between 1 and 8");
// The locked workspace install owns the root links. runtime/node is not a
// pnpm importer; the former copied node_modules tree is no longer an input.
for (const input of ["node_modules"]) {
  if (!existsSync(join(root, input))) throw new Error(`missing workspace input ${input}; run node tooling/inputs/linker.ts work <shared checkout> <tree> before calibration`);
}
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const population = compileTimeModules(root);
const selected = option("--module");
if (process.argv.includes("--module") && (!selected || selected.startsWith("--"))) throw new Error("--module requires a module");
if (process.argv.filter(arg => arg === "--module").length > 1) throw new Error("--module may be specified once");
const table = join(root, COMPILE_ARMS[arm].table);
const recordFile = join(root, COMPILE_ARMS[arm].calibration);
if (selected && !population.includes(selected)) throw new Error(`unknown compile-time module: ${selected}`);
const previousTable = selected ? readFileSync(table, "utf8") : undefined;
// A pending module has no row yet: its calibration adds one.
const refreshed = selected ? readCounterTable(previousTable!, arm).rows.has(selected) : false;
const modules = selected ? [selected] : population;
const cannot = instructionsWork();
if (cannot) throw new Error(`not measured: ${cannot}`);
const sha256 = digest(nts);
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const cache = join(homedir(), ".cache/nts-compile-calibration");
mkdirSync(cache, { recursive: true });
const out = resolve(option("--run-dir") ?? mkdtempSync(join(cache, "run-")));
mkdirSync(out, { recursive: true });
// The inventoried command population has no config evaluator descendants.
const configured = modules.filter(module => existsSync(join(root, module, "nts.config.ts")));
if (configured.length) throw new Error(`not measured: project config can spawn descendants: ${configured.join(", ")}; audit the command first`);
const publish = (summary: Calibration) => {
  if (summary.nts_sha256 !== sha256) throw new Error("calibration binary differs from NTS_BIN");
  if ((summary.arm ?? "nogc") !== arm) throw new Error("calibration preparation arm differs from --arm");
  for (const module of summary.modules) for (const run of module.runs) {
    const raw = parseMeasurement(readFileSync(run.counter_file, "utf8"));
    if (counterProblem(raw) || raw.instructions !== run.instructions || raw.cpu_s !== run.cpu_s) throw new Error(`raw counter evidence differs: ${run.counter_file}`);
  }
  if (selected && summary.commit !== commit) throw new Error("selected calibration source commit differs from this tree");
  const { text, policy, record } = selected
    ? withCalibratedModule(previousTable!, JSON.parse(readFileSync(recordFile, "utf8")), summary, population, selected)
    : calibrationRecord(summary, population);
  // No writes occur until every row and its retained raw evidence is valid.
  writeFileSync(recordFile, JSON.stringify(record, null, 2) + "\n");
  writeFileSync(table, text);
  console.log(`published ${arm}: ${selected ? `${selected}'s row ${refreshed ? "refreshed" : "added"}` : `${modules.length} five-repeat medians`}, relative-only ratio ${policy.ratio.toFixed(2)}`);
};
const retained = option("--publish");
if (retained) { publish(JSON.parse(readFileSync(retained, "utf8"))); process.exit(0); }
if (existsSync(join(out, "summary.json")) || existsSync(join(out, "observations.jsonl"))) throw new Error(`refusing to overwrite evidence in ${out}`);
const measuredEnvironment=measuredCompileEnvironment(process.env);
const work_settings=compileWorkSettings(measuredEnvironment);
const tasks = Array.from({ length: 5 }, (_, repeat) => modules.map(module => ({ module, repeat: repeat + 1 }))).flat();
const rows: (CalibrationRun & { cpu_s: number; instructions: number })[] = [];
// The calibration's memory, reserved once for every repetition, by what its
// earlier runs of this arm held per worker.
await reserveJob({ key: `compile-counter-calibrate-${arm}`, units: jobs, what: `compile counter calibration (${arm}, ${tasks.length} compiles)` },
  { report: console.log });
let next = 0;
let failed = false;
writeFileSync(join(out, "provenance.json"), JSON.stringify({ arm, work_profile: COMPILE_WORK_PROFILE, work_settings, counter_scope: COUNTER_SCOPE, root, commit, nts, sha256,
  started: new Date().toISOString(), jobs, repetitions: 5, modules, command: compileCommand(arm, "<module>"),
  environment: { ...FIXED_AMBIENT, RAYON_NUM_THREADS:measuredEnvironment.RAYON_NUM_THREADS },
  scope_note: "all threads and descendants from exec; these module commands have no process descendants; sum raw cpu_core and cpu_atom" }, null, 2) + "\n");
await Promise.all(Array.from({ length: jobs }, async () => {
  while (!failed && next < tasks.length) {
    const task = tasks[next++];
    const name = `${task.module.replaceAll("/", "_")}-${task.repeat}`;
    const began = performance.now();
    const counted = spawnCounted(nts, compileCommand(arm, task.module), { cwd: root, stdio: ["ignore", "pipe", "pipe"],
      env: measuredEnvironment, counterFile: join(out, `${name}.perf`) });
    let stderr = "", partial = "";
    let stated: number | null = null, definitions = 0;
    const listing = createHash("sha256");
    const line = (text: string) => {
      const summary = /^(\d+) function\(s\)/.exec(text);
      if (summary) stated = Number(summary[1]);
      if (/^(?:export )?(?:declare )?func /.test(text)) definitions++;
    };
    counted.child.stdout.on("data", (chunk: Buffer) => {
      listing.update(chunk);
      const lines = (partial + chunk.toString()).split("\n");
      partial = lines.pop()!;
      for (const text of lines) line(text);
    });
    counted.child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });
    const counter = await counted.measurement;
    if (partial) line(partial);
    const row = { ...task, arm, work_profile: COMPILE_WORK_PROFILE, work_settings, ...counter, wall_s: (performance.now() - began) / 1000,
      listing_functions: stated, listing_definitions: definitions, listing_sha256: listing.digest("hex") };
    if (stated === null || stated < 1 || stated !== definitions) row.counter_error = `incomplete listing: ${definitions} definitions, stated ${stated}`;
    writeFileSync(join(out, `${name}.stderr`), stderr);
    rows.push(row);
    writeFileSync(join(out, "observations.jsonl"), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
    const problem = counterProblem(row);
    if (problem) { failed = true; console.error(`NOT MEASURED ${name}: ${problem}`); }
    else console.log(`${name}: ${(row.instructions / 1e9).toFixed(3)} G, ${row.cpu_s.toFixed(3)} CPU-s`);
  }
}));
if (digest(nts) !== sha256) throw new Error("compiler binary changed during calibration");
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summaries = modules.map(module => {
  const runs = rows.filter(r => r.module === module).sort((a, b) => a.repeat - b.repeat);
  const valid = runs.length === 5 && runs.every(r => counterProblem(r) === null);
  const counts = runs.map(r => r.instructions as number);
  return { module, valid, runs, median_instructions: valid ? median(counts) : null,
    median_cpu_s: valid ? median(runs.map(r => r.cpu_s)) : null,
    spread: valid ? Math.max(...counts) / Math.min(...counts) - 1 : null };
});
const summary = { arm, work_profile: COMPILE_WORK_PROFILE, work_settings, counter_scope: COUNTER_SCOPE, commit, nts_sha256: sha256, raw_directory: out,
  complete: !failed && summaries.every(s => s.valid),
  total_cpu_s: rows.reduce((sum, r) => sum + (r.cpu_s ?? 0), 0),
  maximum_spread: Math.max(...summaries.filter(s => s.valid).map(s => s.spread!)), modules: summaries };
writeFileSync(join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(`calibration ${summary.complete ? "complete" : "NOT MEASURED"}: ${rows.length}/${tasks.length}; ${out}`);
if (!summary.complete) process.exitCode = 2;
else if (process.argv.includes("--record")) publish(summary);

}
runAsCommand(import.meta.url,calibrate);
