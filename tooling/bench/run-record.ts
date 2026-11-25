import { approvedRecordMigration } from "./record-migrations.ts";
import {gitArguments} from "../gate/git-arguments/main.ts";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  realpathSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  linkSync,
  unlinkSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { readBenchmarkGroups, type BenchmarkGroup } from "./groups.ts";
import { coverage, coverageHeader, type OwnBestCoverage } from "./own-best-coverage.ts";
import { OWN_BEST_REGRESSION } from './own-best-marker.ts';
import {readBuildDetails,describeBuilds,type BuildDetails} from './build-details.ts';
import { EXECUTABLE_SIZE_KIND, checkExecutableSizeCell, readExecutableSize, sizeRecipeIdentity, stripIdentity, type ExecutableSize } from "./executable-size-cell.ts";
import { LAUNCH_KIND, checkLaunchCell, launchSummary, readLaunch } from "./launch-cell.ts";
import { GROWTHS, PEAK_RSS_KIND, checkPeakRssCell, peakRssGrowth, type Growth, type PeakRss, type Sized } from "./peak-rss-cell.ts";

export const COMPARATORS = ["node", "Bun JIT", "Bun AOT", "ScriptC"] as const;
export const BACKENDS = ["nts C", "nts LLVM", "nts JVM"] as const;
export type Backend = (typeof BACKENDS)[number];
/** The references each backend comes as close to as it can: C++ for native code, Java for the JVM. */
export const REFERENCES = ["C++", "Java"] as const;
export type Reference = (typeof REFERENCES)[number];
export const COLUMNS = [...BACKENDS, ...REFERENCES, ...COMPARATORS] as const;
/** What an nts-bench session records: the standing columns and the unspecialized control. */
export const SESSION_COLUMNS = [...COLUMNS, "nts f64"] as const;
export const POLICY = { version: 1, authority: "docs/README.md#the-bar" } as const;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Comparator = (typeof COMPARATORS)[number];
export type Cell = {
  status:
    | "OK"
    | "REFUSED"
    | "ABORTED"
    | "OVER_BUDGET"
    | "INVALID"
    | "NOT_RUN"
    | "NOT_PROVIDED"
    | "TIMED_OUT"
    | "BUILD_FAILED";
  nanoseconds: number | null;
  spread: number | null;
  checksum: string | null;
  verified: boolean;
  reason: string | null;
  details: Json;
  /** Counted runs only (--count): user instructions inside the bracket. */
  instructions?: number | null;
  /** Counted runs only (--count): the fixed repetitions that bracket counted. */
  counted_reps?: number | null;
  /** Peak-RSS rows only: the peak resident set of the same launches that time the cell (peak-rss-cell.ts); null without a time. */
  peakRss?: PeakRss | null;
  executableSize?: ExecutableSize | null;
};
export type Verdict = {
  /** SUSPECT: a peak-RSS comparison where either column has not shown its work grows with its input. */
  kind: "WON" | "SHORT" | "TIE" | "LOSS" | "UNAVAILABLE" | "NOT_COMPARABLE" | "SUSPECT";
  ratio: number | null;
  tolerance: number | null;
};
export type Row = {
  name: string;
  /**
   * Absent on throughput rows; "launch" when every cell is a launch-to-exit
   * observation (launch-cell.ts); "peak-rss" when every cell is one ranked by
   * its launches' peak resident set (peak-rss-cell.ts).
   */
  kind?: typeof LAUNCH_KIND | typeof PEAK_RSS_KIND | typeof EXECUTABLE_SIZE_KIND;
  /** Transient report/history projection; persisted size rows rank shipped bytes. */
  sizeView?: "stripped";
  strippedVerdicts?: Row["verdicts"];
  /** Peak-RSS rows only: the case workload the row calls once, and its input. */
  sized?: Sized;
  /** Peak-RSS rows only: each column's growth across its case's rows in this run, derived like the verdicts. */
  growth?: Record<string, Growth>;
  workloadIdentity: string | null;
  eligibleForBest: boolean;
  conditions: Json;
  cells: Record<string, Cell>;
  verdicts: Record<Backend, Record<Comparator, Verdict>>;
  builds?:BuildDetails;
};
export type Build = {
  version: string | null;
  commit: string | null;
  sha256: string | null;
  command: string[];
};
export type RunRecord = {
  schemaVersion: 1;
  purpose?: "sitting";
  id: string;
  startedAt: string | null;
  finishedAt: string | null;
  complete: boolean;
  inventory: string[];
  columns: string[];
  sourceCommit: string;
  compiler: { commit: string | null; sha256: string | null };
  harness: { identity: string; contract: string | null; files: { path: string; sha256: string }[] };
  machine: { identity: string | null; conditions: Json };
  comparators: Record<Comparator, Build | null>;
  verdictPolicy: typeof POLICY;
  provenance: Json;
  rows: Row[];
};
type Obj = Record<string, unknown>;
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function obj(value: unknown, keys: readonly string[], at: string): Obj {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value),
    at + ": expected object",
  );
  const result = value as Obj;
  check(
    Object.keys(result).length === keys.length && keys.every((k) => Object.hasOwn(result, k)),
    at + ": missing or unknown field",
  );
  return result;
}
function text(value: unknown, at: string): string {
  check(typeof value === "string" && value.length > 0, at + ": expected nonempty string");
  return value;
}
function nullableText(value: unknown, at: string): string | null {
  return value === null ? null : text(value, at);
}
function bool(value: unknown, at: string): boolean {
  check(typeof value === "boolean", at + ": expected boolean");
  return value;
}
function finite(value: unknown, at: string, minimum = 0): number {
  check(
    typeof value === "number" && Number.isFinite(value) && value >= minimum,
    at + ": invalid number",
  );
  return value;
}
function list(value: unknown, at: string): unknown[] {
  check(Array.isArray(value), at + ": expected array");
  return value;
}
function strings(value: unknown, at: string): string[] {
  const v = list(value, at).map((x) => text(x, at));
  check(new Set(v).size === v.length, at + ": duplicate entry");
  return v;
}
function json(value: unknown, at: string): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return finite(value, at, -Number.MAX_VALUE);
  if (Array.isArray(value)) return value.map((x) => json(x, at));
  check(typeof value === "object", at + ": not JSON");
  return Object.fromEntries(
    Object.entries(value as Obj).map(([k, v]) => [k, json(v, at + "." + k)]),
  );
}
function digest(value: unknown, at: string): string {
  const s = text(value, at);
  check(/^[a-f0-9]{64}$/.test(s), at + ": expected SHA256");
  return s;
}
function nullableDigest(value: unknown, at: string): string | null {
  return value === null ? null : digest(value, at);
}
function commit(value: unknown, at: string): string {
  const s = text(value, at);
  check(/^[a-f0-9]{7,40}$/.test(s), at + ": invalid commit");
  return s;
}
function date(value: unknown, at: string): string {
  const s = text(value, at);
  check(/^\d{4}-\d\d-\d\dT/.test(s) && Number.isFinite(Date.parse(s)), at + ": invalid timestamp");
  return s;
}
function cell(value: unknown, at: string, peak = false, size = false): Cell {
  const o = obj(
    value,
    ["status", "nanoseconds", "spread", "checksum", "verified", "reason", "details", ...(size ? ["executableSize"] : []), ...(peak ? ["peakRss"] : [])],
    at,
  );
  const status = text(o.status, at + ".status") as Cell["status"];
  check(
    [
      "OK",
      "REFUSED",
      "ABORTED",
      "OVER_BUDGET",
      "INVALID",
      "NOT_RUN",
      "NOT_PROVIDED",
      "TIMED_OUT",
      "BUILD_FAILED",
    ].includes(status),
    at + ": unknown status",
  );
  const verified = bool(o.verified, at + ".verified"),
    reason = nullableText(o.reason, at + ".reason");
  const checksum = nullableText(o.checksum, at + ".checksum");
  if (checksum !== null) check(/^[0-9a-f]{16}$/.test(checksum), at + ": invalid checksum bits");
  const nanoseconds =
    o.nanoseconds === null ? null : finite(o.nanoseconds, at + ".nanoseconds", Number.MIN_VALUE);
  const spread = o.spread === null ? null : finite(o.spread, at + ".spread", 1);
  if (status === "OK") {
    check(nanoseconds !== null, at + ": OK without timing");
    if (verified)
      check(checksum !== null && spread !== null, at + ": verified timing without checksum/spread");
  } else
    check(
      nanoseconds === null && spread === null && !verified && reason !== null,
      at + ": failure cannot carry a timing or verification",
    );
  return {
    status,
    nanoseconds,
    spread,
    checksum,
    verified,
    reason,
    details: json(o.details, at + ".details"),
    ...(size ? { executableSize: o.executableSize === null ? null : readExecutableSize(o.executableSize, at + ".executableSize") } : {}),
    ...(peak ? { peakRss: peakRssValue(o.peakRss, at + ".peakRss") } : {}),
  };
}
function peakRssValue(value: unknown, at: string): PeakRss | null {
  if (value === null) return null;
  const o = obj(value, ["bytes", "spread"], at);
  return { bytes: finite(o.bytes, at + ".bytes", Number.MIN_VALUE), spread: finite(o.spread, at + ".spread", 1) };
}
function sizedValue(value: unknown, at: string): Sized {
  const o = obj(value, ["case", "function", "input"], at);
  return { case: text(o.case, at + ".case"), function: text(o.function, at + ".function"), input: finite(o.input, at + ".input", -Number.MAX_VALUE) };
}
function growthValue(value: unknown, columns: readonly string[], at: string): Record<string, Growth> {
  const o = obj(value, columns, at);
  return Object.fromEntries(columns.map((c) => {
    check(GROWTHS.includes(o[c] as Growth), at + "." + c + ": unknown growth");
    return [c, o[c] as Growth];
  }));
}
/**
 * The quantity a row ranks its cells by, with that quantity's spread: a
 * peak-RSS row's peak resident bytes, every other row's nanoseconds. Null
 * without a measurement. Every verdict, ratio and own-best reads it here.
 */
export function measure(row: Pick<Row, "kind" | "sizeView">, cell: Cell): { value: number; spread: number | null } | null {
  if (cell.status !== "OK") return null;
  if (row.kind === EXECUTABLE_SIZE_KIND) {
    check(cell.executableSize, "a measured size cell has no executable size");
    return { value: row.sizeView === "stripped" ? cell.executableSize.stripped.bytes : cell.executableSize.shipped.bytes, spread: 1 };
  }
  if (row.kind === PEAK_RSS_KIND) {
    check(cell.peakRss, "a measured peak-RSS cell has no peak RSS");
    return { value: cell.peakRss.bytes, spread: cell.peakRss.spread };
  }
  return { value: cell.nanoseconds!, spread: cell.spread };
}
/** Whether a cell's measurement may be ranked: on a peak-RSS row, only where its column grows with input. */
const ranked = (row: Pick<Row, "kind" | "growth">, column: string): boolean =>
  row.kind !== PEAK_RSS_KIND || row.growth?.[column] === "GROWS";
export function fastest(row: Pick<Row, "cells" | "kind" | "sizeView">): { backend: string; cell: Cell } | null {
  const values = ["nts C", "nts LLVM", "nts JVM"].flatMap((backend) =>
    row.cells[backend]?.status === "OK" ? [{ backend, cell: row.cells[backend], value: measure(row, row.cells[backend])!.value }] : [],
  );
  values.sort((a, b) => a.value - b.value);
  return values[0] ? { backend: values[0].backend, cell: values[0].cell } : null;
}
export function verdict(
  row: Pick<Row, "cells" | "kind" | "growth" | "sizeView">,
  backend: Backend,
  comparator: Comparator,
): Verdict {
  const mine = measure(row, row.cells[backend]),
    other = measure(row, row.cells[comparator]);
  if (!mine) return { kind: "UNAVAILABLE", ratio: null, tolerance: null };
  if (!other) return { kind: "NOT_COMPARABLE", ratio: null, tolerance: null };
  const ratio = mine.value / other.value;
  check(Number.isFinite(ratio), "benchmark ratio is not finite");
  if (!ranked(row, backend) || !ranked(row, comparator)) return { kind: "SUSPECT", ratio, tolerance: null };
  const tolerance = Math.max(1.05, mine.spread ?? 1, other.spread ?? 1);
  const kind =
    comparator === "node" || comparator === "Bun JIT"
      ? ratio <= 0.8
        ? "WON"
        : ratio <= 1
          ? "SHORT"
          : "LOSS"
      : ratio < 0.95
        ? "WON"
        : ratio <= tolerance
          ? "TIE"
          : "LOSS";
  return {
    kind,
    ratio,
    tolerance: comparator === "node" || comparator === "Bun JIT" ? null : tolerance,
  };
}
function decode(value: unknown, derive: boolean): RunRecord {
  const o = obj(
    value,
    [
      "schemaVersion",
      ...(value !== null && typeof value === "object" && Object.hasOwn(value, "purpose") ? ["purpose"] : []),
      "id",
      "startedAt",
      "finishedAt",
      "complete",
      "inventory",
      "columns",
      "sourceCommit",
      "compiler",
      "harness",
      "machine",
      "comparators",
      "verdictPolicy",
      "provenance",
      "rows",
    ],
    "run",
  );
  check(o.schemaVersion === 1, "unsupported benchmark schema");
  const id = text(o.id, "id");
  check(/^\d{4}-\d\d-\d\d-[a-f0-9]{7,40}-[a-z0-9-]+$/.test(id), "invalid run filename identity");
  const sitting = Object.hasOwn(o, "purpose");
  if (sitting) check(o.purpose === "sitting", "unknown run purpose");
  check(id.endsWith("-sitting") === sitting, "sitting identity and purpose disagree");
  const startedAt = o.startedAt === null ? null : date(o.startedAt, "startedAt"),
    finishedAt = o.finishedAt === null ? null : date(o.finishedAt, "finishedAt");
  if (startedAt && finishedAt)
    check(Date.parse(startedAt) <= Date.parse(finishedAt), "run ends before it starts");
  const complete = bool(o.complete, "complete"),
    inventory = strings(o.inventory, "inventory"),
    columns = strings(o.columns, "columns");
  check(
    inventory.length > 0 && COLUMNS.every((c) => columns.includes(c)),
    "missing inventory or standing column",
  );
  const compiler = obj(o.compiler, ["commit", "sha256"], "compiler"),
    harness = obj(o.harness, ["identity", "contract", "files"], "harness"),
    machine = obj(o.machine, ["identity", "conditions"], "machine");
  const policy = obj(o.verdictPolicy, ["version", "authority"], "verdictPolicy");
  check(isDeepStrictEqual(policy, POLICY), "unsupported verdict policy or authority");
  const builds = obj(o.comparators, COMPARATORS, "comparators");
  const comparators = Object.fromEntries(
    COMPARATORS.map((c) => {
      if (builds[c] === null) return [c, null];
      const b = obj(builds[c], ["version", "commit", "sha256", "command"], "comparator " + c);
      return [
        c,
        {
          version: nullableText(b.version, c + ".version"),
          commit: nullableText(b.commit, c + ".commit"),
          sha256: nullableDigest(b.sha256, c + ".sha256"),
          command: list(b.command, c + ".command").map((x) => text(x, c + ".command")),
        },
      ];
    }),
  ) as RunRecord["comparators"];
  const harnessValue = {
    identity: text(harness.identity, "harness.identity"),
    contract: nullableText(harness.contract, "harness.contract"),
    files: list(harness.files, "harness.files").map((x) => {
      const f = obj(x, ["path", "sha256"], "harness file");
      return {
        path: text(f.path, "harness file path"),
        sha256: digest(f.sha256, "harness file digest"),
      };
    }),
  };
  const machineValue = {
    identity: nullableText(machine.identity, "machine.identity"),
    conditions: json(machine.conditions, "machine.conditions"),
  };
  const parsed = list(o.rows, "rows").map((value, index) => {
    const at = "row " + index,
      has = (key: string) => value !== null && typeof value === "object" && Object.hasOwn(value, key),
      r = obj(
        value,
        ["name", "workloadIdentity", "eligibleForBest", "conditions", "cells", "verdicts",
          ...["builds", "kind", "sized", "growth", "strippedVerdicts"].filter(has)],
        at,
      );
    const name = text(r.name, at + ".name");
    check(inventory.includes(name), "orphan row " + name);
    if (Object.hasOwn(r, "kind")) check(r.kind === LAUNCH_KIND || r.kind === PEAK_RSS_KIND || r.kind === EXECUTABLE_SIZE_KIND, name + ": unknown row kind");
    const launch = r.kind === LAUNCH_KIND, peak = r.kind === PEAK_RSS_KIND, size = r.kind === EXECUTABLE_SIZE_KIND;
    // A peak-RSS row names its sized workload and records its growth; no other row does.
    check(Object.hasOwn(r, "sized") === peak && (peak || !Object.hasOwn(r, "growth")),
      name + ": a sized workload and its growth belong to peak-RSS rows only");
    const rawCells = obj(r.cells, columns, at + ".cells");
    const cells = Object.fromEntries(columns.map((c) => [c, cell(rawCells[c], name + "/" + c, peak, size)]));
    if (size) {
      const oracle = cell(field(r.conditions as Json, "sizeOracle"), name + "/oracle");
      checkLaunchCell(oracle, name + "/oracle");
      for (const c of columns) {
        checkExecutableSizeCell(cells[c]!, name + "/" + c);
        if (cells[c]!.status === "OK") check(oracle.status === "OK" && cells[c]!.checksum === oracle.checksum, name + ": size output differs from node");
      }
    }
    if (launch) for (const c of columns) checkLaunchCell(cells[c]!, name + "/" + c);
    if (peak) for (const c of columns) checkPeakRssCell(cells[c]!, name + "/" + c);
    const answers = new Set(
      Object.values(cells)
        .filter((c) => c.status === "OK" && c.verified)
        .map((c) => c.checksum),
    );
    check(answers.size <= 1, "checksum disagreement in OK cells: " + name);
    const workloadIdentity = nullableDigest(r.workloadIdentity, name + ".workloadIdentity"),
      eligibleForBest = bool(r.eligibleForBest, name + ".eligibleForBest");
    if (eligibleForBest)
      check(
        workloadIdentity && harnessValue.contract && machineValue.identity,
        "eligible row lacks workload/harness/machine identity",
      );
    const builds=Object.hasOwn(r,'builds')?readBuildDetails(r.builds):undefined;
    if(builds)check(builds.stages.every(stage=>columns.includes(stage.column)),name+': build stage names an unknown column');
    return {
      raw: r,
      row: {
        name,
        ...(size ? { kind: EXECUTABLE_SIZE_KIND as typeof EXECUTABLE_SIZE_KIND } : {}),
        ...(launch ? { kind: LAUNCH_KIND as typeof LAUNCH_KIND } : {}),
        ...(peak ? { kind: PEAK_RSS_KIND as typeof PEAK_RSS_KIND, sized: sizedValue(r.sized, name + ".sized") } : {}),
        workloadIdentity,
        eligibleForBest,
        conditions: json(r.conditions, name + ".conditions"),
        cells,
        verdicts: {} as Row["verdicts"],
        ...(builds?{builds}:{}),
      } as Row,
    };
  });
  // Growth is a fact about a case's rows together, so it is derived once every row is read.
  const growth = peakRssGrowth(parsed.flatMap(({ row }) => row.sized ? [{ name: row.name, sized: row.sized, cells: row.cells }] : []), columns);
  const rows = parsed.map(({ raw, row }) => {
    if (row.sized) {
      row.growth = growth.get(row.name)!;
      if (!derive)
        check(isDeepStrictEqual(growthValue(raw.growth, columns, row.name + ".growth"), row.growth), "changed or missing recorded growth: " + row.name);
    }
    row.verdicts = Object.fromEntries(
      BACKENDS.map((b) => [
        b,
        Object.fromEntries(COMPARATORS.map((c) => [c, verdict(row, b, c)])),
      ]),
    ) as Row["verdicts"];
    if (row.kind === EXECUTABLE_SIZE_KIND) {
      const stripped = { ...row, sizeView: "stripped" as const };
      row.strippedVerdicts = Object.fromEntries(BACKENDS.map(b => [b, Object.fromEntries(COMPARATORS.map(c => [c, verdict(stripped, b, c)]))])) as Row["verdicts"];
      if (!derive) check(isDeepStrictEqual(raw.strippedVerdicts, row.strippedVerdicts), "changed or missing stripped verdict: " + row.name);
    } else check(!Object.hasOwn(raw, "strippedVerdicts"), "stripped verdicts belong to executable size rows only");
    if (!derive)
      check(
        isDeepStrictEqual(raw.verdicts, row.verdicts),
        "changed or missing recorded verdict: " + row.name,
      );
    return row;
  });
  check(new Set(rows.map((r) => r.name)).size === rows.length, "duplicate benchmark row");
  if (complete) check(rows.length === inventory.length, "complete run omitted a declared row");
  return {
    schemaVersion: 1,
    ...(sitting ? { purpose: "sitting" as const } : {}),
    id,
    startedAt,
    finishedAt,
    complete,
    inventory,
    columns,
    sourceCommit: commit(o.sourceCommit, "sourceCommit"),
    compiler: {
      commit: compiler.commit === null ? null : commit(compiler.commit, "compiler.commit"),
      sha256: nullableDigest(compiler.sha256, "compiler.sha256"),
    },
    harness: harnessValue,
    machine: machineValue,
    comparators,
    verdictPolicy: POLICY,
    provenance: json(o.provenance, "provenance"),
    rows,
  };
}
export function sealRun(value: unknown): RunRecord {
  return decode(value, true);
}
export function parseRun(value: unknown): RunRecord {
  return decode(value, false);
}
export type BenchmarkRecordInputs = { runs: string; table: string };
export function benchmarkRecordInputs(root: string): BenchmarkRecordInputs {
  return { runs: join(root, "results/benchmarks/runs"), table: join(root, "results/benchmarks/full.md") };
}
export function readRuns(root: string, inputs = benchmarkRecordInputs(root)): RunRecord[] {
  const directory = inputs.runs;
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => {
      const run = parseRun(JSON.parse(readFileSync(join(directory, file), "utf8")));
      requirePublished(run);
      check(file === run.id + ".json", "run filename disagrees with identity");
      return run;
    });
}
/** Gate authority: immutable evidence and its one rendered view must agree. */
export function checkRecords(root: string, inputs = benchmarkRecordInputs(root)): { runs: number; complete: number } {
  const runDirectory = relative(resolve(root), resolve(inputs.runs)).split(sep).join("/");
  check(runDirectory && !isAbsolute(runDirectory) && runDirectory !== ".." && !runDirectory.startsWith("../"),
    "benchmark run directory is outside its repository: " + inputs.runs);
  const runs = readRuns(root, inputs);
  // A committed observation cannot disappear or be rewritten, even with newly forged verdicts.
  const additions = git(root, [
    "log",
    "--format=",
    "--raw",
    "--no-renames",
    "--abbrev=40",
    "--diff-filter=A",
    "-z",
    "--",
    ":(literal)" + runDirectory + "/",
  ]);
  const entries = additions.split("\0");
  for (let index = 0; index < entries.length;) {
    const header = entries[index++]!.trim();
    if (!header) continue;
    const match = /^:000000 [0-7]{6} 0{40} ([a-f0-9]{40}) A$/.exec(header);
    check(match, "unrecognized benchmark history entry");
    const name = entries[index++] ?? "";
    check(name.startsWith(runDirectory + "/") && name.slice(runDirectory.length + 1).endsWith(".json")
      && !name.slice(runDirectory.length + 1).includes("/"), "unrecognized benchmark history path: " + name);
    const path = join(root, name);
    check(existsSync(path), "missing immutable benchmark run: " + name);
    const bytes = readFileSync(path),
      identity = createHash("sha1")
        .update("blob " + bytes.length + "\0")
        .update(bytes)
        .digest("hex");
    check(identity === match[1] || approvedRecordMigration(name.slice(runDirectory.length + 1, -5), match[1]!, identity),
      "immutable benchmark run was rewritten: " + name);
  }
  const full = inputs.table;
  check(existsSync(full), "missing benchmark full.md");
  check(
    readFileSync(full, "utf8") === renderFull(runs, readBenchmarkGroups(root)),
    "benchmark full.md differs from the shared renderer",
  );
  return { runs: runs.length, complete: runs.filter((r) => r.complete).length };
}
function newestFirst(a: RunRecord, b: RunRecord): number {
  return Date.parse(b.finishedAt ?? b.id.slice(0, 10)) -
    Date.parse(a.finishedAt ?? a.id.slice(0, 10)) || b.id.localeCompare(a.id);
}
export function newestComplete(runs: RunRecord[]): RunRecord | null {
  return (
    runs
      .filter((r) => r.complete)
      .sort(newestFirst)[0] ?? null
  );
}
export type OwnBest = {
  backend: Backend;
  comparator: Comparator;
  ratio: number;
  /** The row's measure (`measure`): nanoseconds, or a peak-RSS row's bytes. */
  backendValue: number;
  comparatorValue: number;
  backendSpread: number;
  comparatorSpread: number;
  compiler: string;
  run: string;
};
type PriorRow = { run: RunRecord; row: Row };
function priorRows(run: RunRecord, row: Row, runs: RunRecord[]): PriorRow[] {
  if (!row.eligibleForBest || !row.workloadIdentity || !run.harness.contract || !run.machine.identity) return [];
  return runs.flatMap((prior) => {
    if (prior.id === run.id || newestFirst(prior, run) <= 0 ||
        prior.machine.identity !== run.machine.identity || prior.harness.contract !== run.harness.contract) return [];
    const candidate = prior.rows.find((r) =>
      r.name === row.name && r.kind === row.kind && r.workloadIdentity === row.workloadIdentity && r.eligibleForBest);
    return candidate && prior.compiler.commit ? [{ run: prior, row: row.sizeView ? { ...candidate, sizeView: row.sizeView } : candidate }] : [];
  });
}
/** A verified, rankable measurement of one column on one row, with its spread. */
function verifiedMeasure(row: Row, column: string): { value: number; spread: number } | null {
  const cell = row.cells[column], measured = cell && cell.verified ? measure(row, cell) : null;
  return measured && measured.spread !== null && ranked(row, column) ? { value: measured.value, spread: measured.spread } : null;
}
function bestRatio(backend: Backend, comparator: Comparator, rows: PriorRow[], current?: Row): OwnBest | null {
  const found: OwnBest[] = [];
  for (const { run, row } of rows) {
    if (current?.kind === EXECUTABLE_SIZE_KIND && [backend, comparator].some(c => sizeRecipeIdentity(current.cells[c]!) !== sizeRecipeIdentity(row.cells[c]!))) continue;
    if (current?.sizeView === "stripped" && [backend, comparator].some(c => stripIdentity(current.cells[c]!) !== stripIdentity(row.cells[c]!))) continue;
    const mine = verifiedMeasure(row, backend), other = verifiedMeasure(row, comparator);
    if (!mine || !other) continue;
    const value = mine.value / other.value;
    check(Number.isFinite(value), "own-best ratio is not finite");
    found.push({
      backend, comparator, ratio: value,
      backendValue: mine.value, comparatorValue: other.value,
      backendSpread: mine.spread, comparatorSpread: other.spread,
      compiler: run.compiler.commit!, run: run.id,
    });
  }
  found.sort((a, b) => a.ratio - b.ratio || a.run.localeCompare(b.run));
  return found[0] ?? null;
}
export function ownBest(
  run: RunRecord,
  row: Row,
  backend: Backend,
  comparator: Comparator,
  runs: RunRecord[],
): OwnBest | null {
  return bestRatio(backend, comparator, priorRows(run, row, runs), row);
}
export type OwnBestComparison = {
  currentRatio: number;
  best: OwnBest;
  relativeRatio: number;
  spreads: { currentBackend: number; currentComparator: number; priorBackend: number; priorComparator: number };
  spreadProduct: number;
  tolerance: number;
  slowerThanBest: boolean;
};
function compareBest(row: Row, backend: Backend, comparator: Comparator, best: OwnBest | null): OwnBestComparison | null {
  const mine = verifiedMeasure(row, backend), other = verifiedMeasure(row, comparator);
  if (!best || !mine || !other) return null;
  const currentRatio = mine.value / other.value, relativeRatio = currentRatio / best.ratio;
  const spreads = {
    currentBackend: mine.spread, currentComparator: other.spread,
    priorBackend: best.backendSpread, priorComparator: best.comparatorSpread,
  };
  const spreadProduct = Object.values(spreads).reduce((product, value) => product * value, 1);
  const tolerance = Math.max(1.05, spreadProduct);
  check(Number.isFinite(relativeRatio) && Number.isFinite(spreadProduct), "own-best ratio comparison is not finite");
  return { currentRatio, best, relativeRatio, spreads, spreadProduct, tolerance, slowerThanBest: relativeRatio > tolerance };
}
/** One backend on one row, with independent prior ratio history for each comparator. */
export type BackendResult = {
  versus: Record<Comparator, Verdict>;
  /** This backend's time over the reference's, or null unless both ran. */
  references: Record<Reference, number | null>;
  ownBest: Record<Comparator, OwnBestComparison | null>;
  /** At least one comparison exists, and every established comparator regresses. */
  slowerThanBest: boolean;
};
export type RowResult = {
  row: Row;
  backends: Record<Backend, BackendResult>;
  /** LLVM's time over C's, with the larger of their spreads, and the backend that trails beyond it. */
  llvmVersusC: { ratio: number; tolerance: number; trailing: "nts C" | "nts LLVM" | null } | null;
};
/** Verdict counts in the order the run's rows first show each kind; a kind no row has is absent. */
export type VerdictCounts = Partial<Record<Verdict["kind"], number>>;
/**
 * What `full.md` and the benchmark summary (tooling/records/summary.ts) both
 * render: the newest complete run, with every value either shows computed here
 * once. Null when no complete run has been retained.
 */
export type Results = {
  run: RunRecord;
  counts: Record<Backend, Record<Comparator, VerdictCounts>>;
  /** By case name. */
  rows: RowResult[];
  coverage: OwnBestCoverage;
};
const ratio = (row: Row, mine: string, other: string): number | null => {
  const a = measure(row, row.cells[mine]!), b = measure(row, row.cells[other]!);
  return a && b ? a.value / b.value : null;
};
export function results(runs: RunRecord[], current?: RunRecord): Results | null {
  const run = current ?? newestComplete(runs);
  if (!run) return null;
  const counts = Object.fromEntries(
    BACKENDS.map((backend) => [
      backend,
      Object.fromEntries(
        COMPARATORS.map((c) => {
          const count: VerdictCounts = {};
          for (const row of run.rows) {
            const k = row.verdicts[backend][c].kind;
            count[k] = (count[k] ?? 0) + 1;
          }
          return [c, count];
        }),
      ),
    ]),
  ) as Results["counts"];
  // By name, except that a peak-RSS row sorts by its case, function and input, so a case's growth runs down the table.
  const key = (row: Row): [string, string, number] => row.sized ? [row.sized.case, row.sized.function, row.sized.input] : [row.name, "", 0];
  const rows = [...run.rows]
    .sort((a, b) => {
      const [x, y] = [key(a), key(b)];
      return x[0].localeCompare(y[0]) || x[1].localeCompare(y[1]) || x[2] - y[2] || a.name.localeCompare(b.name);
    })
    .map((row) => {
      const history = priorRows(run, row, runs);
      const backends = Object.fromEntries(
        BACKENDS.map((backend) => {
          const best = Object.fromEntries(COMPARATORS.map((comparator) => [
            comparator, compareBest(row, backend, comparator, bestRatio(backend, comparator, history, row)),
          ])) as BackendResult["ownBest"];
          const established = Object.values(best).filter((comparison): comparison is OwnBestComparison => comparison !== null);
          return [
            backend,
            {
              versus: row.sizeView ? row.strippedVerdicts![backend] : row.verdicts[backend],
              references: Object.fromEntries(
                REFERENCES.map((r) => [r, ratio(row, backend, r)]),
              ),
              ownBest: best,
              slowerThanBest: established.length > 0 && established.every((comparison) => comparison.slowerThanBest),
            },
          ];
        }),
      ) as RowResult["backends"];
      const c = measure(row, row.cells["nts C"]),
        llvm = measure(row, row.cells["nts LLVM"]);
      const versusC = ratio(row, "nts LLVM", "nts C");
      const tolerance = Math.max(c?.spread ?? 1, llvm?.spread ?? 1);
      const llvmVersusC =
        versusC === null
          ? null
          : {
              ratio: versusC,
              tolerance,
              trailing:
                versusC > tolerance
                  ? ("nts LLVM" as const)
                  : versusC < 1 / tolerance
                    ? ("nts C" as const)
                    : null,
            };
      return { row, backends, llvmVersusC };
    });
  const ownBestCoverage = Object.fromEntries(BACKENDS.map(backend => {
    // Count rows eligible for own-best with at least one rankable, verified
    // current pair. A spoiled row, refused, unverified and unrankable cells
    // can never establish a regression comparison, so they are not owed one.
    const eligible = rows.filter(({ row }) => row.eligibleForBest && verifiedMeasure(row, backend) &&
      COMPARATORS.some(comparator => verifiedMeasure(row, comparator)));
    const established = eligible.filter(row => Object.values(row.backends[backend].ownBest).some(value => value !== null)).length;
    return [backend, coverage(established, eligible.length)];
  })) as OwnBestCoverage;
  return { run, counts, rows, coverage: ownBestCoverage };
}
const time = (ns: number) =>
  ns < 1000
    ? ns.toFixed(1) + " ns"
    : ns < 1e6
      ? (ns / 1e3).toFixed(2) + " µs"
      : (ns / 1e6).toFixed(2) + " ms";
const escape = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
const size = (bytes: number) => bytes < 2 ** 20 ? (bytes / 1024).toFixed(1) + " KiB" : (bytes / 2 ** 20).toFixed(2) + " MiB";
/** One measured cell as full.md and the console show it: a peak-RSS cell's memory beside its time, and its growth unless it grows. */
function shown(row: Row, column: string): string {
  const cell = row.cells[column]!;
  if (row.kind === EXECUTABLE_SIZE_KIND) return size(measure(row, cell)!.value);
  if (row.kind !== PEAK_RSS_KIND) return time(cell.nanoseconds!);
  const growth = row.growth?.[column];
  return size(cell.peakRss!.bytes) + " · " + time(cell.nanoseconds!) + (growth && growth !== "GROWS" ? " (" + growth + ")" : "");
}
/** The median peak resident set of a sitting's timed launches, or null where none were kept. */
function launchesRss(details: Json): number | null {
  if (!details || typeof details !== "object" || Array.isArray(details) || !Array.isArray(details.launches) || !details.launches.length) return null;
  return launchSummary(details.launches.map((value, index) => readLaunch(value, "launches[" + index + "]").maxRssKib)).median * 1024;
}
const field = (value: Json | undefined, key: string): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value[key] : undefined;
/** Verdict counts over one set of rendered rows: a group's standing against the bar. */
function verdictCounts(rows: RowResult[]): string[] {
  return BACKENDS.map((backend) => {
    const columns = COMPARATORS.map((c) => {
      const count: VerdictCounts = {};
      for (const row of rows) {
        const kind = row.backends[backend].versus[c].kind;
        count[kind] = (count[kind] ?? 0) + 1;
      }
      return c + ": " + Object.entries(count).map(([kind, n]) => n + " " + kind).join(", ");
    });
    return "- **" + backend + "**: " + columns.join("; ") + ".";
  });
}
function globalCounts(model: Results): string[] {
  return BACKENDS.map((backend) => {
    const columns = COMPARATORS.map(
      (c) =>
        c +
        ": " +
        Object.entries(model.counts[backend][c])
          .map(([k, n]) => n + " " + k)
          .join(", "),
    );
    return "- **" + backend + "**: " + columns.join("; ") + ".";
  });
}
export function renderFull(runs: RunRecord[], groups: readonly BenchmarkGroup[] = [], current?: RunRecord): string {
  const model = results(runs, current);
  if (!model) return "# Benchmark results\n\nNo complete run has been retained.\n";
  const { run } = model;
  const stripped = (run: RunRecord): RunRecord => ({ ...run, rows: run.rows.filter(row => row.kind === EXECUTABLE_SIZE_KIND)
    .map(row => ({ ...row, sizeView: "stripped" as const })) });
  const strippedModel = results(runs.map(stripped), current ? stripped(current) : undefined);
  const counts = globalCounts(model);
  const heading = run.purpose === "sitting"
    ? `# Benchmark sitting\n\nScratch evidence; cannot be published. Sitting: [${run.id}](${run.id}.json)`
    : `# Benchmark results\n\nNewest complete run: [${run.id}](runs/${run.id}.json)`;
  const header = `${heading}. Compiler ${run.compiler.commit}; source ${run.sourceCommit}. Harness ${run.harness.identity}; contract ${run.harness.contract ?? "unknown (historical)"}. Verdict policy v${POLICY.version}, [The bar](../../${POLICY.authority}).\n\n${counts.join("\n")}\n\n${coverageHeader(model.coverage)}\n\nConditions: ${JSON.stringify(run.machine.conditions)}. Per-row conditions and sibling samples are retained in the run JSON. All ratios are within this run. Each backend is held separately to the bar: node and Bun JIT require 0.80×; Bun AOT/ScriptC ties use max(1.05, the two cells' observed spread). A refusal is not a timing.\n\nOwn-best comparisons use each backend/comparator's best prior within-run ratio on the same machine, workload/input and harness contract. Only verified OK pairs are comparable. The change is current ratio / prior ratio; its allowance is max(1.05, the product of the four cell spreads). Noise factors below are current backend, current comparator, prior backend, prior comparator, in that order. Absolute times are information only. Missing comparisons are not established. Historical runs with unknown completion times sort by the date recorded in their filename.\n`;
  const tableFor = (rows: RowResult[]): string => {
  const native = ["nts C", "nts LLVM"] as const;
  const columns = [
    "Case",
    ...COLUMNS,
    ...native.flatMap((b) => COMPARATORS.map((c) => b + "/" + c)),
    "LLVM versus C",
    ...BACKENDS.map((b) => b + " own best ratios"),
  ];
  const table = ["| " + columns.join(" | ") + " |", "|" + columns.map(() => "---").join("|") + "|"];
  for (const { row, backends, llvmVersusC } of rows) {
    const cells = COLUMNS.map((c) => {
      const cell = row.cells[c];
      return cell.status === "OK"
        ? shown(row, c) + (cell.verified ? "" : " (legacy unverified)")
        : cell.status;
    });
    const vs = native.flatMap((b) =>
      COMPARATORS.map((c) => {
        const v = backends[b].versus[c];
        return (v.ratio === null ? "" : v.ratio.toFixed(3) + "× ") + v.kind;
      }),
    );
    const own = BACKENDS.map((b) => {
      const comparisons=COMPARATORS.flatMap(comparator=>{
        const comparison=backends[b].ownBest[comparator];if(!comparison)return [];
        const {best,currentRatio,relativeRatio,spreads,spreadProduct,tolerance,slowerThanBest}=comparison;
        const quotient=(value:number)=>value.toPrecision(6)+'×';
        return [`${comparator}: ${quotient(currentRatio)}; best ${quotient(best.ratio)}; change ${quotient(relativeRatio)}; allowance ${quotient(tolerance)}; noise ${Object.values(spreads).map(value=>value.toPrecision(6)).join(' · ')} = ${quotient(spreadProduct)}; ${best.compiler}; [${best.run}](runs/${best.run}.json)`+(slowerThanBest?' **SLOWER THAN BEST**':'')];
      });
      return comparisons.length?comparisons.join('<br>')+(backends[b].slowerThanBest?'<br>'+OWN_BEST_REGRESSION:''):'not established';
    });
    table.push(
      "|" +
        [
          row.name,
          ...cells,
          ...vs,
          llvmVersusC === null
            ? "unavailable"
            : llvmVersusC.ratio.toFixed(3) +
              "×" +
              (llvmVersusC.trailing === "nts LLVM"
                ? " **LLVM TRAILS C**"
                : llvmVersusC.trailing === "nts C"
                  ? " **C TRAILS LLVM**"
                  : ""),
          ...own,
        ]
          .map(escape)
          .join("|") +
        "|",
    );
  }
  return table.join("\n");
  };
  const notes = run.rows.flatMap((row) =>
    Object.entries(row.cells)
      .filter(([_, c]) => c.status !== "OK" && c.reason)
      .map(
        ([name, c]) => "- " + row.name + ", " + name + ": " + c.status + ": " + escape(c.reason!),
      ),
  );
  notes.push(...run.rows.flatMap(row=>row.builds?describeBuilds(row.builds).map(detail=>'- '+row.name+', build: '+escape(detail)):[]));
  notes.push(...run.rows.flatMap((row) => {
    const floor = row.kind === LAUNCH_KIND && row.conditions && typeof row.conditions === "object" && !Array.isArray(row.conditions) ? row.conditions.launchFloor : null;
    const median = floor && typeof floor === "object" && !Array.isArray(floor) ? floor.median : null;
    return typeof median === "number" ? ["- " + row.name + ", launch floor: " + time(median) + " (/bin/true in the same sitting)"] : [];
  }));
  notes.push(...run.rows.flatMap((row) => {
    if (row.kind !== PEAK_RSS_KIND) return [];
    const floor = field(row.conditions, "launchFloor"), median = field(floor, "median"), rss = launchesRss(field(floor, "launch") ?? null);
    return typeof median === "number" && rss !== null
      ? ["- " + row.name + ", floor: /bin/true peak RSS " + size(rss) + ", " + time(median) + " (the same sitting)"] : [];
  }));
  notes.push(...run.rows.flatMap(row => row.kind !== EXECUTABLE_SIZE_KIND ? [] : Object.entries(row.cells).flatMap(([column, cell]) => {
    const receipt = cell.executableSize;
    if (!receipt) return [];
    return ["- " + row.name + ", " + column + ": " + receipt.runtime + "; interpreter " + (receipt.interpreter ?? "none (static)") +
      "; DT_NEEDED " + (receipt.needed.join(", ") || "none") + "; shared closure " + receipt.sharedLibraryBytes + " bytes (listed separately, never added to file bytes): " +
      receipt.sharedLibraries.map(f => f.path + " (" + f.bytes + " bytes, SHA256 " + f.sha256 + ")").join(", ") +
      "; strip " + receipt.strip.path + ", " + escape(receipt.strip.version) + ", SHA256 " + receipt.strip.sha256];
  })));
  const sizePreamble = "Executable size: headline as-shipped whole-file bytes from the timed build, including its embedded/linked runtime. Shared-library closure (including libc) is listed separately, never added to one column. The stripped view measures a private copy made with the build clang installation's llvm-strip, verified by executing it against the same output oracle. Both views face the bar independently; byte measurements have spread 1, and stripped own-best requires identical strip version and SHA256. Node/Bun JIT produce no standalone product and remain absent with reasons.\n\n";
  if (!groups.length) return header + "\n" + (run.rows.some(row => row.kind === EXECUTABLE_SIZE_KIND) ? sizePreamble : "") + tableFor(model.rows) +
    (strippedModel?.rows.length ? "\n\n## Executable size — stripped\n\n" + verdictCounts(strippedModel.rows).join("\n") + "\n\n" + tableFor(strippedModel.rows) : "") + "\n\n" + notes.join("\n") + "\n";
  const grouped = new Set<string>(), sections: string[] = [];
  const section = (title: string, declaredBy: string | null, rows: RowResult[]) => {
    const source = declaredBy ? `Declared by ${declaredBy}.\n\n` : "No foundation page names these rows.\n\n";
    const launch = rows.some((row) => row.row.kind === LAUNCH_KIND)
      ? "Launch rows: each time is one process from launch to exit, the median of its timed launches (launch-to-exit-v1); the launch timer's own floor in the same sitting is noted per row.\n\n"
      : "";
    const peak = rows.some((row) => row.row.kind === PEAK_RSS_KIND) ? peakRssPreamble(run) : "";
    const sizes = rows.filter(row => row.row.kind === EXECUTABLE_SIZE_KIND);
    const stripped = strippedModel?.rows.filter(row => sizes.some(size => size.row.name === row.row.name)) ?? [];
    sections.push(`## ${title}\n\n${source}${launch}${peak}${sizes.length ? sizePreamble + "### As shipped\n\n" : ""}${verdictCounts(rows).join("\n")}\n\n${tableFor(rows)}${stripped.length ? "\n\n### Stripped\n\n" + verdictCounts(stripped).join("\n") + "\n\n" + tableFor(stripped) : ""}`);
  };
  for (const group of groups) {
    const names = new Set(group.rows), rows = model.rows.filter((row) => names.has(row.row.name));
    if (!rows.length) continue;
    for (const row of rows) grouped.add(row.row.name);
    section(group.name, group.pages.map((page) => `[${page}](../../${page})`).join(", "), rows);
  }
  const ungrouped = model.rows.filter((row) => !grouped.has(row.row.name));
  if (ungrouped.length) section("Ungrouped", null, ungrouped);
  return header + "\n" + sections.join("\n\n") + "\n\n" + notes.join("\n") + "\n";
}
/**
 * What a peak-RSS group says before its table: how a cell is measured and
 * ranked, and the baselines that tell a runtime's own footprint from its work.
 */
function peakRssPreamble(run: RunRecord): string {
  const empty = run.rows.find((row) => row.name === "startup-empty");
  const baseline = empty
    ? COLUMNS.flatMap((c) => {
        const cell = empty.cells[c]!, rss = cell.status === "OK" ? launchesRss(field(cell.details, "launch") ?? null) : null;
        return rss === null ? [] : [c + " " + size(rss)];
      }).join(", ") || "no column ran"
    : "not in this run";
  return "Peak-RSS rows: each cell is the median peak resident set (wait4's ru_maxrss) of the same timed launches whose median launch-to-exit time stands beside it (launch-to-exit-v1). Ratios and verdicts compare peak bytes, held to the bar's ratios. A column whose time does not rise at every larger input of its case, as folded work would not, is marked FLAT (or UNESTABLISHED below two sizes), and its comparisons are SUSPECT, never ranked.\n\n" +
    "Baselines: startup-empty's peak RSS in this run, the program that does nothing: " + baseline + ". Each row's /bin/true floor is noted per row.\n\n";
}
export function consoleHeader(): string {
  return [
    "case",
    ...COLUMNS,
    ...["nts C", "nts LLVM"].flatMap((b) => COMPARATORS.map((c) => b + "/" + c)),
  ].join("\t");
}
export function consoleRow(row: Row): string {
  const line = [
    row.name,
    ...COLUMNS.map((c) =>
      row.cells[c].status === "OK" ? shown(row, c) : row.cells[c].status,
    ),
    ...["nts C", "nts LLVM"].flatMap((b) =>
      COMPARATORS.map((c) => {
        const v = row.verdicts[b as Backend][c];
        return (v.ratio === null ? "" : v.ratio.toFixed(3) + "× ") + v.kind;
      }),
    ),
  ].join("\t");
  return row.kind === EXECUTABLE_SIZE_KIND && !row.sizeView
    ? line + "\n" + consoleRow({ ...row, name: row.name + " (stripped)", sizeView: "stripped", verdicts: row.strippedVerdicts! }) : line;
}
function git(root: string, args: string[]): string {
  const r = spawnSync("git", gitArguments(args), { cwd: root, encoding: "utf8" });
  check(r.status === 0, "git " + args.join(" ") + ": " + r.stderr);
  return r.stdout.trim();
}
function atomic(path: string, body: string, createOnly: boolean): void {
  const temporary = path + "." + randomUUID() + ".tmp";
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx");
    writeFileSync(fd, body);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    if (createOnly) linkSync(temporary, path);
    else renameSync(temporary, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
function renderLocked(root: string): string {
  const full = join(root, "results/benchmarks/full.md");
  mkdirSync(join(root, "results/benchmarks"), { recursive: true });
  atomic(full, renderFull(readRuns(root), readBenchmarkGroups(root)), false);
  return full;
}
export function renderRuns(root: string): string {
  const work = join(root, "target/benchmark-records");
  mkdirSync(work, { recursive: true });
  const r = spawnSync(
    "flock",
    [
      "-x",
      join(work, "publish.lock"),
      process.execPath,
      fileURLToPath(import.meta.url),
      "_render-locked",
      resolve(root),
    ],
    { encoding: "utf8" },
  );
  check(r.status === 0, "benchmark renderer: " + r.stderr);
  return r.stdout.trim();
}
function requirePublished(run: RunRecord): void {
  check(run.purpose !== "sitting" && !run.id.endsWith("-sitting"), "cannot publish a benchmark sitting");
}
/** Resolve missing descendants through their physical existing ancestor. */
function physical(path: string): string {
  try { return realpathSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(physical(parent), path.slice(parent.length));
  }
}
/** Refuse a destination before measurement, and again before writing evidence. */
export function sittingDirectory(root: string, directory: string): string {
  const destination = physical(resolve(directory)), repository = realpathSync(root);
  const within = relative(repository, destination);
  check(within !== "" && (isAbsolute(within) || within === ".." || within.startsWith(".." + sep)),
    "benchmark sitting directory must be outside the repository");
  check(!existsSync(destination), "benchmark sitting directory must be fresh: " + destination);
  return destination;
}
export function writeSitting(root: string, run: RunRecord, directory: string): string {
  parseRun(run);
  check(run.purpose === "sitting", "scratch output requires a sitting record");
  const destination = sittingDirectory(root, directory);
  const page = renderFull(readRuns(root), readBenchmarkGroups(root), run);
  mkdirSync(dirname(destination), { recursive: true });
  mkdirSync(destination);
  const path = join(destination, run.id + ".json");
  atomic(path, JSON.stringify(run, null, 2) + "\n", true);
  atomic(join(destination, "full.md"), page, true);
  return path;
}
function publishLocked(root: string, value: unknown, commitResults: boolean): string {
  const run = parseRun(value),
    directory = join(root, "results/benchmarks/runs");
  requirePublished(run);
  if (commitResults)
    check(
      git(root, ["diff", "--cached", "--name-only"]) === "",
      "results-only commit requires a clean index",
    );
  mkdirSync(directory, { recursive: true });
  const path = join(directory, run.id + ".json"),
    body = JSON.stringify(run, null, 2) + "\n";
  if (existsSync(path))
    check(
      readFileSync(path, "utf8") === body,
      "immutable run already exists with different bytes: " + run.id,
    );
  else atomic(path, body, true);
  renderLocked(root);
  if (commitResults) {
    const paths = ["results/benchmarks/runs/" + run.id + ".json", "results/benchmarks/full.md"];
    git(root, ["add", "--", ...paths]);
    const staged = git(root, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
    check(
      staged.every((p) => paths.includes(p)),
      "unrelated staged paths in results commit",
    );
    if (staged.length)
      git(root, ["commit", "-m", "results: retain benchmark run " + run.id, "--", ...paths]);
  }
  return path;
}
export function publishRun(root: string, run: RunRecord, commitResults = true): string {
  requirePublished(parseRun(run));
  const work = join(root, "target/benchmark-records");
  mkdirSync(work, { recursive: true });
  const input = join(work, randomUUID() + ".json");
  writeFileSync(input, JSON.stringify(run));
  try {
    const r = spawnSync(
      "flock",
      [
        "-x",
        join(work, "publish.lock"),
        process.execPath,
        fileURLToPath(import.meta.url),
        "_publish-locked",
        resolve(root),
        input,
        commitResults ? "commit" : "no-commit",
      ],
      { encoding: "utf8" },
    );
    check(r.status === 0, "benchmark publisher: " + r.stderr);
    return r.stdout.trim().split("\n").at(-1)!;
  } finally {
    unlinkSync(input);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, root, input, mode, ...extra] = process.argv.slice(2);
    check(
      root && (input || command === "_render-locked" || command === "check") && extra.length === 0,
      "usage: run-record.ts publish <root> <sealed.json> [commit|no-commit]",
    );
    if (command === "check") {
      check(!input && !mode, "check takes only a root");
      console.log(JSON.stringify(checkRecords(root)));
    } else if (command === "_render-locked") {
      check(root && !input && !mode, "invalid render request");
      console.log(renderLocked(root));
    } else {
      const value = JSON.parse(readFileSync(input, "utf8"));
      check(
        mode === undefined || mode === "commit" || mode === "no-commit",
        "unknown publication mode",
      );
      if (command === "_publish-locked")
        console.log(publishLocked(root, value, mode !== "no-commit"));
      else {
        check(command === "publish", "unknown record command");
        console.log(publishRun(root, parseRun(value), mode !== "no-commit"));
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
