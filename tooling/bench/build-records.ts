import {gitArguments} from "../gate/git-arguments/main.ts";
import {runAsCommand} from "../differential/command-entry/main.ts";
/** Compile-only benchmark observations. This command never executes a workload. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {fileURLToPath} from "node:url";
import {dataDirectory} from "../gate/reader-inputs/main.ts";
import { closeMemoryRun, memoryRun } from "../census/worker-memory.ts";
import type { Backend } from "../census/typescript-record.ts";
import { provenanceOf } from "../conformance/pin.ts";
import { createFeed, type CaseToken } from "../gate/admission.ts";
import { reserveJob, type JobRequest } from "../gate/memory-ledger.ts";
import { acquireToken,runWithToken,releaseToken } from "../gate/tokens.mjs";
import { CommandNotMeasuredError } from "../gate/active-command.ts";
import { ToolingInstrumentError, publishToolingFailure } from "../gate/step-result.ts";
import { acceptedChange } from "../conformance/outcome-transition.ts";
import { acceptedLine, pendingLine } from "../records/pending.ts";
import { compileEnvironment, compileKey, observeCompile, projectFor, regularFiles } from "./compile-producer.ts";
import { benchmarkInventory, benchmarkKey, compareBenchmarkOutcome, mergeBenchmarkRecord, parseBenchmarkRecord, requireBenchmarkScopes,
  serializeBenchmarkRecord, type BenchmarkOutcome, type BenchmarkRecord, type BenchmarkRow } from "./outcomes.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CASES=relative(ROOT,fileURLToPath(dataDirectory(new URL("../../benchmarks/cases/",import.meta.url))));
const BACKENDS = ["c", "llvm", "jvm"] as const;
/**
 * Each compile's own kernel cap: the one its rows were recorded under, a
 * limit and never a reservation. compile-producer.ts takes it from
 * NTS_GATE_STEP_MEMORY_BYTES, and stays as it is, because it is the compile
 * key and would move every recorded row's driver.
 */
export const COMPILE_CAP_BYTES = 6 * 2 ** 30;
/** The compiles at once outside a gate, unless --jobs says otherwise: the census's width. */
export const DEFAULT_LANES = Math.min(8, availableParallelism());
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
  const paths = readdirSync(join(root, CASES), { withFileTypes: true }).filter(entry => entry.isDirectory() && existsSync(join(root, CASES, entry.name, "case.ts")))
    .map(entry => `${CASES}/${entry.name}`).sort();
  assert.ok(paths.length > 0, "no benchmark cases found; an empty run is not passing"); return paths;
}

/** Canonical options retain array order and remove checkout-specific prefixes. */
function compilerIdentityValue(root: string, value: unknown): unknown {
  if (typeof value === "string" && isAbsolute(value)) {
    const local = relative(root, value);
    return local === "" ? "$root" : !local.startsWith("../") && !isAbsolute(local) ? "$root/" + local.split(sep).join("/") : value;
  }
  if (Array.isArray(value)) return value.map(entry => compilerIdentityValue(root, entry));
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, compilerIdentityValue(root, entry)]),
  );
  return value;
}

/** Source identity comes from the SDK's resolved options, roots and sources,
 * plus case-local data. Config syntax only selects those inputs. This is identity validation,
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
        const configs = new Set<string>(program.getConfigFileNames());
        const options = { ...program.getCompilerOptions() };
        // This records where options were read, including a generated scratch
        // config. Resolved options and roots carry its compiler-facing meaning.
        delete options.configFilePath;
        assert.ok(sources.includes(join(root, path, "case.ts") as typeof sources[number]), `benchmark identity has no checked entry: ${path}`);
        // The oracle's call population is not a compile input. An actual
        // source import still enters through the checked graph above.
        const data = regularFiles(join(root, path)).filter(file => file !== join(root, path, "case.domains.json") && !configs.has(file));
        const labelOf = (file: string): string => {
          const local = relative(root, file);
          const library = program.getSourceFileMetadata(file)?.isDefaultLibrary;
          const label = library ? `$typescript/lib/${basename(file)}` : !local.startsWith("../") && !isAbsolute(local) ? local : undefined;
          assert.ok(label, `benchmark identity has an undeclared external source: ${file}`);
          return label.split(sep).join("/");
        };
        // A config imported by the program remains a source, even though its
        // role as configuration does not contribute raw bytes.
        const entries: [string, string][] = [...new Set([...sources, ...data])].map(file => [labelOf(file), hash(readFileSync(file))]);
        entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        identities.set(path, hash(JSON.stringify(compilerIdentityValue(root, {
          version: 2, options, roots: project.parsedCommandLine.fileNames.map(labelOf), files: entries,
        }))));
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

/** One compile cell: a case on a backend. */
export interface CompileCell { path: string; backend: Backend }

/**
 * The memory `lanes` compiles at once reserve outside a gate: what one lane
 * of this job held at most in its earlier runs, times the lanes, and never
 * more than their caps. The history keeps the peak per lane, so a run of any
 * width reserves by it (memory-ledger.ts's jobSizing).
 */
export function recordsJob(lanes: number, what: string): JobRequest {
  return { key: "bench-compile-records", units: lanes, atMostBytes: lanes * COMPILE_CAP_BYTES, what };
}

/**
 * Compile `cells` on up to `lanes` at once, taken in their order: each holds
 * one of the gate's tokens while it compiles (`token`, tokens.mjs's; none
 * outside a gate), and none starts while the job's reservation is outranked
 * (admission.ts's feed). The outcomes come back in the cells' order, whatever
 * order the compiles ended in, and `ended` hears each as it ends. The first
 * compile that throws stops the feed: the ones running then end, and it is
 * thrown, so nothing is measured past it, as one at a time.
 */
export async function compileCells(cells: readonly CompileCell[], lanes: number, compile: (cell: CompileCell, lane: number) => Promise<BenchmarkOutcome>,
  { token = (cell, signal) => acquireToken({ project: cell.path, backend: cell.backend }, signal), outranked = () => false, ended = () => {} }: {
    token?: (cell: CompileCell, signal: AbortSignal) => Promise<(() => void) | null>;
    outranked?: () => boolean;
    ended?: (cell: CompileCell, outcome: BenchmarkOutcome) => void;
  } = {}): Promise<BenchmarkOutcome[]> {
  assert.ok(Number.isSafeInteger(lanes) && lanes >= 1, `compile lanes are a whole number of at least 1, not ${lanes}`);
  const outcomes: BenchmarkOutcome[] = new Array(cells.length), stop = new AbortController();
  let failure: { error: unknown } | undefined;
  const cellToken: CaseToken = (entry, signal) => token(cells[Number(entry)]!, signal);
  const feed = createFeed(cells.map((_, index) => String(index)), { token: cellToken, outranked });
  const lane = async (index: number) => {
    for (;;) {
      let taken: { cell: number; release: () => void } | undefined;
      await feed.feed({ write: (entry, release) => { taken = { cell: Number(entry), release }; }, end: () => {}, exited: () => failure !== undefined, signal: stop.signal });
      if (taken === undefined) return;
      const active=taken;
      try {
        const outcome = await runWithToken(active.release,()=>compile(cells[active.cell]!, index));
        outcomes[taken.cell] = outcome;
        ended(cells[taken.cell]!, outcome);
      } catch (error) {
        failure ??= { error };
        stop.abort();
      } finally { await releaseToken(taken.release); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(lanes, cells.length) }, (_, index) => lane(index)));
  if (failure) throw failure.error;
  return outcomes;
}

/**
 * `--record` writes every case's row from a clean pin of main. `--check` holds
 * each recorded row and reports a case with no row yet as pending, without
 * measuring it. `--record-pending` is the full check's writer, after landing:
 * from a clean pin it measures every case, holds the recorded ones, and on a
 * clean comparison writes the pending rows and the accepted changes, every other line byte
 * for byte. Each mode compiles up to `--jobs` cells at once (inside a gate,
 * the step's workers, each holding a token), and its rows and comparisons are
 * the same at any width.
 */
export async function runBuildRecords(args = process.argv.slice(2)): Promise<number> {
  const mode = args.shift(); assert.ok(mode === "--record" || mode === "--check" || mode === "--record-pending", "usage: build-records.ts --record|--check|--record-pending [--backend c|llvm|jvm] [--jobs N] [--output directory] [case]");
  let backends: readonly Backend[] = BACKENDS, output = join(ROOT, "results/benchmarks"), only: string | undefined, jobs: number | undefined;
  while (args.length) {
    const flag = args.shift();
    if (flag === "--backend") { const value = args.shift(); assert.ok(BACKENDS.includes(value as Backend), "unknown benchmark backend"); backends = [value as Backend]; }
    else if (flag === "--output") { const value = args.shift(); assert.ok(value, "--output needs a directory"); output = resolve(value); }
    else if (flag === "--jobs") { const value = Number(args.shift()); assert.ok(Number.isSafeInteger(value) && value >= 1, "--jobs takes a whole number of at least 1"); jobs = value; }
    else { assert.ok(flag && !flag.startsWith("-") && !only && mode === "--check", `unknown benchmark argument: ${flag}`); only = flag; }
  }
  // How many compile at once: --jobs; else inside a gate, the step's workers,
  // each of which holds one of its tokens while it compiles; else the census's
  // width. Outside a gate no token is asked: the full check's records run is
  // at its low CPU weight, and its reservation gives way in the ledger.
  const width = jobs ?? (process.env.NTS_GATE_JOBS ? Number(process.env.NTS_GATE_JOBS) : DEFAULT_LANES);
  assert.ok(Number.isSafeInteger(width) && width >= 1, `the step's workers are a whole number of at least 1, not ${process.env.NTS_GATE_JOBS}`);
  const binary = resolve(process.env.NTS_BIN ?? join(ROOT, "target/release/nts"));
  assert.ok(existsSync(binary), `benchmark compiler missing: ${binary}; set NTS_BIN`);
  const compiler = hash(readFileSync(binary)), pin = provenanceOf(binary);
  let commit = execFileSync("git", gitArguments(["rev-parse", "HEAD"]), { cwd: ROOT, encoding: "utf8" }).trim();
  if (mode !== "--check") {
    assert.ok(pin?.clean && !pin.applied && /^[0-9a-f]{40}$/.test(pin.sha), `${mode} requires a clean, unpatched pin of main; build it with tooling/conformance/pin.ts`);
    assert.equal(pin.binary_sha256, compiler, `${mode} pin binary differs from its recorded bytes`);
    execFileSync("git", gitArguments(["merge-base", "--is-ancestor", pin.sha, "main"]), { cwd: ROOT, stdio: "pipe" }); commit = pin.sha;
  }
  const recordFile = (backend: Backend) => join(output, backend, "outcomes.tsv");
  const shown = (file: string) => { const local = relative(ROOT, file); return local.startsWith("..") || isAbsolute(local) ? file : local; };
  const base = process.env.TMPDIR ?? join(homedir(), ".cache/nts/benchmark-records"); mkdirSync(base, { recursive: true });
  const scratch = mkdtempSync(join(base, "compile-"));
  let reservation: Awaited<ReturnType<typeof reserveJob>> | undefined;
  try {
    // Every compile under COMPILE_CAP_BYTES, in the benches step as in the
    // records writer, whatever the step's own census cap: so a check
    // reproduces what was recorded, in a fresh tree as in a warm one.
    process.env.NTS_GATE_STEP_MEMORY_BYTES = String(COMPILE_CAP_BYTES);
    const environment = compileEnvironment(process.env, scratch, binary);
    const all = benchmarkCases(ROOT), paths = only ? all.filter(path => path === `benchmarks/cases/${only}`) : all;
    assert.ok(paths.length > 0, `unknown benchmark case: ${only}`);
    const identities = await benchmarkIdentities(ROOT, all, scratch), driver = compileKey(ROOT);
    // Each case's project, written once before any compile reads it: its
    // backends compile at once.
    const projects = new Map(paths.map(path => [path, projectFor(ROOT, path, scratch)]));
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
    const cell = (path: string, backend: Backend) => `${backend}\0${path}`;
    const cells: CompileCell[] = [], kept = new Map<string, BenchmarkRow>();
    for (const path of paths) for (const backend of backends) {
      // A case with no row yet is not measured at landing: the full check records it.
      if (mode === "--check" && pending.get(backend)!.has(path)) continue;
      // Nor is a recorded compile timeout. Compiling only, it cannot get worse,
      // and measuring it costs its whole bound on every check: ten such rows
      // held the full check's benches step past its own ceiling. The records
      // writer measures every case, so a timeout that improves is still written.
      const recorded = mode === "--check" ? records.get(backend)!.rows.find(row => row.path === path && row.scope === "compile") : undefined;
      if (recorded?.outcome.kind === "timeout") {
        kept.set(cell(path, backend), recorded);
        console.log(`${backend} ${path}: timeout, as recorded; a check does not measure it again`);
        continue;
      }
      cells.push({ path, backend });
    }
    // The longest compiles start first: every backend of a case whose compile
    // reached its CPU bound in some backend's record. Fed in path order, the
    // three compiles of the last such case started late and were the run's
    // whole tail.
    const slow = new Set([...records.values()].flatMap(record => record.rows.filter(row => row.scope === "compile" && row.outcome.kind === "timeout").map(row => row.path)));
    const order = [...cells.filter(one => slow.has(one.path)), ...cells.filter(one => !slow.has(one.path))];
    const lanes = Math.min(width, order.length), measured = new Map<string, BenchmarkOutcome>();
    if (lanes > 0) {
      // The compiles' memory, reserved once: the step's, inside one; alone,
      // what each lane held in this job's earlier runs, times the lanes.
      reservation = await reserveJob(recordsJob(lanes, `benchmark compile records (${mode}), ${lanes} at once`), { report: message => console.error(message) });
      const held = reservation;
      // Each compile on a lane of its own (worker-memory.ts), at
      // COMPILE_CAP_BYTES, under an aggregate that holds every lane's cap: a
      // compile meets no limit but its own, as it would alone.
      memoryRun(lanes * COMPILE_CAP_BYTES);
      const outcomes = await compileCells(order, lanes, (one, lane) => observeCompile({ backend: one.backend, project: projects.get(one.path)!, output: join(scratch, `output-${lane}`),
        binary, root: ROOT, env: environment }), { outranked: () => held.outranked(), ended: (one, outcome) => console.log(`${one.backend} ${one.path}: ${outcome.kind}`) });
      for (const [index, one] of order.entries()) measured.set(cell(one.path, one.backend), outcomes[index]!);
    }
    // The rows in the order one compile at a time keeps them, whatever order the compiles ended in.
    for (const path of paths) for (const backend of backends) {
      const recorded = kept.get(cell(path, backend)), outcome = measured.get(cell(path, backend));
      if (recorded) actual.get(backend)!.push(recorded);
      else if (outcome) actual.get(backend)!.push({ path, scope: "compile", source: identities.get(path)!, driver, outcome });
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
    try { await closeMemoryRun(); }
    finally { reservation?.release(); try { await reservation?.closed; } finally { rmSync(scratch, { recursive: true, force: true }); } }
  }
}

runAsCommand(import.meta.url,async()=>{
  try { process.exitCode = await runBuildRecords(); }
  catch (error) {
    console.error(`benchmark NOT MEASURED: ${error instanceof Error ? error.message : String(error)}`);
    if (!(error instanceof CommandNotMeasuredError)) publishToolingFailure(error instanceof ToolingInstrumentError ? error : new ToolingInstrumentError("tooling-setup", String(error)));
    process.exitCode = 124;
  }
});
