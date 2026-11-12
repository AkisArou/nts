import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import {fileURLToPath} from "node:url";
import {dataDirectory} from "./reader-inputs/main.ts";

const SOURCE=fileURLToPath(new URL("../..",import.meta.url));
const FIXTURES=relative(SOURCE,fileURLToPath(dataDirectory(new URL("../../tests/compile-time/",import.meta.url))));
const NODE_RUNTIME=relative(SOURCE,fileURLToPath(dataDirectory(new URL("../../runtime/node/",import.meta.url))));
const WEB_RUNTIME=relative(SOURCE,fileURLToPath(dataDirectory(new URL("../../runtime/web-platform/",import.meta.url))));

// Scope changes invalidate old baselines and kept listings. Inheritance covers
// the exec's threads and descendants; the runtime hir population has no child
// processes. CPU is perf's waited-command user+sys rusage in that same scope.
export const COUNTER_SCOPE = "exec-inherited-user-instructions-v1";
// Use upstream's single-threaded checker mode and documented Rayon setting.
export const COMPILE_CHECKERS = 1;
export const COMPILE_WORK_PROFILE = "upstream-single-threaded-v2:checkers=1;rayon=1";
export const COMPILE_WORK_SETTINGS = {checkers:1,single_threaded:true,rayon_num_threads:"1"} as const;
export function compileWorkSettings(env:NodeJS.ProcessEnv) {
  if(env.RAYON_NUM_THREADS!=="1")throw new Error("compile work profile requires RAYON_NUM_THREADS=1 in the measured environment");
  return {...COMPILE_WORK_SETTINGS,rayon_num_threads:env.RAYON_NUM_THREADS};
}
export function compileWorkProblem(row:{work_profile?:unknown;work_settings?:unknown}):string|null {
  if(row.work_profile!==COMPILE_WORK_PROFILE)return "incompatible compiler work profile";
  const settings=row.work_settings;
  if(!settings||typeof settings!=="object"||!("checkers" in settings)||settings.checkers!==1
    ||!("single_threaded" in settings)||settings.single_threaded!==true
    ||!("rayon_num_threads" in settings)||settings.rayon_num_threads!=="1")return "missing upstream single-threaded/Rayon measurement evidence";
  return null;
}

export type CompileArm = "nogc" | "rc";
/**
 * Each arm's record, from the root: the table the tripwire reads, and the
 * five-repeat evidence every row of it is proved from. Both live under
 * results/, where the full check's records commits may write.
 */
export const COMPILE_ARMS = {
  nogc: { table: "results/compile-times.tsv", calibration: "results/compile-counter-calibration.json" },
  rc: { table: "results/compile-times-rc.tsv", calibration: "results/compile-counter-rc-calibration.json" },
} as const;
export const ARMS = Object.keys(COMPILE_ARMS) as CompileArm[];

export function compileArm(args: readonly string[]): CompileArm {
  const at = args.indexOf("--arm");
  if (at < 0) return "nogc";
  const arm = args[at + 1];
  if (arm !== "nogc" && arm !== "rc") throw new Error("--arm requires nogc or rc");
  return arm;
}

export function compileCommand(arm: CompileArm, module: string): string[] {
  return ["hir", "--prepared", "--checkers", String(COMPILE_CHECKERS), ...(arm === "rc" ? ["--rc"] : []), module];
}

/** Compile-time tripwire projects are discovered from their checked-in configs. */
export function discoverCompileTimeFixtures(root: string): string[] {
  const base = join(root, FIXTURES);
  if (!existsSync(base)) return [];
  const pending = [base];
  const fixtures: string[] = [];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = readdirSync(directory, { withFileTypes: true });
    if (entries.some(entry => entry.isFile() && entry.name === "tsconfig.json")) {
      fixtures.push(relative(root, directory).split(sep).join("/"));
    }
    for (const entry of entries) {
      if (entry.isDirectory()) pending.push(join(directory, entry.name));
    }
  }
  return fixtures.sort();
}

/** Every module the tripwire measures in the tree at `root`: each runtime module with a config, and each compile-time fixture. */
export function compileTimeModules(root: string): string[] {
  const node = join(root, NODE_RUNTIME);
  return [
    ...(existsSync(node) ? readdirSync(node, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(node, entry.name, "tsconfig.json")))
      .map(entry => `${NODE_RUNTIME}/${entry.name}`) : []),
    ...(existsSync(join(root, WEB_RUNTIME,"tsconfig.json")) ? [WEB_RUNTIME] : []),
    ...discoverCompileTimeFixtures(root),
  ].sort();
}

export interface CounterRow {
  work_profile?: unknown;
  work_settings?: unknown;
  counter_scope?: unknown;
  instructions?: number | null;
  cpu_s?: number | null;
  counter_error?: string | null;
  error?: string | null;
  status?: number | null;
  signal?: string | null;
}

export function counterProblem(row: CounterRow): string | null {
  if (row.error || row.counter_error) return row.error || row.counter_error || null;
  if(row.work_profile!==undefined){const problem=compileWorkProblem(row);if(problem)return problem;}
  if (row.counter_scope !== COUNTER_SCOPE) return "incompatible counter scope (old attached counts are not measurements)";
  if (row.signal || (row.status !== undefined && row.status !== 0)) return `counter run ended ${row.signal ?? row.status}`;
  const { instructions, cpu_s } = row;
  if (typeof instructions !== "number" || !Number.isFinite(instructions) || instructions <= 0) return "no positive instruction count";
  if (typeof cpu_s !== "number" || !Number.isFinite(cpu_s) || cpu_s <= 0) return "no waited-command CPU measurement";
  // A deliberately broad floor, far below this corpus's billions/s. It rejects
  // the observed missed-worker reading (319,570 instructions / 92.90 CPU-s)
  // even though perf reported success and 100% counter running time.
  if (instructions / cpu_s < 1_000_000) return `implausible instruction count (${instructions} instructions / ${cpu_s.toFixed(6)} CPU-s)`;
  return null;
}

export function readCounterTable(text: string, arm: CompileArm = "nogc") {
  if (!text.split("\n").includes(`# counter-scope: ${COUNTER_SCOPE}`)) throw new Error("incompatible compile-times.tsv counter scope; record a fresh five-repeat baseline");
  if (!text.split("\n").includes(`# work-profile: ${COMPILE_WORK_PROFILE}`)) throw new Error("incompatible compiler work profile; record a fresh five-repeat baseline");
  // Unlabelled legacy tables were recorded only for NoGC. An RC table must
  // identify itself; neither arm may consume the other arm's baseline.
  const recordedArm = text.split("\n").find(line => line.startsWith("# arm: "))?.slice(7) ?? "nogc";
  if (recordedArm !== arm) throw new Error(`incompatible preparation arm: expected ${arm}, table records ${recordedArm}`);
  const rows = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [module, g] = line.split("\t");
    if (!module || !Number.isFinite(Number(g)) || !(Number(g) > 0)) throw new Error(`invalid baseline row: ${line}`);
    if (rows.has(module)) throw new Error(`duplicate baseline row: ${module}`);
    rows.set(module, Number(g));
  }
  const number = (name: string) => Number(text.split("\n").find(line => line.startsWith(`# ${name}: `))?.split(": ")[1]);
  const ratio = number("regression-ratio");
  if (!Number.isFinite(ratio) || ratio <= 1) throw new Error("missing or invalid calibrated relative threshold");
  if (text.includes("# regression-absolute-g:")) throw new Error("obsolete absolute-floor policy; record the relative-only baseline");
  return { rows, ratio };
}

export interface CalibrationRun extends CounterRow {
  arm?: CompileArm;
  module: string;
  repeat: number;
  listing_functions: number | null;
  listing_definitions: number;
  counter_file: string;
}
export interface CalibrationPolicy {
  ratio: number;
  observed_max_spread: number;
  spread_multiplier: number;
  relative_floor: number;
}
export interface CalibrationModule {
  module: string;
  runs: CalibrationRun[];
  valid?: boolean;
  median_instructions?: number | null;
  median_cpu_s?: number | null;
  spread?: number | null;
}
export interface Calibration {
  work_profile?: string;
  work_settings?: unknown;
  arm?: CompileArm;
  counter_scope: string;
  complete: boolean;
  nts_sha256: string;
  commit?: string;
  raw_directory?: string;
  tripwire_policy?: CalibrationPolicy;
  modules: CalibrationModule[];
}

/** Publish only a full five-repeat population. The baseline is the median;
 * the ratio clears four times the measured max/min spread, with a 10% floor,
 * rounded up to 5 percentage points. There is no absolute floor: small-module
 * blow-ups must also fail. Raw measurements stay with the policy in results/.
 */
export function calibratedTable(summary: Calibration, expected: string[]) {
  if (!summary.complete || summary.counter_scope !== COUNTER_SCOPE || compileWorkProblem(summary) || !/^[a-f0-9]{64}$/.test(summary.nts_sha256)) throw new Error("incomplete or incompatible calibration");
  const modules = [...summary.modules].sort((a, b) => a.module < b.module ? -1 : a.module > b.module ? 1 : 0);
  const arm = summary.arm ?? "nogc";
  if (arm !== "nogc" && arm !== "rc") throw new Error("invalid calibration preparation arm");
  if (JSON.stringify(modules.map(m => m.module)) !== JSON.stringify([...expected].sort())) throw new Error("calibration population differs from the current runtime modules");
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[2]!;
  let maxSpread = 0;
  const rows = modules.map(({ module, runs }) => {
    if (runs.length !== 5 || runs.some(r => r.module !== module || (r.arm ?? "nogc") !== arm || r.work_profile !== COMPILE_WORK_PROFILE || r.status !== 0 || counterProblem(r) !== null)
      || JSON.stringify(runs.map(r => r.repeat).sort()) !== "[1,2,3,4,5]"
      || runs.some(r => !Number.isInteger(r.listing_functions) || r.listing_functions! < 1 || r.listing_functions !== r.listing_definitions)
      || new Set(runs.map(r => r.listing_functions)).size !== 1) throw new Error(`incomplete five-repeat listing/count proof: ${module}`);
    const counts = runs.map(r => r.instructions!);
    maxSpread = Math.max(maxSpread, Math.max(...counts) / Math.min(...counts) - 1);
    return `${module}\t${(median(counts) / 1e9).toFixed(3)}\t${median(runs.map(r => r.cpu_s!)).toFixed(3)}`;
  });
  const ratio = 1 + Math.max(2, Math.ceil(80 * maxSpread)) / 20;
  const policy = { ratio, observed_max_spread: maxSpread, spread_multiplier: 4, relative_floor: 0.10 };
  const text = [`# counter-scope: ${COUNTER_SCOPE}`, `# work-profile: ${COMPILE_WORK_PROFILE}`, `# arm: ${arm}`, `# compiler-sha256: ${summary.nts_sha256}`,
    `# regression-ratio: ${ratio.toFixed(2)}`,
    `# Five-repeat medians; policy/evidence: ${COMPILE_ARMS[arm].calibration}`,
    `# Rerecord with node tooling/gate/compile-time.mjs --record --arm ${arm}; explain why.`,
    "# module\tG user instructions (all threads/descendants from exec)\tCPU s", ...rows, ""].join("\n");
  return { text, policy };
}

export interface CalibrationSource {
  commit: string;
  nts_sha256: string;
  raw_directory: string;
}
export interface RecordedModule extends CalibrationModule {
  valid: true;
  median_instructions: number;
  median_cpu_s: number;
  spread: number;
  source: CalibrationSource;
}
export interface RecordedCalibration extends Omit<Calibration, "nts_sha256" | "commit" | "raw_directory" | "modules"> {
  schema: 2;
  modules: RecordedModule[];
  tripwire_policy: CalibrationPolicy;
}

function calibrationSource(value: { commit?: string; nts_sha256: string; raw_directory?: string }): CalibrationSource {
  const { commit, nts_sha256, raw_directory } = value;
  if (typeof commit !== "string" || !/^[a-f0-9]{40}$/.test(commit)
    || !/^[a-f0-9]{64}$/.test(nts_sha256) || typeof raw_directory !== "string" || !isAbsolute(raw_directory)) {
    throw new Error("calibration lacks compiler/source provenance");
  }
  return { commit, nts_sha256, raw_directory };
}

function recordedModule(module: CalibrationModule, source: CalibrationSource): RecordedModule {
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[2]!;
  const counts = module.runs.map(run => run.instructions!);
  return { ...module, valid: true, median_instructions: median(counts),
    median_cpu_s: median(module.runs.map(run => run.cpu_s!)),
    spread: Math.max(...counts) / Math.min(...counts) - 1, source };
}

/** A publication records each row's source, including when all rows share it. */
export function calibrationRecord(summary: Calibration, expected: string[]) {
  const published = calibratedTable(summary, expected);
  const source = calibrationSource(summary);
  const record: RecordedCalibration = {
    schema: 2, arm: summary.arm ?? "nogc", work_profile: summary.work_profile,
    work_settings: summary.work_settings, counter_scope: summary.counter_scope,
    complete: true, modules: summary.modules.map(module => recordedModule(module, source)),
    tripwire_policy: published.policy,
  };
  return { ...published, record };
}

const byModule = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** A table's rows by module, each its exact line; the header lines are not rows. */
export function tableLines(text: string): Map<string, string> {
  return new Map(text.split("\n").filter(line => line && !line.startsWith("#")).map(line => [line.split("\t")[0]!, line]));
}

/** The table with these rows in: its header lines, then every row in its module's place, each other row as it was. */
export function withTableLines(text: string, rows: ReadonlyMap<string, string>): string {
  const merged = new Map([...tableLines(text), ...rows]);
  return [...text.split("\n").filter(line => line.startsWith("#")), ...[...merged.keys()].sort(byModule).map(module => merged.get(module)!), ""].join("\n");
}

/** A calibration record's module entries by module, each as one line of JSON. */
export function calibrationEntries(text: string): Map<string, string> {
  const record = JSON.parse(text) as { modules?: { module: string }[] };
  if (!Array.isArray(record.modules)) throw new Error("a calibration record lists no modules");
  return new Map(record.modules.map(entry => [entry.module, JSON.stringify(entry)]));
}

/** The record with these entries in, in module order, its policy's observed spread taken over every entry; the rest as it was. */
export function withCalibrationEntries(text: string, entries: ReadonlyMap<string, string>): string {
  const record = JSON.parse(text) as RecordedCalibration;
  const merged = new Map<string, RecordedModule>([...record.modules.map(entry => [entry.module, entry] as const),
    ...[...entries].map(([module, line]) => [module, JSON.parse(line) as RecordedModule] as const)]);
  const modules = [...merged.keys()].sort(byModule).map(module => merged.get(module)!);
  const tripwire_policy = { ...record.tripwire_policy, observed_max_spread: Math.max(...modules.map(module => module.spread)) };
  return `${JSON.stringify({ ...record, modules, tripwire_policy }, null, 2)}\n`;
}

/**
 * One module's calibration, published into its arm's record: its row
 * refreshed when the table has one, or added in its module's place when the
 * module is pending. Every other row and entry stays byte for byte, with its
 * own provenance, other pending modules stay pending, and the table's ratio
 * stays: repeats that would need a wider one are refused. Older rows are
 * already published, and each one's five-run proof must still reproduce its
 * exact row. A legacy single-compiler record acquires per-module provenance.
 */
export function withCalibratedModule(table: string, previous: Calibration | RecordedCalibration,
  summary: Calibration, expected: readonly string[], selected: string) {
  const arm = summary.arm ?? "nogc";
  const baseline = readCounterTable(table, arm);
  const recorded = [...baseline.rows.keys()].sort(byModule);
  const stale = recorded.filter(module => !expected.includes(module));
  if (stale.length) throw new Error(`the table has rows for modules the tree does not have: ${stale.join(", ")}`);
  if (JSON.stringify(previous.modules.map(module => module.module).sort(byModule)) !== JSON.stringify(recorded)) {
    throw new Error("baseline provenance population differs from the table");
  }
  if ((previous.arm ?? "nogc") !== arm || previous.tripwire_policy?.ratio !== baseline.ratio) {
    throw new Error("baseline provenance policy or arm differs from the table");
  }
  if (!expected.includes(selected)) throw new Error(`unknown compile-time module: ${selected}`);
  const fresh = calibrationRecord(summary, [selected]);
  if (fresh.policy.ratio > baseline.ratio) {
    throw new Error(`selected repeats require policy ${fresh.policy.ratio.toFixed(2)}, above existing ${baseline.ratio.toFixed(2)}; not published`);
  }
  const existing = "nts_sha256" in previous
    ? previous.modules.map(module => ({ ...module, source: calibrationSource(previous) })) : previous.modules;
  const old = existing.map(module => {
    const source = calibrationSource(module.source);
    const proof = calibratedTable({ ...previous, nts_sha256: source.nts_sha256, modules: [module] }, [module.module]);
    const row = proof.text.split("\n").find(line => line.startsWith(`${module.module}\t`));
    if (table.split("\n").find(line => line.startsWith(`${module.module}\t`)) !== row) {
      throw new Error(`published table differs from its five-repeat proof: ${module.module}`);
    }
    if (proof.policy.ratio > baseline.ratio) throw new Error(`published proof exceeds its policy: ${module.module}`);
    return recordedModule(module, source);
  });
  const modules = [...old.filter(module => module.module !== selected), fresh.record.modules[0]!]
    .sort((a, b) => byModule(a.module, b.module));
  const policy = { ...fresh.policy, ratio: baseline.ratio,
    observed_max_spread: Math.max(...modules.map(module => module.spread)) };
  const record: RecordedCalibration = { ...fresh.record, modules, tripwire_policy: policy };
  const row = fresh.text.split("\n").find(line => line.startsWith(`${selected}\t`))!;
  const text = withTableLines(table, new Map([[selected, row]])).split("\n").map(line => line.startsWith("# compiler-sha256:")
    ? `# compiler-provenance: per-module in ${COMPILE_ARMS[arm].calibration}` : line).join("\n");
  return { text, record, policy };
}
