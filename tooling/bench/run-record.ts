import {gitArguments} from "../gate/git-arguments/main.ts";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
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
import { join, relative, resolve } from "node:path";
import {dataDirectory} from "../gate/reader-inputs/main.ts";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { readBenchmarkGroups, type BenchmarkGroup } from "./groups.ts";

const SOURCE=fileURLToPath(new URL("../..",import.meta.url));
const RUNS=relative(SOURCE,fileURLToPath(dataDirectory(new URL("../../results/benchmarks/runs/",import.meta.url))));
const FULL=relative(SOURCE,fileURLToPath(new URL("../../results/benchmarks/full.md",import.meta.url)));

export const COMPARATORS = ["node", "Bun JIT", "Bun AOT", "ScriptC"] as const;
export const BACKENDS = ["nts C", "nts LLVM", "nts JVM"] as const;
export type Backend = (typeof BACKENDS)[number];
/** The references each backend comes as close to as it can: C++ for native code, Java for the JVM. */
export const REFERENCES = ["C++", "Java"] as const;
export type Reference = (typeof REFERENCES)[number];
export const COLUMNS = [...BACKENDS, ...REFERENCES, ...COMPARATORS] as const;
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
};
export type Verdict = {
  kind: "WON" | "SHORT" | "TIE" | "LOSS" | "UNAVAILABLE" | "NOT_COMPARABLE";
  ratio: number | null;
  tolerance: number | null;
};
export type Row = {
  name: string;
  workloadIdentity: string | null;
  eligibleForBest: boolean;
  conditions: Json;
  cells: Record<string, Cell>;
  verdicts: Record<Backend, Record<Comparator, Verdict>>;
};
export type Build = {
  version: string | null;
  commit: string | null;
  sha256: string | null;
  command: string[];
};
export type RunRecord = {
  schemaVersion: 1;
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
function cell(value: unknown, at: string): Cell {
  const o = obj(
    value,
    ["status", "nanoseconds", "spread", "checksum", "verified", "reason", "details"],
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
  };
}
export function fastest(row: Pick<Row, "cells">): { backend: string; cell: Cell } | null {
  const values = ["nts C", "nts LLVM", "nts JVM"].flatMap((backend) =>
    row.cells[backend]?.status === "OK" ? [{ backend, cell: row.cells[backend] }] : [],
  );
  values.sort((a, b) => a.cell.nanoseconds! - b.cell.nanoseconds!);
  return values[0] ?? null;
}
export function verdict(
  row: Pick<Row, "cells">,
  backend: Backend,
  comparator: Comparator,
): Verdict {
  const mine = row.cells[backend],
    other = row.cells[comparator];
  if (mine.status !== "OK") return { kind: "UNAVAILABLE", ratio: null, tolerance: null };
  if (other.status !== "OK") return { kind: "NOT_COMPARABLE", ratio: null, tolerance: null };
  const ratio = mine.nanoseconds! / other.nanoseconds!;
  check(Number.isFinite(ratio), "benchmark ratio is not finite");
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
  const rows = list(o.rows, "rows").map((value, index) => {
    const at = "row " + index,
      r = obj(
        value,
        ["name", "workloadIdentity", "eligibleForBest", "conditions", "cells", "verdicts"],
        at,
      );
    const name = text(r.name, at + ".name");
    check(inventory.includes(name), "orphan row " + name);
    const rawCells = obj(r.cells, columns, at + ".cells");
    const cells = Object.fromEntries(columns.map((c) => [c, cell(rawCells[c], name + "/" + c)]));
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
    const expected = Object.fromEntries(
      BACKENDS.map((b) => [
        b,
        Object.fromEntries(COMPARATORS.map((c) => [c, verdict({ cells }, b, c)])),
      ]),
    ) as Row["verdicts"];
    if (!derive)
      check(
        isDeepStrictEqual(r.verdicts, expected),
        "changed or missing recorded verdict: " + name,
      );
    return {
      name,
      workloadIdentity,
      eligibleForBest,
      conditions: json(r.conditions, name + ".conditions"),
      cells,
      verdicts: expected,
    };
  });
  check(new Set(rows.map((r) => r.name)).size === rows.length, "duplicate benchmark row");
  if (complete) check(rows.length === inventory.length, "complete run omitted a declared row");
  return {
    schemaVersion: 1,
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
export function readRuns(root: string): RunRecord[] {
  const directory = join(root, RUNS);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => {
      const run = parseRun(JSON.parse(readFileSync(join(directory, file), "utf8")));
      check(file === run.id + ".json", "run filename disagrees with identity");
      return run;
    });
}
/** Gate authority: immutable evidence and its one rendered view must agree. */
export function checkRecords(root: string): { runs: number; complete: number } {
  const runs = readRuns(root);
  // A committed observation cannot disappear or be rewritten, even with newly forged verdicts.
  const additions = git(root, [
    "log",
    "--format=",
    "--raw",
    "--no-renames",
    "--abbrev=40",
    "--diff-filter=A",
    "--",
    "results/benchmarks/runs/",
  ]);
  for (const line of additions.split("\n").filter(Boolean)) {
    const match =
      /^:000000 [0-7]{6} 0{40} ([a-f0-9]{40}) A\t(results\/benchmarks\/runs\/[^\t]+\.json)$/.exec(
        line,
      );
    check(match, "unrecognized benchmark history entry");
    const path = join(root, match[2]);
    check(existsSync(path), "missing immutable benchmark run: " + match[2]);
    const bytes = readFileSync(path),
      identity = createHash("sha1")
        .update("blob " + bytes.length + "\0")
        .update(bytes)
        .digest("hex");
    check(identity === match[1], "immutable benchmark run was rewritten: " + match[2]);
  }
  const full = join(root, FULL);
  check(existsSync(full), "missing benchmark full.md");
  check(
    readFileSync(full, "utf8") === renderFull(runs, readBenchmarkGroups(root)),
    "benchmark full.md differs from the shared renderer",
  );
  return { runs: runs.length, complete: runs.filter((r) => r.complete).length };
}
export function newestComplete(runs: RunRecord[]): RunRecord | null {
  return (
    runs
      .filter((r) => r.complete)
      .sort(
        (a, b) =>
          Date.parse(b.finishedAt ?? b.id.slice(0, 10)) -
            Date.parse(a.finishedAt ?? a.id.slice(0, 10)) || b.id.localeCompare(a.id),
      )[0] ?? null
  );
}
export type OwnBest = {
  backend: string;
  nanoseconds: number;
  spread: number;
  compiler: string;
  run: string;
};
export function ownBest(
  run: RunRecord,
  row: Row,
  backend: Backend,
  runs: RunRecord[],
): OwnBest | null {
  if (!row.workloadIdentity || !run.harness.contract || !run.machine.identity) return null;
  const found: OwnBest[] = [];
  for (const prior of runs) {
    if (
      prior.machine.identity !== run.machine.identity ||
      prior.harness.contract !== run.harness.contract
    )
      continue;
    const candidate = prior.rows.find(
      (r) =>
        r.name === row.name && r.workloadIdentity === row.workloadIdentity && r.eligibleForBest,
    );
    if (!candidate || !prior.compiler.commit) continue;
    const c = candidate.cells[backend];
    if (c?.status === "OK" && c.verified)
      found.push({
        backend,
        nanoseconds: c.nanoseconds!,
        spread: c.spread!,
        compiler: prior.compiler.commit,
        run: prior.id,
      });
  }
  found.sort((a, b) => a.nanoseconds - b.nanoseconds || a.run.localeCompare(b.run));
  return found[0] ?? null;
}
/** One backend on one row: its verdicts, its ratios to the references, and its own best. */
export type BackendResult = {
  versus: Record<Comparator, Verdict>;
  /** This backend's time over the reference's, or null unless both ran. */
  references: Record<Reference, number | null>;
  ownBest: OwnBest | null;
  /** Slower than its own best by more than max(1.05, either spread). */
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
};
const ratio = (mine: Cell, other: Cell): number | null =>
  mine.status === "OK" && other.status === "OK" ? mine.nanoseconds! / other.nanoseconds! : null;
export function results(runs: RunRecord[]): Results | null {
  const run = newestComplete(runs);
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
  const rows = [...run.rows]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => {
      const backends = Object.fromEntries(
        BACKENDS.map((backend) => {
          const current = row.cells[backend],
            best = ownBest(run, row, backend, runs);
          return [
            backend,
            {
              versus: row.verdicts[backend],
              references: Object.fromEntries(
                REFERENCES.map((r) => [r, ratio(current, row.cells[r])]),
              ),
              ownBest: best,
              slowerThanBest:
                best !== null &&
                current.status === "OK" &&
                current.nanoseconds! >
                  best.nanoseconds * Math.max(1.05, current.spread ?? 1, best.spread),
            },
          ];
        }),
      ) as RowResult["backends"];
      const c = row.cells["nts C"],
        llvm = row.cells["nts LLVM"];
      const versusC = ratio(llvm, c);
      const tolerance = Math.max(c.spread ?? 1, llvm.spread ?? 1);
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
  return { run, counts, rows };
}
const time = (ns: number) =>
  ns < 1000
    ? ns.toFixed(1) + " ns"
    : ns < 1e6
      ? (ns / 1e3).toFixed(2) + " µs"
      : (ns / 1e6).toFixed(2) + " ms";
const escape = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
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
export function renderFull(runs: RunRecord[], groups: readonly BenchmarkGroup[] = []): string {
  const model = results(runs);
  if (!model) return "# Benchmark results\n\nNo complete run has been retained.\n";
  const { run } = model;
  const counts = globalCounts(model);
  const header = `# Benchmark results\n\nNewest complete run: [${run.id}](runs/${run.id}.json). Compiler ${run.compiler.commit}; source ${run.sourceCommit}. Harness ${run.harness.identity}; contract ${run.harness.contract ?? "unknown (historical)"}. Verdict policy v${POLICY.version}, [The bar](../../${POLICY.authority}).\n\n${counts.join("\n")}\n\nConditions: ${JSON.stringify(run.machine.conditions)}. Per-row conditions and sibling samples are retained in the run JSON. All ratios are within this run. Each backend is held separately to the bar: node and Bun JIT require 0.80×; Bun AOT/ScriptC ties use max(1.05, the two cells' observed spread). A refusal is not a timing.\n\nOwn-best values are per backend, using compatible machine, workload/input and harness contracts. Unknown historical identities and invalid cells are excluded. A slower-than-best flag is a cross-run observation with provenance, beside the current value. Historical runs with unknown completion times sort by the date recorded in their filename.\n`;
  const tableFor = (rows: RowResult[]): string => {
  const native = ["nts C", "nts LLVM"] as const;
  const columns = [
    "Case",
    ...COLUMNS,
    ...native.flatMap((b) => COMPARATORS.map((c) => b + "/" + c)),
    "LLVM versus C",
    ...BACKENDS.map((b) => b + " own best"),
  ];
  const table = ["| " + columns.join(" | ") + " |", "|" + columns.map(() => "---").join("|") + "|"];
  for (const { row, backends, llvmVersusC } of rows) {
    const cells = COLUMNS.map((c) => {
      const cell = row.cells[c];
      return cell.status === "OK"
        ? time(cell.nanoseconds!) + (cell.verified ? "" : " (legacy unverified)")
        : cell.status;
    });
    const vs = native.flatMap((b) =>
      COMPARATORS.map((c) => {
        const v = backends[b].versus[c];
        return (v.ratio === null ? "" : v.ratio.toFixed(3) + "× ") + v.kind;
      }),
    );
    const own = BACKENDS.map((b) => {
      const { ownBest: best, slowerThanBest } = backends[b];
      if (!best) return "not established";
      return (
        `${time(best.nanoseconds)}; ${best.compiler}; [${best.run}](runs/${best.run}.json)` +
        (slowerThanBest ? " **SLOWER THAN BEST**" : "")
      );
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
  if (!groups.length) return header + "\n" + tableFor(model.rows) + "\n\n" + notes.join("\n") + "\n";
  const grouped = new Set<string>(), sections: string[] = [];
  const section = (title: string, declaredBy: string | null, rows: RowResult[]) => {
    const source = declaredBy ? `Declared by ${declaredBy}.\n\n` : "No foundation page names these rows.\n\n";
    sections.push(`## ${title}\n\n${source}${verdictCounts(rows).join("\n")}\n\n${tableFor(rows)}`);
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
export function consoleHeader(): string {
  return [
    "case",
    ...COLUMNS,
    ...["nts C", "nts LLVM"].flatMap((b) => COMPARATORS.map((c) => b + "/" + c)),
  ].join("\t");
}
export function consoleRow(row: Row): string {
  return [
    row.name,
    ...COLUMNS.map((c) =>
      row.cells[c].status === "OK" ? time(row.cells[c].nanoseconds!) : row.cells[c].status,
    ),
    ...["nts C", "nts LLVM"].flatMap((b) =>
      COMPARATORS.map((c) => {
        const v = row.verdicts[b as Backend][c];
        return (v.ratio === null ? "" : v.ratio.toFixed(3) + "× ") + v.kind;
      }),
    ),
  ].join("\t");
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
  const full = join(root, FULL);
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
function publishLocked(root: string, value: unknown, commitResults: boolean): string {
  const run = parseRun(value),
    directory = join(root, RUNS);
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
  parseRun(run);
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
