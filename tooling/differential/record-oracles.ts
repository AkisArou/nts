// Explicit recording only. Plans come from the checker's actual population;
// a partial oracle can never publish a smaller promise.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
const executeFile = promisify(execFile);
import { fileURLToPath, pathToFileURL } from "node:url";

type Plan = { version: number; backend: string; source: string; source_digest: string; entry: string; seed: null;
  generator_version: number; generator_digest: string; case_key: string; case_count: number;
  cases: string[]; signature: unknown[]; driver: string; resolver: string };
type Row = { kind: "measured" | "no-oracle"; source: string; signature: string;
  keys: Record<string, string>; cases_sha256: string; driver_sha256: string;
  count?: number; complete?: true; node_cpu_s?: number[]; source_digest?: string; reason?: string };
type Table = { version: number; generator_version?: number; generator_digest?: string; seed?: null; rows: Row[] };
type Manifest = { version: number; plans: Plan[]; failures: { config: string; backend: string; error: string }[] };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
function atomic(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporary, path);
}
export function writeTable(path: string, table: Table) {
  const rows = [...table.rows].sort((a, b) => `${a.source}\0${a.signature}`.localeCompare(`${b.source}\0${b.signature}`, "en"));
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  const header = JSON.stringify({ version: 1, generator_version: table.generator_version, generator_digest: table.generator_digest, seed: table.seed });
  writeFileSync(temporary, header.slice(0, -1) + ',"rows":[\n' + rows.map(row => JSON.stringify({ ...row, keys: Object.fromEntries(Object.entries(row.keys).sort(([a], [b]) => a.localeCompare(b, "en"))) })).join(",\n") + "\n]}\n");
  renameSync(temporary, path);
}
function identity(plan: Plan) {
  return { source: plan.source, signature: digest(JSON.stringify([plan.signature, plan.cases])),
    keys: { [plan.backend]: plan.case_key }, cases_sha256: digest(JSON.stringify(plan.cases)),
    driver_sha256: digest(plan.driver + plan.resolver) };
}
export function completeRows(text: string, expected: number): string[] {
  const lines = text.trimEnd().split("\n");
  if (lines.pop() !== `done ${expected}` || lines.length !== expected) {
    throw new Error(`oracle not measured: expected all ${expected} rows and done`);
  }
  return lines;
}
export function addRecord(table: Table, plan: Plan, cpu: number[], delivered: number): Table {
  if (table.version !== 1 || plan.cases.length !== plan.case_count || plan.seed !== null || delivered !== plan.case_count) throw new Error("invalid recording schema");
  if (cpu.length !== 2 || cpu.some(n => !Number.isFinite(n) || n < 0 || n * 2 > 15)) throw new Error("CPU budget needs at least twice both measured runs");
  const previous = table.rows.filter(row => row.source === plan.source && row.keys[plan.backend]);
  if (previous.some(row => (row.count ?? 0) > plan.case_count)) throw new Error("refusing to lower recorded coverage; review the population change explicitly");
  const id = identity(plan), old = table.rows.find(row => row.source === id.source && row.signature === id.signature);
  if (old && old.driver_sha256 !== id.driver_sha256) throw new Error("driver changed for an existing signature; review the new recording explicitly");
  const row: Row = { kind: "measured", ...id, keys: { ...old?.keys, ...id.keys },
    count: delivered, complete: true, node_cpu_s: cpu };
  return { version: 1, generator_version: plan.generator_version, generator_digest: plan.generator_digest, seed: null, rows: [...table.rows.filter(old => !(old.source === row.source && old.signature === row.signature)), row] };
}
export function noOracleRecord(plan: Plan, reason: string): Row {
  if (plan.case_count !== 0 || plan.cases.length !== 0 || !plan.source_digest || !reason) throw new Error("no-oracle requires an explicit empty source identity and reason");
  return { kind: "no-oracle", ...identity(plan), source_digest: plan.source_digest, reason };
}
function addNoOracle(table: Table, plan: Plan, reason: string): Table {
  const row = noOracleRecord(plan, reason), old = table.rows.find(r => r.source === row.source && r.signature === row.signature);
  row.keys = { ...old?.keys, ...row.keys };
  return { version: 1, generator_version: plan.generator_version, generator_digest: plan.generator_digest, seed: null, rows: [...table.rows.filter(r => !(r.source === row.source && r.signature === row.signature)), row] };
}
function available() {
  const value = /^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync("/proc/meminfo", "utf8"));
  if (!value) throw new Error("cannot read MemAvailable");
  return Number(value[1]) * 1024;
}
async function admission() {
  while (available() < 14 * 2 ** 30) await new Promise(resolve => setTimeout(resolve, 1000));
}
async function planAll(binary: string, root: string, evidence: string, rc = false, only?: string) {
  mkdirSync(evidence, { recursive: true });
  const configs = readdirSync(join(root, "tests/programs"), { withFileTypes: true })
    .filter(e => e.isDirectory() && !["invalid", "unsupported"].includes(e.name))
    .map(e => join(root, "tests/programs", e.name, "tsconfig.json")).filter(existsSync);
  for (const name of readdirSync(join(root, "benchmarks/cases"))) {
    const dir = join(root, "benchmarks/cases", name);
    if (!existsSync(join(dir, "case.ts"))) continue;
    if (existsSync(join(dir, "tsconfig.json"))) configs.push(join(dir, "tsconfig.json"));
    else {
      const config = join(evidence, `bench-${name}.json`);
      atomic(config, { extends: join(root, "tsconfig.fixtures.json"), include: [join(dir, "case.ts")] });
      configs.push(config);
    }
  }
  if (only) {
    const selected = configs.filter(config => config === resolve(root, only));
    if (selected.length !== 1) throw new Error(`unknown project ${only}`);
    configs.splice(0, configs.length, ...selected);
  }
  const path = join(evidence, "plans.json");
  const manifest: Manifest & { completed?: { normal: number; rc: number }; binary_sha256?: string; config_list_digest?: string } = existsSync(path) ? json(path) : { version: 1, plans: [], failures: [] };
  const binaryHash = createHash("sha256").update(readFileSync(binary)).digest("hex");
  if (manifest.binary_sha256 && manifest.binary_sha256 !== binaryHash) throw new Error("plan compiler changed; use fresh evidence");
  manifest.binary_sha256 = binaryHash;
  const configHash = digest(JSON.stringify(configs.sort()));
  if (manifest.config_list_digest && manifest.config_list_digest !== configHash) throw new Error("project list changed; use fresh evidence");
  manifest.config_list_digest = configHash;
  manifest.completed ??= { normal: Math.floor((manifest.plans.length + manifest.failures.length) / 4), rc: 0 };
  const mode = rc ? "rc" : "normal";
  const backends = rc ? ["c", "llvm"] : ["c", "llvm", "jvm", "wasm"];
  const ordered = configs.sort();
  for (let at = manifest.completed[mode]; at < ordered.length; at++) {
    const config = ordered[at];
    // Two captures form one bounded phase. Each starts only above the same
    // memory floor, and backend order in the manifest stays deterministic.
    for (let first = 0; first < backends.length; first += 2) {
      const results = await Promise.all(backends.slice(first, first + 2).map(async backend => {
        await admission();
        try {
          const result = await executeFile(binary, [config], { cwd: root, env: { ...process.env, NTS_BACKEND: backend, NTS_CHECKERS: "1", NTS_RC: rc ? "1" : "0" }, maxBuffer: 64 * 2 ** 20 });
          return { backend, plan: JSON.parse(result.stdout) as Plan };
        } catch (error) {
          return { backend, error: String(error) };
        }
      }));
      for (const result of results) {
        if (result.plan) {
          const plan = result.plan;
          if (plan.version !== 1 || !plan.source || plan.cases.length !== plan.case_count) throw new Error(`invalid plan for ${config}`);
          manifest.plans.push(plan);
          console.log("plan", result.backend, plan.source, plan.case_count);
        } else {
          manifest.failures.push({ config, backend: result.backend, error: result.error! });
          console.log("plan unavailable", result.backend, config);
        }
      }
    }
    manifest.completed[mode] = at + 1;
    if ((at + 1) % 16 === 0 || at + 1 === ordered.length) atomic(path, manifest);
  }
}
async function measureDriver(plan: Plan, evidence: string, identity: string) {
  const cpu: number[] = [];
  let delivered = -1;
  const dir = join(evidence, identity);
  mkdirSync(dir, { recursive: true });
  const hook = join(dir, "resolve_ts.mjs");
  writeFileSync(hook, plan.resolver);
  const original = "function emit(line) { writeSync(resultsFd, line); }";
  if (!plan.driver.includes(original)) throw new Error("driver timing hook no longer matches");
  const driver = plan.driver.replace(original, 'const cpuFd = openSync(process.env.NTS_CPU_EVENTS,"w");\nfunction emit(line) { writeSync(resultsFd,line); const u=process.cpuUsage(); writeSync(cpuFd,JSON.stringify({line,cpu_us:u.user+u.system})+"\\n"); }');
  const script = join(dir, "driver.mjs");
  writeFileSync(script, driver);
  let baseline: string | undefined;
  for (const arm of [0, 1]) {
    await admission();
    const results = join(dir, `${arm}.results`), timings = join(dir, `${arm}.cpu.jsonl`);
    writeFileSync(results, "");
    const env: NodeJS.ProcessEnv = { ...process.env, NTS_DIFF_RESULTS: results, NTS_CPU_EVENTS: timings, NO_COLOR: "1" };
    delete env.FORCE_COLOR; delete env.CLICOLOR_FORCE;
    // timeout owns only its spawned child group. Recording never accepts a
    // guard's exit code, even if the results file already contains done.
    const run = spawnSync("taskset", ["-c", "4", "prlimit", "--as=2147483648", "--core=0", "--cpu=15:16", "timeout", "120", "node", "--experimental-transform-types", "--import", pathToFileURL(hook).href, script], { env, maxBuffer: 64 * 2 ** 20 });
    writeFileSync(join(dir, `${arm}.stdout`), run.stdout ?? "");
    writeFileSync(join(dir, `${arm}.stderr`), run.stderr ?? "");
    if (run.status !== 0 || run.error) throw new Error(`oracle not measured: ${plan.source}: ${run.error ?? run.signal ?? run.status}`);
    const text = readFileSync(results, "utf8");
    delivered = completeRows(text, plan.case_count).length;
    if (baseline !== undefined && baseline !== text) throw new Error(`unstable oracle: ${plan.source}`);
    baseline = text;
    const stamps = readFileSync(timings, "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
    cpu.push(stamps.at(-1).cpu_us / 1e6);
  }
  return { cpu, count: delivered };

}
async function recordAll(evidence: string, output: string) {
  if (process.env.NTS_BENCH_CPUS !== "4") throw new Error("record under tooling/gate/with-lock.sh --wait; measured children use CPU 4");
  const manifest = json(join(evidence, "plans.json")) as Manifest;
  let table: Table = existsSync(output) ? json(output) : { version: 1, rows: [] };
  const measured = new Map<string, { cpu: number[]; count: number }>();
  const failed = new Map<string, Error>();
  const exceptions = new Set<string>();
  const findings: { source: string; backend: string; driver_sha256: string; error: string }[] = [];
  for (const [at, plan] of manifest.plans.entries()) {
    const identity = digest(plan.driver + plan.resolver);
    const exception = table.rows.find(row => row.kind === "no-oracle" && row.source === plan.source && row.keys[plan.backend] === plan.case_key && row.source_digest === plan.source_digest && plan.case_count === 0);
    if (exception) { exceptions.add(identity); console.log("no-oracle", plan.source, exception.reason); continue; }
    let measurement = measured.get(identity);
    try {
      if (failed.has(identity)) throw failed.get(identity);
      if (measurement === undefined) {
        measurement = await measureDriver(plan, evidence, identity);
        measured.set(identity, measurement);
      }

      table = addRecord(table, plan, measurement.cpu, measurement.count);
      if ((at + 1) % 32 === 0) {
        writeTable(output, table);
      }
      console.log("recorded", plan.backend, plan.source, measurement.count, measurement.cpu);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      const message = failure.message;
      failed.set(identity, failure);
      findings.push({ source: plan.source, backend: plan.backend, driver_sha256: identity, error: message });
      console.log("NOT MEASURED", plan.backend, plan.source, message);
    }
  }

  writeTable(output, table);
  const summary = { complete_unique_drivers: measured.size, failed_unique_drivers: failed.size,
    recorded_populations: table.rows.filter(row => row.kind === "measured").length, no_oracle_unique_drivers: exceptions.size,
    worst_node_cpu_s_to_done: Math.max(0, ...[...measured.values()].flatMap(m => m.cpu)), findings,
    preparation_failures: manifest.failures };
  atomic(join(evidence, "measurement-summary.json"), summary);
  console.log(JSON.stringify(summary));
  if (findings.length || manifest.failures.length) throw new Error("recording incomplete; review every not-measured project before submitting");
}
async function main() {
  const [mode, first, second, third, fourth] = process.argv.slice(2);
  if (["plan", "plan-rc"].includes(mode) && first && second && third) await planAll(resolve(first), resolve(second), resolve(third), mode === "plan-rc", fourth?.replace(/^--only=/, ""));
  else if (mode === "no-oracle" && first && second && third && fourth) {
    const manifest = json(join(resolve(first), "plans.json")) as Manifest;
    const output = resolve(second), table: Table = existsSync(output) ? json(output) : { version: 1, rows: [] };
    const plans = manifest.plans.filter(plan => plan.source === third);
    if (!plans.length) throw new Error(`unknown fixture ${third}`);
    let updated = table;
    for (const plan of plans) updated = addNoOracle(updated, plan, fourth);
    writeTable(output, updated);
  }
  else if (mode === "record" && first && second) await recordAll(resolve(first), resolve(second));
  else throw new Error("usage: record-oracles.ts plan|plan-rc <oracle-plan binary> <fixture root> <evidence dir> [--only=<config>] | record <evidence dir> <count table> | no-oracle <evidence dir> <table> <source> <reason>");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
