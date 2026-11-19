import {runAsCommand} from "../differential/command-entry/main.ts";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { countDriver } from "./count-driver.ts";
import {activeCommand, COMPILE_CPU_BOUND_SECONDS} from "../gate/active-command.ts";
import {ToolingInstrumentError, publishToolingFailure} from "../gate/step-result.ts";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pinnedComparators, sha256, type Pins } from "./comparator-pins.ts";
import { typedTimer } from "./typed-timer.ts";
import { absent } from "./run-producers.ts";
import { COMPARATORS, SESSION_COLUMNS, type Cell, type Comparator, type Json } from "./run-record.ts";
import { buildLauncher, launchEnvironment, launchSitting, type Launcher } from "./launcher.ts";
import { gitArguments } from "../gate/git-arguments/main.ts";
import { requireSourceDigest } from "./source-identity.ts";
import { LAUNCH_COUNT, LAUNCH_KIND, LAUNCH_WARMUPS, launchCell, launchSummary } from "./launch-cell.ts";
import { reserveJob } from "../gate/memory-ledger.ts";
import { optionalFile } from "../gate/reader-inputs/main.ts";
// Bun consults this configuration in the repository cwd used below.
export const BUN_CONFIGURATION = optionalFile(new URL("../../bunfig.toml", import.meta.url));
type Receipt = {
  command: string[];
  cwd: string;
  startedAt: string;
  finishedAt: string;
  status: number | null;
  signal: string | null;
  timeout?: string;
  stdout: string;
  stderr: string;
  wallNanoseconds: number;
  cpu5: Json;
};
export type Hosts = { cells: Record<Comparator, Cell>; provenance: Json };
function cpu5(): number[] {
  const line = readFileSync("/proc/stat", "utf8")
    .split("\n")
    .find((l) => l.startsWith("cpu5 "));
  assert.ok(line, "missing sibling accounting");
  const values = line.trim().split(/\s+/).slice(1, 9).map(Number);
  assert.ok(values.length === 8 && values.every(Number.isSafeInteger));
  return values;
}
function delta(a: number[], b: number[]): Json {
  const ticks = b.map((v, i) => v - a[i]);
  assert.ok(ticks.every((v) => v >= 0));
  return { ticks, userTicks: ticks[0], niceTicks: ticks[1], clockTicksPerSecond: 100 };
}
function cpulist(value: string): Set<number> {
  assert.match(value, /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/);
  const set = new Set<number>();
  for (const part of value.split(",")) {
    const [a, b = a] = part.split("-").map(Number);
    assert.ok(b >= a && b - a < 1024);
    for (let i = a; i <= b; i++) set.add(i);
  }
  return set;
}
function affinity(timed: boolean): string {
  const allowed = /^Cpus_allowed_list:\s*(\S+)/m.exec(readFileSync("/proc/self/status", "utf8"));
  assert.ok(allowed, "missing inherited affinity");
  const inherited = cpulist(allowed[1]);
  if (timed && process.env.NTS_BENCH_CPUS) {
    const desired = cpulist(process.env.NTS_BENCH_CPUS);
    assert.deepEqual([...desired], [4], "official measurements require CPU 4");
    return "4";
  }
  const selected = [...inherited].filter((c) => c !== 4 && c !== 5);
  assert.ok(selected.length, "no unreserved inherited CPUs");
  return selected.join(",");
}
/** Untimed compiler and linker work uses the same per-process policy as native builds. */
export async function buildCommand(program: string, args: string[], cwd: string,
  extra: Record<string,string> = {}, supervise = activeCommand): Promise<Receipt> {
  const command = ["taskset", "-c", affinity(false), program, ...args];
  const startedAt = new Date().toISOString(), began = process.hrtime.bigint(), before = cpu5();
  const env = {...process.env, ...extra};
  delete env.NTS_BENCH_STARTUP;
  for (const key of Object.keys(env)) if (key.startsWith("NTS_BENCH_COUNT_")) delete env[key];
  const result = await supervise(command[0], command.slice(1), {cwd, env, eachProcessCpuSeconds: COMPILE_CPU_BOUND_SECONDS});
  if(result.error) {
    const error=new ToolingInstrumentError("tooling-setup", `benchmark build not measured: ${result.error.message}`);
    publishToolingFailure(error,env);throw error;
  }
  if(result.hung || result.runaway)
    throw new ToolingInstrumentError("tooling-setup", `benchmark build not measured: ${result.hung ?? result.runaway}`);
  return {command, cwd, startedAt, finishedAt: new Date().toISOString(), status: result.status,
    signal: result.signal, ...(result.timeout ? {timeout: result.timeout} : {}),
    stdout: result.stdout, stderr: result.stderr, wallNanoseconds: Number(process.hrtime.bigint()-began), cpu5: delta(before,cpu5())};
}
async function execute(
  program: string,
  args: string[],
  cwd: string,
  timed: boolean,
  extra: Record<string, string> = {},
): Promise<Receipt> {
  if (!timed) return buildCommand(program, args, cwd, extra);
  const command = [
    "timeout",
    "--kill-after=10s",
    "180s",
    "prlimit",
    "--cpu=120:125",
    "--core=0:0",
    "--",
    "taskset",
    "-c",
    affinity(timed),
    program,
    ...args,
  ];
  const startedAt = new Date().toISOString(),
    began = process.hrtime.bigint(),
    before = cpu5();
  let stdout = "",
    stderr = "";
  const env = { ...process.env };
  delete env.NTS_BENCH_STARTUP;
  for (const key of Object.keys(env)) if (key.startsWith("NTS_BENCH_COUNT_")) delete env[key];
  Object.assign(env, extra);
  const child = spawn(command[0], command.slice(1), {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (b) => (stdout += b));
  child.stderr.on("data", (b) => (stderr += b));
  return await new Promise((done, reject) => {
    child.on("error", reject);
    child.on("close", (status, signal) =>
      done({
        command,
        cwd,
        startedAt,
        finishedAt: new Date().toISOString(),
        status,
        signal,
        stdout,
        stderr,
        wallNanoseconds: Number(process.hrtime.bigint() - began),
        cpu5: delta(before, cpu5()),
      }),
    );
  });
}
export function parseMeasurement(
  receipt: Receipt,
  expected: string | null,
): { ns: number; checksum: string } | Cell {
  if (receipt.status !== 0)
    return absent(
      receipt.signal === "SIGXCPU"
        ? "OVER_BUDGET"
        : receipt.status === 124
          ? "TIMED_OUT"
          : "ABORTED",
      receipt.signal === "SIGXCPU"
        ? "Over 120 s CPU budget (SIGXCPU)"
        : receipt.stderr.trim() || "Comparator terminated",
      receipt,
    );
  const m = /^([0-9]+(?:\.[0-9]+)?)\s+([a-f0-9]{16})\s*$/.exec(receipt.stdout.trim());
  if (!m || !Number.isFinite(Number(m[1])) || Number(m[1]) <= 0)
    return absent("INVALID", "Comparator returned malformed timing/checksum output", receipt);
  if (expected !== null && m[2] !== expected)
    return absent("INVALID", "Checksum disagreement; no timing accepted", { ...receipt, expected });
  return { ns: Number(m[1]), checksum: m[2] };
}
/** Counted runs (--count): fixed work under perf's FIFO bracket, off the
 * measurement CPUs and without the lock. The bracket protocol is the common
 * drivers' own (bench.mjs), spawned here as the layouts adapters spawn it. */
const COUNTING = process.env.NTS_BENCH_COUNT === "1";
const COUNT_CPU = process.env.NTS_BENCH_COUNT_CPU ?? "";
const COUNT_OUT = process.env.NTS_BENCH_COUNT_OUT ?? "";
async function executeCounted(program:string,args:string[],cwd:string,label:string){
  assert.match(COUNT_CPU,/^\d+$/,"counted runs name their CPU");
  assert.ok(COUNT_OUT,"counted runs name their output directory");
  return countDriver({program,args,cwd,folder:join(COUNT_OUT,"count",label),cpu:Number(COUNT_CPU),env:process.env});
}
async function measure(
  program: string,
  args: string[],
  cwd: string,
  expected: string | null,
  build: Receipt | null,
  countedLabel = "host",
  cold: Cold | null = null,
): Promise<Cell> {
  if (COUNTING) {
    try {
      const { calibration, counted, instructions, brackets, instrument } = await executeCounted(program, args, cwd, countedLabel);
      const value = counted as { checksum: string; nsPerOp: number; n: number };
      if (expected !== null && value.checksum !== expected)
        return absent("INVALID", "Checksum disagreement; no count accepted", { calibration, counted: counted as unknown as Json, build: build as unknown as Json });
      return {
        status: "OK",
        nanoseconds: value.nsPerOp,
        spread: 1,
        checksum: value.checksum,
        verified: true,
        reason: null,
        instructions,
        counted_reps: value.n,
        details: { brackets: brackets as unknown as Json, build: build as unknown as Json, calibration, counted: counted as unknown as Json, instrument },
      };
    } catch (error) {
      return absent("INVALID", error instanceof Error ? error.message : String(error), { build: build as unknown as Json });
    }
  }
  const attempts: Receipt[] = [],
    numbers: { ns: number; checksum: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const receipt = await execute(program, args, cwd, true);
    attempts.push(receipt);
    const measured = parseMeasurement(receipt, expected ?? numbers[0]?.checksum ?? null);
    if ("status" in measured)
      return {
        ...measured,
        details: { attempts: attempts as unknown as Json, build: build as unknown as Json },
      };
    numbers.push(measured);
  }
  const times = numbers.map((v) => v.ns),
    nanoseconds = Math.min(...times),
    checksum = numbers[0].checksum;
  const startup = cold ? await coldStartup(cold, program, args, checksum, countedLabel) : null;
  return {
    status: "OK",
    nanoseconds,
    spread: Math.max(...times) / nanoseconds,
    checksum,
    verified: true,
    reason: null,
    details: {
      attempts: attempts as unknown as Json,
      build: build as unknown as Json,
      ...(startup ? { coldStartup: startup } : {}),
    },
  };
}
/** Where a throughput cell's cold-startup arm launches: the one launch timer, one launch, the row's cwd. */
export type Cold = { launcher: Launcher; directory: string; cwd: string };
/**
 * Process launch through the first completed workload, separate from warm
 * throughput: the same body once, before any warm-up, timed by the one
 * launch timer. Details only; it decides no verdict, and its protocol names
 * what it can be compared with (launch-cell.ts).
 */
export async function coldStartup(cold: Cold, program: string, args: string[], checksum: string, label: string): Promise<Json> {
  const directory = join(cold.directory, label);
  const environment = launchEnvironment(directory, { NTS_BENCH_STARTUP: "1" });
  const sitting = await launchSitting({ launcher: cold.launcher, ...launchCpu(), cwd: cold.cwd, environment,
    columns: [{ label, argv: [program, ...args] }], warmups: 0, launches: 1, out: join(directory, "sitting") });
  const column = sitting.columns[0]!, launch = column.details.launches[0]!;
  const printed = /^([0-9]+(?:\.[0-9]+)?)\s+([a-f0-9]{16})\s*$/.exec(column.stdout.trim());
  return {
    protocol: sitting.protocol,
    kind: "process launch through first completed workload, separate from warm throughput",
    wallNanoseconds: launch.wallNanoseconds,
    status: launch.timedOut ? "TIMED_OUT" : launch.status !== 0 ? "ABORTED" : printed?.[2] === checksum ? "OK" : "INVALID",
    launch: launch as unknown as Json,
    argv: [program, ...args],
    environmentSha256: sitting.environmentSha256,
    launcherSha256: sitting.launcherSha256,
  };
}
/**
 * The one CPU a launch sitting pins to, and the sibling whose ticks it
 * records: 4 and 5 under the measurement lock; else the first CPU a build may
 * use, with no sibling to watch.
 */
export function launchCpu(): { cpu: number; sibling: number | null } {
  const cpus = affinity(true);
  return cpus === "4" && process.env.NTS_BENCH_CPUS ? { cpu: 4, sibling: 5 } : { cpu: Number(cpus.split(",")[0]), sibling: null };
}
export function buildFailure(receipt: Receipt): Cell {
  return absent(
    receipt.timeout || receipt.status === 124
      ? "TIMED_OUT"
      : receipt.signal === "SIGXCPU"
        ? "OVER_BUDGET"
        : "BUILD_FAILED",
    receipt.timeout ? `timed out building: ${receipt.timeout}` : "Comparator build failed",
    receipt,
  );
}
/** Bun runs from the directory that owns its declared configuration, which is the repository. */
function bunCwd(root: string): string {
  const bunRoot = dirname(fileURLToPath(BUN_CONFIGURATION));
  assert.equal(resolve(root), bunRoot, "Bun's launch cwd must own its declared configuration");
  return bunRoot;
}
/** `bun build --compile --aot` of one entry: the executable, or the cell its failure is. */
async function buildBunAot(root: string, bun: string, entry: string, directory: string): Promise<{ binary: string; build: Receipt } | Cell> {
  const binary = join(directory, "bun-aot"),
    build = await execute(bun, ["build", "--compile", "--aot", entry, "--outfile", binary], bunCwd(root), false);
  return build.status === 0 && !build.timeout ? { binary, build } : buildFailure(build);
}
/** ScriptC's native build of one entry, Node islands off: the executable, or its refusal or failure. */
async function buildScriptC(root: string, scriptc: NonNullable<Pins["scriptc"]>, entry: string, directory: string): Promise<{ binary: string; build: Receipt } | Cell> {
  const wrapper = join(directory, "scriptc-entry.mjs");
  writeFileSync(wrapper, "import " + JSON.stringify(entry) + ";\n");
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        strictNullChecks: true,
        allowJs: true,
        checkJs: false,
        skipLibCheck: true,
        target: "ES2024",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        types: ["node"],
        typeRoots: [join(root, "node_modules/@types")],
        allowImportingTsExtensions: true,
        noEmit: true,
      },
      files: ["scriptc-entry.mjs"],
    }),
  );
  const binary = join(directory, "scriptc-native"),
    build = await execute(
      process.execPath,
      [scriptc.command, "build", wrapper, "--node-islands=off", "--optimization=release", "--target-cpu=native", "--print=diagnostics", "-o", binary],
      scriptc.root,
      false,
    );
  let report: { success?: boolean; diagnostics?: { category: string; code: string; message: string }[] } | null = null;
  try {
    report = JSON.parse(build.stdout);
  } catch {}
  if (build.status === 0 && !build.timeout && report?.success === true && !report.diagnostics?.some((d) => d.code === "SC8001"))
    return { binary, build };
  if (report?.success === false && report.diagnostics?.length && report.diagnostics.every((d) => d.category !== "environment" && d.category !== "internal"))
    return absent("REFUSED", report.diagnostics.map((d) => d.code + ": " + d.message).join("; "), { build: build as unknown as Json, report: report as unknown as Json });
  return buildFailure(build);
}
export async function hostColumns(
  root: string,
  name: string,
  sourceHarness: string,
  input: string[],
  out: string,
): Promise<Hosts> {
  // Building and running a case's host columns: inside a reservation (a
  // benchmark session's), that one; alone, what this job held before.
  await reserveJob({ key: "bench-host-columns", what: `benchmark host columns for ${name}` });
  const pins = pinnedComparators(root),
    directory = join(out, name + ".hosts");
  mkdirSync(directory, { recursive: true });
  const canonical = join(root, "benchmarks/common/bench.mjs"),
    timer = join(directory, "timer.ts");
  let projected = typedTimer(readFileSync(canonical, "utf8"));
  // The startup arm calls the same body once, before warmup/timing. No hook is inside a timed loop.
  projected = projected.replace(
    "export function measure(run: () => number): void {",
    'export function measure(run: () => number): void {\n  if (process.env.NTS_BENCH_STARTUP === "1") { const began = process.hrtime.bigint(); const value = run(); process.stdout.write(String(Math.max(1, Number(process.hrtime.bigint() - began))) + " " + checksumBits(value) + "\\n"); return; }',
  );
  writeFileSync(timer, projected);
  let source = readFileSync(sourceHarness, "utf8");
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)];
  for (const match of imports) {
    const target = resolve(dirname(sourceHarness), match[1]);
    source = source.replace(
      match[0],
      "from " + JSON.stringify(target === canonical ? timer : target),
    );
  }
  if (name === "elementwise")
    source = source.replace(
      "const xs = new Array(4096).fill(1);",
      "const xs: number[] = new Array<number>(4096).fill(1);",
    );
  assert.ok(source.includes(timer), "host driver does not use the shared timer");
  assert.ok(!source.includes("@scriptc/node"), "explicit ScriptC Node bridges are forbidden");
  const entry = join(directory, "entry.ts");
  writeFileSync(entry, source);
  const cells = Object.fromEntries(
    COMPARATORS.map((c) => [
      c,
      absent("NOT_PROVIDED", "Pinned comparator artifact is not installed"),
    ]),
  ) as Hosts["cells"];
  if (process.env.NTS_BENCH_LANES)
    for (const column of ["Bun JIT", "Bun AOT", "ScriptC"] as const)
      cells[column] = absent("NOT_RUN", "Filtered native run requests the node oracle only");
  const cold: Cold = { launcher: buildLauncher(join(directory, "launcher"), affinity(false)), directory: join(directory, "cold"), cwd: root };
  cells.node = await measure(process.execPath, [entry, ...input], root, null, null, `${name}-node`, cold);
  const expected = cells.node.status === "OK" ? cells.node.checksum : null;
  if (pins.bun && !process.env.NTS_BENCH_LANES) {
    cells["Bun JIT"] = await measure(pins.bun, [entry, ...input], root, expected, null, `${name}-bun-jit`, cold);
    const aot = await buildBunAot(root, pins.bun, entry, directory);
    cells["Bun AOT"] = "status" in aot ? aot : await measure(aot.binary, input, root, expected, aot.build, `${name}-bun-aot`, cold);
  }
  if (pins.scriptc && !process.env.NTS_BENCH_LANES) {
    const scriptc = await buildScriptC(root, pins.scriptc, entry, directory);
    cells.ScriptC = "status" in scriptc ? scriptc
      : await measure(scriptc.binary, pins.scriptc.argvPrefix ? [entry, ...input] : input, root, expected, scriptc.build, `${name}-scriptc`, cold);
  }
  const artifacts = [timer, entry, join(directory, "bun-aot"), join(directory, "scriptc-native")]
    .filter(existsSync)
    .map((path) => ({ path, sha256: sha256(path) }));
  return {
    cells,
    provenance: {
      pins: pins.declaration,
      artifacts,
      builds: pins.builds as unknown as Json,
      input,
      sourceHarness,
      timerContract: "opaque-bit-input-v1",
    },
  };
}
/** A launch row: every column's cells, the launcher's own floor in the same sitting, and what built them. */
export type LaunchRow = { kind: typeof LAUNCH_KIND; cells: Record<string, Cell>; floor: Json; provenance: Json };
const NTS_TARGETS = [{ column: "nts C", backend: "c" }, { column: "nts LLVM", backend: "llvm" }] as const;

/**
 * The executable `nts build` makes of a launch case for one backend: a
 * generated project whose config declares one `app.cli` product, built by the
 * same `nts` the run measures, so the row times what a user would ship
 * (tooling/bench/README.md, "Launch rows").
 */
async function buildNts(root: string, nts: { binary: string; sha256: string; version: string; sourceDigest: string }, entry: string, directory: string,
  backend: "c" | "llvm"): Promise<{ binary: string; recipe: Json } | Cell> {
  const project = join(directory, `nts-${backend}`);
  rmSync(project, { recursive: true, force: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "tsconfig.json"), JSON.stringify({ extends: join(root, "tsconfig.fixtures.json"), files: [entry] }));
  writeFileSync(join(project, "nts.config.ts"), [
    `import { defineConfig, app } from ${JSON.stringify(join(root, "tooling/config/src/index.ts"))};`,
    `export default defineConfig({ tsconfig: "./tsconfig.json", products: { program: app.cli({ entry: ${JSON.stringify(entry)}, backend: ${JSON.stringify(backend)} }) } });`,
    "",
  ].join("\n"));
  const output = join(project, "out"), command = ["build", join(project, "tsconfig.json"), "--out", output];
  const build = await execute(nts.binary, command, project, false, { NTS_NODE: process.execPath });
  const recipe = { tool: "nts build", backend, product: "app.cli", command: [nts.binary, ...command], ntsSha256: nts.sha256, ntsSourceDigest: nts.sourceDigest, ntsVersion: nts.version,
    config: readFileSync(join(project, "nts.config.ts"), "utf8") };
  if (build.status !== 0 || build.timeout) {
    const refusal = `${build.stderr}\n${build.stdout}`.split("\n").find((line) => /(?:declined:|\bNTS\d{4}\b|\bTS\d{4,}\b)/.test(line));
    return refusal && !build.timeout ? absent("REFUSED", refusal.trim(), { build: build as unknown as Json, recipe }) : { ...buildFailure(build), details: { build: build as unknown as Json, recipe } as Json };
  }
  const built = readdirSync(join(output, "program"), { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .map((entry) => join(output, "program", entry.name, "program")).filter(existsSync);
  if (built.length !== 1) throw new ToolingInstrumentError("tooling-setup", `nts build left ${built.length} executables for ${entry} on ${backend}`);
  return { binary: built[0]!, recipe: { ...recipe, build: build as unknown as Json, artifactSha256: sha256(built[0]!) } };
}

/**
 * The nts that builds launch rows: beside nts-bench, and built from exactly
 * the measured commit's sources under its roots (`nts version`'s source
 * digest, tooling/cli/source_identity.rs).
 */
export function ntsIdentity(binary: string, root: string, commit: string): { binary: string; sha256: string; version: string; sourceDigest: string } {
  if (!existsSync(binary)) throw new ToolingInstrumentError("tooling-setup", `launch rows build with ${binary}, which does not exist; build the workspace with cargo build --release`);
  const version = spawnSync(binary, ["version"], { encoding: "utf8" });
  if (version.status !== 0) throw new ToolingInstrumentError("tooling-setup", `${binary} version failed: ${version.stderr}`);
  const named = /^source digest ([0-9a-f]{64})$/m.exec(version.stdout)?.[1];
  if (!named) throw new ToolingInstrumentError("tooling-setup", `${binary} names no source digest; rebuild it with cargo build --release`);
  requireSourceDigest(root, commit, "nts", named, binary);
  return { binary, sha256: sha256(binary), version: version.stdout.trim(), sourceDigest: named };
}

/**
 * A launch case's row: nts C and LLVM as `nts build` makes them, node and
 * Bun JIT on the case itself, Bun AOT and ScriptC built from it, and
 * /bin/true as the launcher's floor, all timed in one rotating sitting by the
 * one launch timer under one environment and cwd. Columns that cannot run
 * keep their reason; nothing here is a verdict (run-producers.ts and
 * run-record.ts decide those).
 */
export async function launchColumns(root: string, name: string, out: string, ntsBinary: string): Promise<LaunchRow> {
  // The run measures the checkout's HEAD, which run-session.ts's begin holds clean.
  const commit = spawnSync("git", gitArguments(["rev-parse", "HEAD"]), { cwd: root, encoding: "utf8" }).stdout.trim();
  await reserveJob({ key: "bench-host-columns", what: `benchmark launch row for ${name}` });
  const pins = pinnedComparators(root), directory = join(out, name + ".launch");
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const entry = join(root, "benchmarks/cases", name, "case.ts");
  const nts = ntsIdentity(ntsBinary, root, commit);
  const cells: Record<string, Cell> = Object.fromEntries(SESSION_COLUMNS.map((column) => [column,
    column === "nts JVM" ? absent("NOT_RUN", "Startup rows measure native executables and the engines; the JVM's launch is not in this group")
      : column === "nts f64" ? absent("NOT_RUN", "The unspecialized control prices number specialization in throughput; a launch row has no such build")
      : column === "C++" || column === "Java" ? absent("NOT_PROVIDED", "No hand-written reference for a launch case")
        : absent("NOT_PROVIDED", "Pinned comparator artifact is not installed")]));
  const columns: { column: string; argv: string[]; extra: Record<string, Json> }[] = [];
  for (const { column, backend } of NTS_TARGETS) {
    const built = await buildNts(root, nts, entry, directory, backend);
    if ("status" in built) cells[column] = built;
    else columns.push({ column, argv: [built.binary], extra: { recipe: built.recipe } });
  }
  columns.push({ column: "node", argv: [process.execPath, entry], extra: { flags: [] } });
  if (pins.bun) {
    bunCwd(root);
    columns.push({ column: "Bun JIT", argv: [pins.bun, entry], extra: { flags: [] } });
    const aot = await buildBunAot(root, pins.bun, entry, directory);
    if ("status" in aot) cells["Bun AOT"] = aot;
    else columns.push({ column: "Bun AOT", argv: [aot.binary], extra: { build: aot.build as unknown as Json, artifactSha256: sha256(aot.binary) } });
  }
  if (pins.scriptc) {
    const scriptc = await buildScriptC(root, pins.scriptc, entry, directory);
    if ("status" in scriptc) cells.ScriptC = scriptc;
    else columns.push({ column: "ScriptC", argv: pins.scriptc.argvPrefix ? [scriptc.binary, entry] : [scriptc.binary],
      extra: { build: scriptc.build as unknown as Json, artifactSha256: sha256(scriptc.binary) } });
  }
  const floor = { column: "floor", argv: ["/bin/true"], extra: {} };
  const launcher = buildLauncher(join(directory, "launcher"), affinity(false));
  const environment = launchEnvironment(join(directory, "environment"));
  const sitting = await launchSitting({ launcher, ...launchCpu(), cwd: root, environment, warmups: LAUNCH_WARMUPS, launches: LAUNCH_COUNT,
    columns: [...columns, floor].map(({ column, argv }) => ({ label: column, argv })), out: join(directory, "sitting") });
  for (const [index, { column, argv, extra }] of columns.entries()) {
    const observed = sitting.columns[index]!;
    cells[column] = launchCell(observed.details, { ...extra, argv, cwd: root, stdout: observed.stdout }, observed.stderr);
  }
  const measuredFloor = sitting.columns.at(-1)!;
  return {
    kind: LAUNCH_KIND,
    cells,
    floor: { argv: floor.argv, ...launchSummary(measuredFloor.details.launches.map((launch) => launch.wallNanoseconds)),
      launch: measuredFloor.details as unknown as Json },
    provenance: { protocol: sitting.protocol, cwd: root, environment: sitting.environment, environmentSha256: sitting.environmentSha256,
      launcherSha256: sitting.launcherSha256, cpu: sitting.cpu, sibling: sitting.sibling, pins: pins.declaration, builds: pins.builds as unknown as Json, nts: { sha256: nts.sha256, version: nts.version, sourceDigest: nts.sourceDigest }, commit },
  };
}
runAsCommand(import.meta.url,async()=>{
  if (process.argv[2] === "--launch") {
    const [root, name, out, nts] = process.argv.slice(3);
    assert.ok(root && name && out && nts, "host-columns.ts --launch <root> <case> <output> <nts>");
    try { console.log(JSON.stringify(await launchColumns(root, name, out, nts))); }
    catch(error) {
      if(!(error instanceof ToolingInstrumentError))throw error;
      console.error(error.message);process.exitCode=2;
    }
    return;
  }
  const [root, name, harness, out, ...input] = process.argv.slice(2);
  assert.ok(
    root && name && harness && out,
    "host-columns.ts <root> <case> <harness> <output> [input]",
  );
  try { console.log(JSON.stringify(await hostColumns(root, name, harness, input, out))); }
  catch(error) {
    if(!(error instanceof ToolingInstrumentError))throw error;
    console.error(error.message);process.exitCode=2;
  }
});
