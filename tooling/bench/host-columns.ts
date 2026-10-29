import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pinnedComparators, sha256 } from "./comparator-pins.ts";
import { typedTimer } from "./typed-timer.ts";
import { absent } from "./run-producers.ts";
import { COMPARATORS, type Cell, type Comparator, type Json } from "./run-record.ts";
type Receipt = {
  command: string[];
  cwd: string;
  startedAt: string;
  finishedAt: string;
  status: number | null;
  signal: string | null;
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
async function admission(): Promise<void> {
  while (
    Number(/^MemAvailable:\s+(\d+)/m.exec(readFileSync("/proc/meminfo", "utf8"))?.[1]) * 1024 <
    14 * 1024 ** 3
  )
    await new Promise((r) => setTimeout(r, 2000));
}
async function execute(
  program: string,
  args: string[],
  cwd: string,
  timed: boolean,
  extra: Record<string, string> = {},
): Promise<Receipt> {
  if (!timed) await admission();
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
async function measure(
  program: string,
  args: string[],
  cwd: string,
  expected: string | null,
  build: Receipt | null,
): Promise<Cell> {
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
  const cold = await execute(program, args, cwd, true, { NTS_BENCH_STARTUP: "1" });
  const checked = parseMeasurement(cold, checksum);
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
      coldStartup: {
        kind: "process launch through first completed workload, separate from warm throughput",
        wallNanoseconds: cold.wallNanoseconds,
        status: "status" in checked ? checked.status : "OK",
        receipt: cold as unknown as Json,
      },
    },
  };
}
function buildFailure(receipt: Receipt): Cell {
  return absent(
    receipt.status === 124
      ? "TIMED_OUT"
      : receipt.signal === "SIGXCPU"
        ? "OVER_BUDGET"
        : "BUILD_FAILED",
    "Comparator build failed",
    receipt,
  );
}
export async function hostColumns(
  root: string,
  name: string,
  sourceHarness: string,
  input: string[],
  out: string,
): Promise<Hosts> {
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
  cells.node = await measure(process.execPath, [entry, ...input], root, null, null);
  const expected = cells.node.status === "OK" ? cells.node.checksum : null;
  if (pins.bun && !process.env.NTS_BENCH_LANES) {
    cells["Bun JIT"] = await measure(pins.bun, [entry, ...input], root, expected, null);
    const binary = join(directory, "bun-aot"),
      build = await execute(
        pins.bun,
        ["build", "--compile", "--aot", entry, "--outfile", binary],
        root,
        false,
      );
    cells["Bun AOT"] =
      build.status === 0
        ? await measure(binary, input, root, expected, build)
        : buildFailure(build);
  }
  if (pins.scriptc && !process.env.NTS_BENCH_LANES) {
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
        [
          pins.scriptc.command,
          "build",
          wrapper,
          "--node-islands=off",
          "--optimization=release",
          "--target-cpu=native",
          "--print=diagnostics",
          "-o",
          binary,
        ],
        pins.scriptc.root,
        false,
      );
    let report: {
      success?: boolean;
      diagnostics?: { category: string; code: string; message: string }[];
    } | null = null;
    try {
      report = JSON.parse(build.stdout);
    } catch {}
    if (
      build.status === 0 &&
      report?.success === true &&
      !report.diagnostics?.some((d) => d.code === "SC8001")
    )
      cells.ScriptC = await measure(
        binary,
        pins.scriptc.argvPrefix ? [entry, ...input] : input,
        root,
        expected,
        build,
      );
    else if (
      report?.success === false &&
      report.diagnostics?.length &&
      report.diagnostics.every((d) => d.category !== "environment" && d.category !== "internal")
    )
      cells.ScriptC = absent(
        "REFUSED",
        report.diagnostics.map((d) => d.code + ": " + d.message).join("; "),
        { build: build as unknown as Json, report: report as unknown as Json },
      );
    else cells.ScriptC = buildFailure(build);
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
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, name, harness, out, ...input] = process.argv.slice(2);
  assert.ok(
    root && name && harness && out,
    "host-columns.ts <root> <case> <harness> <output> [input]",
  );
  console.log(JSON.stringify(await hostColumns(root, name, harness, input, out)));
}
