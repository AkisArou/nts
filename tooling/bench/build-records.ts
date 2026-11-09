/** Compile-only benchmark observations. This command never executes a workload. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as poll } from "node:timers/promises";
import { memoryRun } from "../census/worker-memory.ts";
import type { Backend } from "../census/typescript-record.ts";
import { provenanceOf } from "../conformance/pin.ts";
import { Admission } from "../gate/admission.ts";
import { withToken } from "../gate/tokens.mjs";
import { CommandNotMeasuredError } from "../gate/active-command.ts";
import { ToolingInstrumentError, publishToolingFailure } from "../gate/step-result.ts";
import { acceptedChange } from "../conformance/outcome-transition.ts";
import { acceptedLine, pendingLine } from "../records/pending.ts";
import { compileEnvironment, compileKey, observeCompile, projectFor, regularFiles } from "./compile-producer.ts";
import { STEPS } from "../gate/step-table.mjs";
import { benchmarkInventory, benchmarkKey, compareBenchmarkOutcome, mergeBenchmarkRecord, parseBenchmarkRecord, requireBenchmarkScopes,
  serializeBenchmarkRecord, type BenchmarkRecord, type BenchmarkRow } from "./outcomes.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BACKENDS = ["c", "llvm", "jvm"] as const;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

/** Measured compile cells against their rows: what the ratchet does not accept fails; what it accepts is listed. */
export interface CompileComparison { changed: string[]; accepted: { row: BenchmarkRow; line: string }[] }

/** Hold measured cells to their recorded rows, in `file`. A cell with no row yet is pending: not compared here. */
export function checkCompileRecord(record: BenchmarkRecord, actual: BenchmarkRow[], file: string): CompileComparison {
  requireBenchmarkScopes(record, ["compile"]);
  const expected = record.rows.filter(row => row.scope === "compile");
  const pending = new Set(benchmarkInventory({ ...record, rows: expected }, actual).map(benchmarkKey));
  const byKey = new Map(expected.map(row => [benchmarkKey(row), row]));
  const result: CompileComparison = { changed: [], accepted: [] };
  for (const row of actual) {
    if (pending.has(benchmarkKey(row))) continue;
    const before = byKey.get(benchmarkKey(row))!.outcome, change = compareBenchmarkOutcome(before, row.outcome);
    if (!change.ok) result.changed.push(`${change.word} ${row.path}: ${JSON.stringify(before)} -> ${JSON.stringify(row.outcome)}; re-record this outcome`);
    else if (acceptedChange(change)) result.accepted.push({ row, line: acceptedLine(change, row.path, file, JSON.stringify(before), JSON.stringify(row.outcome)) });
  }
  return result;
}

/** Every benchmark case: a directory under benchmarks/cases with a case.ts. */
export function benchmarkCases(root: string): string[] {
  const paths = readdirSync(join(root, "benchmarks/cases"), { withFileTypes: true }).filter(entry => entry.isDirectory() && existsSync(join(root, "benchmarks/cases", entry.name, "case.ts")))
    .map(entry => `benchmarks/cases/${entry.name}`).sort();
  assert.ok(paths.length > 0, "no benchmark cases found; an empty run is not passing"); return paths;
}

/** Source identity comes from the declared SDK's resolved graph, including
 * inherited configs, plus all case-local data. This is identity validation,
 * not a cache: the compiler still executes every selected cell on every run.
 */
export async function benchmarkIdentities(root: string, paths: string[], scratch: string): Promise<Map<string, string>> {
  const { API } = await import("typescript/sync");
  const api = new API({ cwd: root });
  const identities = new Map<string, string>();
  try {
    for (const path of paths) {
      const config = projectFor(root, path, scratch);
      const snapshot = api.createSnapshot({ openProjects: [config] });
      try {
        const project = snapshot.getConfiguredProject(config);
        assert.ok(project, `benchmark identity cannot resolve project: ${path}`);
        const program = project.program;
        const sources = program.getSourceFileNames();
        assert.ok(sources.includes(join(root, path, "case.ts") as typeof sources[number]), `benchmark identity has no checked entry: ${path}`);
        // The oracle's call population is not a compile input. An actual
        // source import still enters through the checked graph above.
        const data = regularFiles(join(root, path)).filter(file => file !== join(root, path, "case.domains.json"));
        const inputs = new Set([...sources, ...program.getConfigFileNames(), ...data]);
        const entries: [string, string][] = [];
        for (const file of inputs) {
          if (file === config && config.startsWith(scratch + "/")) {
            entries.push(["$generated-config", hash(JSON.stringify({ extends: "tsconfig.fixtures.json", include: [path + "/"] }))]); continue;
          }
          const local = relative(root, file);
          const library = program.getSourceFileMetadata(file)?.isDefaultLibrary;
          const label = library ? `$typescript/lib/${basename(file)}` : !local.startsWith("../") && !isAbsolute(local) ? local : undefined;
          assert.ok(label, `benchmark identity has an undeclared external source: ${file}`);
          entries.push([label, hash(readFileSync(file))]);
        }
        entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        identities.set(path, hash(JSON.stringify(entries)));
      } finally { snapshot.dispose(); api.clearSourceFileCache(); }
    }
  } finally { api.close(); }
  return identities;
}

function publish(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true }); const temporary = `${file}.partial-${randomUUID()}`;
  try { writeFileSync(temporary, contents, { flag: "wx" }); renameSync(temporary, file); }
  finally { rmSync(temporary, { force: true }); }
}

/**
 * `--record` writes every case's row from a clean pin of main. `--check` holds
 * each recorded row and reports a case with no row yet as pending, without
 * measuring it. `--record-pending` is the full check's writer, after landing:
 * from a clean pin it measures every case, holds the recorded ones, and on a
 * clean comparison writes the pending rows and the accepted changes, every other line byte
 * for byte.
 */
export async function runBuildRecords(args = process.argv.slice(2)): Promise<number> {
  const mode = args.shift(); assert.ok(mode === "--record" || mode === "--check" || mode === "--record-pending", "usage: build-records.ts --record|--check|--record-pending [--backend c|llvm|jvm] [--output directory] [case]");
  let backends: readonly Backend[] = BACKENDS, output = join(ROOT, "results/benchmarks"), only: string | undefined;
  while (args.length) {
    const flag = args.shift();
    if (flag === "--backend") { const value = args.shift(); assert.ok(BACKENDS.includes(value as Backend), "unknown benchmark backend"); backends = [value as Backend]; }
    else if (flag === "--output") { const value = args.shift(); assert.ok(value, "--output needs a directory"); output = resolve(value); }
    else { assert.ok(flag && !flag.startsWith("-") && !only && mode === "--check", `unknown benchmark argument: ${flag}`); only = flag; }
  }
  const binary = resolve(process.env.NTS_BIN ?? join(ROOT, "target/release/nts"));
  assert.ok(existsSync(binary), `benchmark compiler missing: ${binary}; set NTS_BIN`);
  const compiler = hash(readFileSync(binary)), pin = provenanceOf(binary);
  let commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (mode !== "--check") {
    assert.ok(pin?.clean && !pin.applied && /^[0-9a-f]{40}$/.test(pin.sha), `${mode} requires a clean, unpatched pin of main; build it with tooling/conformance/pin.ts`);
    assert.equal(pin.binary_sha256, compiler, `${mode} pin binary differs from its recorded bytes`);
    execFileSync("git", ["merge-base", "--is-ancestor", pin.sha, "main"], { cwd: ROOT, stdio: "pipe" }); commit = pin.sha;
  }
  const recordFile = (backend: Backend) => join(output, backend, "outcomes.tsv");
  const shown = (file: string) => { const local = relative(ROOT, file); return local.startsWith("..") || isAbsolute(local) ? file : local; };
  const base = process.env.TMPDIR ?? join(homedir(), ".cache/nts/benchmark-records"); mkdirSync(base, { recursive: true });
  const scratch = mkdtempSync(join(base, "compile-"));
  let resident = false;
  try {
    // A compile's memory is its step's reservation (NTS_GATE_STEP_MEMORY_BYTES).
    // Outside a step, as the records writer runs, it is the benches step's own,
    // so a check reproduces what was recorded; it stays out of compile-producer.ts,
    // which is the compile key and would move every recorded row's driver.
    process.env.NTS_GATE_STEP_MEMORY_BYTES ??= String(STEPS.find(step => step.name === "benches")!.mem * 2 ** 30);
    const environment = compileEnvironment(process.env, scratch, binary);
    const all = benchmarkCases(ROOT), paths = only ? all.filter(path => path === `benchmarks/cases/${only}`) : all;
    assert.ok(paths.length > 0, `unknown benchmark case: ${only}`);
    const identities = await benchmarkIdentities(ROOT, all, scratch), driver = compileKey(ROOT);
    const records = new Map<Backend, BenchmarkRecord>(), pending = new Map<Backend, Set<string>>(), actual = new Map<Backend, BenchmarkRow[]>();
    for (const backend of backends) {
      if (mode !== "--record") {
        const file = recordFile(backend);
        assert.ok(existsSync(file), `no benchmark compile record: ${file}; run build-records.ts --record on main's official pin`);
        const record = parseBenchmarkRecord(readFileSync(file, "utf8")); assert.equal(record.metadata.backend, backend, "foreign benchmark backend");
        requireBenchmarkScopes(record, ["compile"]);
        const cells = all.map(path => ({ path, scope: "compile" as const, source: identities.get(path)!, driver }));
        pending.set(backend, new Set(benchmarkInventory({ ...record, rows: record.rows.filter(row => row.scope === "compile") }, cells).map(row => row.path)));
        records.set(backend, record);
      }
      actual.set(backend, []);
    }
    const admission = new Admission({ report: message => console.error(message) });
    for (const path of paths) for (const backend of backends) {
      // A case with no row yet is not measured at landing: the full check records it.
      if (mode === "--check" && pending.get(backend)!.has(path)) continue;
      // Nor is a recorded compile timeout. Compiling only, it cannot get worse,
      // and measuring it costs its whole bound on every check: ten such rows
      // held the full check's benches step past its own ceiling. The records
      // writer measures every case, so a timeout that improves is still written.
      const recorded = mode === "--check" ? records.get(backend)!.rows.find(row => row.path === path && row.scope === "compile") : undefined;
      if (recorded?.outcome.kind === "timeout") {
        actual.get(backend)!.push(recorded);
        console.log(`${backend} ${path}: timeout, as recorded; a check does not measure it again`);
        continue;
      }
      // The standalone recorder has no resident worker keeping it alive.
      // Keep this admission wait referenced, as the calibration recorder does.
      while (!admission.open()) await poll(2000);
      resident = true;
      const outcome = await withToken(() => observeCompile({ backend, project: projectFor(ROOT, path, scratch), output: join(scratch, "output"), binary, root: ROOT, env: environment }), { project: path, backend });
      actual.get(backend)!.push({ path, scope: "compile", source: identities.get(path)!, driver, outcome });
      console.log(`${backend} ${path}: ${outcome.kind}`);
    }
    assert.equal(hash(readFileSync(binary)), compiler, "compiler bytes changed during recording");
    assert.equal(compileKey(ROOT), driver, "benchmark compile producer changed during recording");
    assert.deepEqual(await benchmarkIdentities(ROOT, all, scratch), identities, "benchmark sources changed during recording");
    let changed = 0, accepted = 0, waiting = 0;
    const updates = new Map<Backend, BenchmarkRow[]>();
    for (const backend of backends) {
      const rows = actual.get(backend)!;
      if (mode === "--record") {
        const contents = serializeBenchmarkRecord({ metadata: { version: 1, backend, commit, compiler: compiler.slice(0, 16), harness: driver.slice(0, 16), under: "benchmarks/cases", scopes: ["compile"] }, rows });
        publish(recordFile(backend), contents);
        continue;
      }
      const record = records.get(backend)!, unrecorded = pending.get(backend)!;
      const comparison = checkCompileRecord({ ...record, rows: record.rows.filter(row => paths.includes(row.path)) }, rows.filter(row => !unrecorded.has(row.path)), shown(recordFile(backend)));
      for (const message of comparison.changed) console.log(`${backend} ${message}`);
      for (const { line } of comparison.accepted) console.log(`${backend} ${line}`);
      const waits = paths.filter(path => unrecorded.has(path));
      for (const path of waits) console.log(`${backend} ${pendingLine(path, shown(recordFile(backend)))}`);
      changed += comparison.changed.length; accepted += comparison.accepted.length; waiting += waits.length;
      updates.set(backend, [...rows.filter(row => unrecorded.has(row.path)), ...comparison.accepted.map(({ row }) => row)]);
    }
    if (mode === "--record-pending" && changed) console.log(`not recorded: ${changed} recorded outcome(s) changed; records are written only from a clean comparison`);
    else if (mode === "--record-pending") for (const [backend, rows] of updates) {
      if (!rows.length) continue;
      publish(recordFile(backend), mergeBenchmarkRecord(readFileSync(recordFile(backend), "utf8"), rows));
      console.log(`${backend} recorded ${rows.length} row(s) into ${shown(recordFile(backend))}`);
    }
    console.log(`${paths.length} benchmark cases, ${backends.length} backends, compile-only coverage; ${changed} changed outcomes, ${accepted} accepted, ${waiting} pending`);
    return changed ? 1 : 0;
  } finally {
    try { if (resident) memoryRun().close(); }
    finally { rmSync(scratch, { recursive: true, force: true }); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await runBuildRecords(); }
  catch (error) {
    console.error(`benchmark NOT MEASURED: ${error instanceof Error ? error.message : String(error)}`);
    if (!(error instanceof CommandNotMeasuredError)) publishToolingFailure(error instanceof ToolingInstrumentError ? error : new ToolingInstrumentError("tooling-setup", String(error)));
    process.exitCode = 124;
  }
}
