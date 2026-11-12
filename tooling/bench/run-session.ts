import {gitArguments} from "../gate/git-arguments/main.ts";
/** Official nts-bench bridge to the shared immutable record authority. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { vmToolFlags } from "../jvm/vm-flags.ts";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname, cpus } from "node:os";
import {
  COLUMNS,
  consoleHeader,
  consoleRow,
  POLICY,
  parseRun,
  publishRun,
  renderRuns,
  type Json,
  type RunRecord,
} from "./run-record.ts";
import { fromNts, type Metadata } from "./run-producers.ts";
import { pinnedComparators, sha256 } from "./comparator-pins.ts";
import { groupRows, readBenchmarkGroups } from "./groups.ts";
import { readJournal } from "./run-journal.ts";
function command(root: string, program: string, args: string[]): string {
  const r = spawnSync(program, args, { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
export function conditions(): Json {
  return {
    time: new Date().toISOString(),
    load: readFileSync("/proc/loadavg", "utf8").trim(),
    memoryAvailableBytes:
      Number(/^MemAvailable:\s+(\d+)/m.exec(readFileSync("/proc/meminfo", "utf8"))![1]) * 1024,
    cpu5: readFileSync("/proc/stat", "utf8")
      .split("\n")
      .find((l) => l.startsWith("cpu5 "))!,
  };
}
function cleanSources(root: string): void {
  const paths = command(root, "git", ["diff", "HEAD", "--name-only"]).split("\n").filter(Boolean);
  assert.ok(
    paths.every((p) => p.startsWith("results/")),
    "benchmark source tree is dirty: " + paths.filter((p) => !p.startsWith("results/")).join(", "),
  );
}
export function begin(root: string, binary: string, compilerCommit: string): Metadata {
  cleanSources(root);
  const pins = pinnedComparators(root),
    commit = command(root, "git", ["rev-parse", "HEAD"]),
    startedAt = new Date().toISOString();
  assert.match(
    compilerCommit,
    /^[a-f0-9]{40}$/,
    "compiler build has no committed source identity; rebuild nts-bench",
  );
  const inventory = readdirSync(join(root, "benchmarks/cases"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const files = [
    "benchmarks/common/bench.mjs",
    "benchmarks/common/main.cpp",
    "benchmarks/common/harness.h",
    "benchmarks/common/Bench.java",
    "tooling/bench/src/main.rs",
    "tooling/bench/host-columns.ts",
    "tooling/bench/typed-timer.ts",
  ].map((path) => ({ path, sha256: sha256(join(root, path)) }));
  const identity = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  const bridge = spawnSync(
    "git",
    gitArguments(["grep", "-n", "-F", "@scriptc/node", "--", "benchmarks/cases", "benchmarks/common"]),
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(
    bridge.status,
    1,
    "explicit ScriptC Node bridge or failed bridge audit: " + bridge.stdout + bridge.stderr,
  );
  return {
    schemaVersion: 1,
    id: startedAt.slice(0, 10) + "-" + commit.slice(0, 12) + "-" + randomUUID().replaceAll("-", ""),
    startedAt,
    finishedAt: null,
    complete: false,
    inventory,
    columns: [...COLUMNS, "nts f64"],
    sourceCommit: commit,
    compiler: { commit: compilerCommit, sha256: sha256(binary) },
    harness: { identity, contract: "opaque-bit-input-v1", files },
    machine: {
      identity: createHash("sha256")
        .update(JSON.stringify({ host: hostname(), cpus: cpus().map((c) => c.model), cpu: 4 }))
        .digest("hex"),
      conditions: {
        start: conditions(),
        cpu: process.env.NTS_BENCH_CPUS ?? null,
        sibling: 5,
        coreDumps: "all comparator children disable core dumps",
      },
    },
    comparators: pins.builds,
    verdictPolicy: POLICY,
    provenance: {
      kind: "official nts-bench",
      pins: pins.declaration,
      toolchain: {
        clang: command(root, "clang", ["--version"]),
        java: spawnSync("java", [...vmToolFlags("java"), "-version"], { encoding: "utf8" }).stderr,
      },
    },
  };
}
export function finish(root: string, input: string): string {
  const record = seal(root, JSON.parse(readFileSync(input, "utf8")));
  const published = publishRun(root, record);
  const failures = record.rows.flatMap((row) =>
    Object.entries(row.cells)
      .filter(([_, c]) => c.status === "INVALID" || c.status === "BUILD_FAILED")
      .map(([column, c]) => row.name + "/" + column + ": " + c.reason),
  );
  if (failures.length)
    throw new Error(
      "Benchmark observations retained at " + published + "; failed: " + failures.join("; "),
    );
  return published;
}

/** Seal the durable prefix after the session's unit has stopped. */
export function finishBudget(root: string, journal: string, budgetMs: number): { record: string; unreached: string[] } {
  const { raw, unreached } = readJournal(journal);
  const retained = join(root, "results/benchmarks/runs", raw.metadata.id + ".json");
  // The budget can expire during normal publication. Keep an already sealed
  // record's exact identity, rather than re-stamping its observations.
  const session = { kind: "time-budget", budgetMs, unreached };
  const record = existsSync(retained) ? parseRun(JSON.parse(readFileSync(retained, "utf8"))) : seal(root, { ...raw, session });
  // Publication belongs to the controller on the newest main. A budget must
  // not depend on finishing a results commit interrupted in the measured tree.
  const path = join(dirname(journal), record.id + ".json");
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
  return { record: path, unreached };
}

function seal(root: string, raw: any): RunRecord {
  cleanSources(root);
  assert.ok(
    raw.metadata,
    "raw run has no captured metadata; import it explicitly as a historical observation",
  );
  const metadata: Metadata = {
    ...raw.metadata,
    finishedAt: new Date().toISOString(),
    complete:
      raw.session === undefined &&
      raw.requested.length === 0 &&
      raw.lanes === null &&
      raw.cases.length === raw.metadata.inventory.length,
    ...(raw.session ? { provenance: { ...raw.metadata.provenance, session: raw.session } } : {}),
    machine: {
      ...raw.metadata.machine,
      conditions: { ...raw.metadata.machine.conditions, end: conditions() },
    },
  };
  const hosts = Object.fromEntries(
    raw.measured.map((m: { shown: string; hosts?: { cells: unknown } }) => [
      m.shown,
      m.hosts?.cells ?? {},
    ]),
  );
  return fromNts(metadata, raw, {}, hosts);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, root, ...args] = process.argv.slice(2);
  assert.ok(root, "run-session.ts <begin|finish|render|conditions|group> <root>");
  if (mode === "group") {
    const rows = groupRows(readBenchmarkGroups(root), args[0] ?? "");
    if (!rows) throw new Error(`unknown benchmark group \`${args[0]}\``);
    console.log(JSON.stringify(rows));
  } else if (mode === "header") console.log(consoleHeader());
  else if (mode === "row") {
    const raw = JSON.parse(readFileSync(args[0], "utf8"));
    const hosts = Object.fromEntries(
      raw.measured.map((m: { shown: string; hosts?: { cells: unknown } }) => [
        m.shown,
        m.hosts?.cells ?? {},
      ]),
    );
    const run = fromNts({ ...raw.metadata, complete: false }, raw, {}, hosts);
    console.log(consoleRow(run.rows[0]));
  } else if (mode === "begin") console.log(JSON.stringify(begin(root, args[0], args[1])));
  else if (mode === "finish") console.log(finish(root, args[0]));
  else if (mode === "conditions") console.log(JSON.stringify(conditions()));
  else if (mode === "render") {
    if (args[0]) {
      const saved = JSON.parse(readFileSync(args[0], "utf8"));
      parseRun(
        saved.schemaVersion
          ? saved
          : JSON.parse(
              readFileSync(
                join(root, "results/benchmarks/runs", saved.metadata.id + ".json"),
                "utf8",
              ),
            ),
      );
    }
    // Rendering cannot re-stamp or republish old observations as a new run.
    console.log(renderRuns(root));
  } else throw new Error("unknown run-session command: " + mode);
}
