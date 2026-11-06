/** Compile-only benchmark observations. This command never executes a workload. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as poll } from "node:timers/promises";
import { compileSync, memoryRun } from "../census/worker-memory.ts";
import type { Backend } from "../census/typescript-record.ts";
import { compilerExternalStop, compilerStop, compilerStopped, stableBuildDiagnostic } from "../conformance/observation-text.ts";
import { provenanceOf } from "../conformance/pin.ts";
import { Admission } from "../gate/admission.ts";
import { gateEnvironment, ENVIRONMENT_CONTEXT } from "../gate/canonical-environment.ts";
import { withToken } from "../gate/tokens.mjs";
import { CommandNotMeasuredError, type ActiveResult } from "../gate/active-command.ts";
import { ToolingInstrumentError, publishToolingFailure } from "../gate/step-result.ts";
import { assertBenchmarkInventory, benchmarkKey, compareBenchmarkOutcome, parseBenchmarkRecord, requireBenchmarkScopes,
  serializeBenchmarkRecord, type BenchmarkOutcome, type BenchmarkRecord, type BenchmarkRow } from "./outcomes.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BACKENDS = ["c", "llvm", "jvm"] as const;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
type Result = ActiveResult & { memoryKilled?: boolean };
type Command = (binary: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<Result>;

export function compileEnvironment(launcher: NodeJS.ProcessEnv, scratch: string, binary: string): NodeJS.ProcessEnv {
  const run = launcher[ENVIRONMENT_CONTEXT] ? launcher.NTS_GATE_RUN_DIR : scratch;
  assert.ok(run, "benchmark canonical handoff is missing its owned run directory");
  return gateEnvironment(launcher, { run, owned: { NTS_BIN: binary, NTS_CHECKERS: "1" } }).env;
}

/** A process stop is never an expected compiler defect, including an OOM SIGKILL. */
export function compileOutcome(result: Result, stage: "emit" | "link"): BenchmarkOutcome | null {
  // LLVM and C can emit arbitrary program strings on stdout. Only stderr is
  // a diagnostic channel on success; a failed command may use either channel.
  const diagnostic = result.stderr.trim() || (result.status === 0 ? "" : result.stdout.trim());
  if (result.error || result.memoryKilled || result.hung || result.runaway ||
    /toolchain did not survive|out of memory|memory limit|INSTRUMENT FAILURE|NOT MEASURED|disk quota exceeded|no space left on device|\b(?:EDQUOT|ENOSPC)\b/i.test(diagnostic)) {
    throw new ToolingInstrumentError("tooling-setup", `benchmark NOT MEASURED: ${result.error?.message ?? result.signal ?? result.hung ?? result.runaway ?? (result.out.trim() || `exit ${result.status}`)}`);
  }
  const stop = compilerStop(result.out, result.status, result.signal);
  if (stage === "emit" && compilerStopped(result.status, result.signal)) return { kind: "build-failure", stage: "compiler-crash", diagnostic: stop };
  if (compilerExternalStop(result.status, result.signal) || (stage === "link" && compilerStopped(result.status, result.signal)) || result.status === null || result.status === 126 || result.status === 127) {
    throw new ToolingInstrumentError("tooling-setup", `benchmark ${stage === "link" ? "link tool" : "compiler"} NOT MEASURED: ${stop}`);
  }
  if (stage === "emit" && !/panicked|internal compiler error/i.test(diagnostic)) {
    const refusal = diagnostic.split("\n").find(line => /(?:declined:|\bNTS\d{4}\b|\bTS\d{4,}\b)/.test(line));
    if (refusal) return { kind: "refused", diagnostic: stableBuildDiagnostic(refusal) };
  }
  if (result.status === 0) return null;
  assert.ok(diagnostic, "benchmark NOT MEASURED: failed command supplied no diagnostic");
  return { kind: "build-failure", stage: stage === "emit" && /panicked|internal compiler error/i.test(diagnostic) ? "compiler-crash" : stage,
    diagnostic: stableBuildDiagnostic(diagnostic) };
}

function commandLine(value: string): [string, ...string[]] {
  // CC is a whitespace-separated command, as in benches.sh (e.g. ccache clang).
  const parts = value.trim().split(/\s+/); assert.ok(parts[0], "empty benchmark build tool");
  return parts as [string, ...string[]];
}
function regularFiles(directory: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `benchmark identity rejects symlink: ${path}`);
    if (entry.isDirectory()) result.push(...regularFiles(path));
    else { assert.ok(entry.isFile(), `benchmark identity requires a regular file: ${path}`); result.push(path); }
  }
  return result.sort();
}

export async function observeCompile({ backend, project, output, binary, root, env, command = async (binary, args, options) => {
  const began = performance.now();
  const result = compileSync({ memoryCapKb: Number(process.env.NTS_GATE_STEP_MEMORY_BYTES ?? 6_000_000 * 1024) / 1024 }, binary, args,
    { ...options, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return { ...result, stdout: result.stdout ?? "", stderr: result.stderr ?? "", out: `${result.stdout ?? ""}${result.stderr ?? ""}`, elapsedMs: performance.now() - began };
} }:
  { backend: Backend; project: string; output: string; binary: string; root: string; env: NodeJS.ProcessEnv; command?: Command }): Promise<BenchmarkOutcome> {
  rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true });
  const options = { cwd: root, env: { ...env, NTS_CHECKERS: "1" } };
  const emitted = await command(binary, [`emit-${backend}`, project, ...(backend === "llvm" ? ["--rc"] : ["--out", output, ...(backend === "c" ? ["--rc"] : [])])], options);
  const refusal = compileOutcome(emitted, "emit"); if (refusal) return refusal;
  if (backend === "jvm") {
    return regularFiles(output).some(path => path.endsWith(".class")) ? { kind: "pass" }
      : { kind: "build-failure", stage: "emit", diagnostic: "emit-jvm produced no class files" };
  }
  const [tool, ...prefix] = commandLine(backend === "c" ? env.CC ?? "clang" : env.NTS_LLVM_CC ?? "clang");
  const program = join(output, backend === "c" ? "program.c" : "program.ll");
  if (backend === "llvm") writeFileSync(program, emitted.stdout);
  if (!existsSync(program) || lstatSync(program).size === 0) return { kind: "build-failure", stage: "emit", diagnostic: `emit-${backend} produced no program` };
  const flags = backend === "c" ? ["-O2", "-Wall", "-Wextra", "-Werror", "-std=c11", "-DNTS_PROVIDER_RC", `-I${output}`]
    : ["-x", "ir", "-w", "-O2"];
  const built = await command(tool, [...prefix, ...flags, "-c", "-o", "/dev/null", program], options);
  return compileOutcome(built, "link") ?? { kind: "pass" };
}

export function checkCompileRecord(record: BenchmarkRecord, actual: BenchmarkRow[]): string[] {
  requireBenchmarkScopes(record, ["compile"]);
  const expected = record.rows.filter(row => row.scope === "compile");
  assertBenchmarkInventory({ ...record, rows: expected }, actual);
  const byKey = new Map(expected.map(row => [benchmarkKey(row), row]));
  return actual.flatMap(row => {
    const before = byKey.get(benchmarkKey(row))!;
    const change = compareBenchmarkOutcome(before.outcome, row.outcome);
    return change.ok ? [] : [`${change.word} ${row.path}: ${JSON.stringify(before.outcome)} -> ${JSON.stringify(row.outcome)}; re-record this outcome`];
  });
}

function cases(root: string): string[] {
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
        const inputs = new Set([...sources, ...program.getConfigFileNames(), ...regularFiles(join(root, path))]);
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

function projectFor(root: string, path: string, scratch: string): string {
  const own = join(root, path, "tsconfig.json"); if (existsSync(own)) return own;
  const config = join(scratch, `${basename(path)}.tsconfig.json`);
  // Keep the compile gate's whole-directory roots. The scalar consumer's
  // case.ts-only project is a distinct scope and cannot narrow this one.
  writeFileSync(config, JSON.stringify({ extends: join(root, "tsconfig.fixtures.json"), include: [join(root, path) + "/"] }));
  return config;
}
function driverIdentity(root: string): string {
  return hash(JSON.stringify(["tooling/bench/build-records.ts", "tooling/bench/outcomes.ts", "tooling/census/line-record.ts", "tooling/conformance/observation-text.ts",
    "tooling/conformance/outcome-transition.ts", "pnpm-lock.yaml"].map(path => [path, hash(readFileSync(join(root, path)))])));
}
function publish(file: string, contents: string): void {
  mkdirSync(dirname(file), { recursive: true }); const temporary = `${file}.partial-${randomUUID()}`;
  try { writeFileSync(temporary, contents, { flag: "wx" }); renameSync(temporary, file); }
  finally { rmSync(temporary, { force: true }); }
}

export async function runBuildRecords(args = process.argv.slice(2)): Promise<number> {
  const mode = args.shift(); assert.ok(mode === "--record" || mode === "--check", "usage: build-records.ts --record|--check [--backend c|llvm|jvm] [--output directory] [case]");
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
  if (mode === "--record") {
    assert.ok(pin?.clean && !pin.applied && /^[0-9a-f]{40}$/.test(pin.sha), "--record requires a clean, unpatched pin of main; build it with tooling/conformance/pin.ts");
    assert.equal(pin.binary_sha256, compiler, "--record pin binary differs from its recorded bytes");
    execFileSync("git", ["merge-base", "--is-ancestor", pin.sha, "main"], { cwd: ROOT, stdio: "pipe" }); commit = pin.sha;
  }
  const base = process.env.TMPDIR ?? join(homedir(), ".cache/nts/benchmark-records"); mkdirSync(base, { recursive: true });
  const scratch = mkdtempSync(join(base, "compile-"));
  let resident = false;
  try {
    const environment = compileEnvironment(process.env, scratch, binary);
    const all = cases(ROOT), paths = only ? all.filter(path => path === `benchmarks/cases/${only}`) : all;
    assert.ok(paths.length > 0, `unknown benchmark case: ${only}`);
    const identities = await benchmarkIdentities(ROOT, all, scratch), driver = driverIdentity(ROOT);
    const records = new Map<Backend, BenchmarkRecord>(), actual = new Map<Backend, BenchmarkRow[]>();
    for (const backend of backends) {
      if (mode === "--check") {
        const file = join(output, backend, "outcomes.tsv");
        assert.ok(existsSync(file), `no benchmark compile record: ${file}; run build-records.ts --record on main's official pin`);
        const record = parseBenchmarkRecord(readFileSync(file, "utf8")); assert.equal(record.metadata.backend, backend, "foreign benchmark backend");
        requireBenchmarkScopes(record, ["compile"]);
        assertBenchmarkInventory({ ...record, rows: record.rows.filter(row => row.scope === "compile") }, all.map(path => ({ path, scope: "compile", source: identities.get(path)!, driver })));
        records.set(backend, record);
      }
      actual.set(backend, []);
    }
    const admission = new Admission({ report: message => console.error(message) });
    for (const path of paths) for (const backend of backends) {
      // The standalone recorder has no resident worker keeping it alive.
      // Keep this admission wait referenced, as the calibration recorder does.
      while (!admission.open()) await poll(2000);
      resident = true;
      const outcome = await withToken(() => observeCompile({ backend, project: projectFor(ROOT, path, scratch), output: join(scratch, "output"), binary, root: ROOT, env: environment }), { project: path, backend });
      actual.get(backend)!.push({ path, scope: "compile", source: identities.get(path)!, driver, outcome });
      console.log(`${backend} ${path}: ${outcome.kind}`);
    }
    assert.equal(hash(readFileSync(binary)), compiler, "compiler bytes changed during recording");
    assert.equal(driverIdentity(ROOT), driver, "benchmark driver changed during recording");
    assert.deepEqual(await benchmarkIdentities(ROOT, all, scratch), identities, "benchmark sources changed during recording");
    let changed = 0;
    for (const backend of backends) {
      const rows = actual.get(backend)!;
      if (mode === "--record") {
        const contents = serializeBenchmarkRecord({ metadata: { version: 1, backend, commit, compiler: compiler.slice(0, 16), harness: driver.slice(0, 16), under: "benchmarks/cases", scopes: ["compile"] }, rows });
        publish(join(output, backend, "outcomes.tsv"), contents);
      } else {
        const record = records.get(backend)!;
        const failures = checkCompileRecord({ ...record, rows: record.rows.filter(row => paths.includes(row.path)) }, rows);
        for (const message of failures) console.log(`${backend} ${message}`); changed += failures.length;
      }
    }
    console.log(`${paths.length} benchmark cases, ${backends.length} backends, compile-only coverage; ${changed} changed outcomes`);
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
