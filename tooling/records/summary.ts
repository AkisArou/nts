// Summaries of what nts measured, as JSON: the benchmark results, and the
// conformance records per backend. The dashboard that runs nts's agents
// (signalbox) shows nts's progress from them, and agents read them too. nts
// decides this contract; its readers adapt to it.
//
//   node tooling/records/summary.ts benchmarks [--root <tree>]
//   node tooling/records/summary.ts conformance [--root <tree>]
//
// Each prints one JSON object on stdout and writes nothing anywhere. It reads
// the records of a tree (this one, unless --root names another) through the
// parsers their writers and checks use, and measures nothing. A record that
// does not parse is an error, never a partial summary.
//
// # The contract, version 1
//
// Every summary is an object with, as the landing and full checks' status
// (`--json`) has,
//
//   version   1; a change a reader has to know about takes the next number
//   kind      "benchmarks" or "conformance"
//   at        when it was read, as an ISO time
//   read      { root, commit }: the tree it read, and that tree's HEAD (null
//             when the tree is not a git checkout's top)
//
// Numbers are numbers: times in nanoseconds, ratios as quotients (0.543, never
// "0.543×"), counts as integers. A backend is c, llvm or jvm, the names
// `--backend` and results/ give them. A count of outcomes names the kinds that
// occur: a kind no case has is absent, not 0.
//
// ## benchmarks
//
// Another rendering of what results/benchmarks/full.md shows, from the one
// model both render (tooling/bench/run-record.ts, `results`): the newest
// complete run under results/benchmarks/runs/, each backend held to the bar
// (docs/README.md, "The bar") and to its own best.
//
//   run       the run, or null when no complete run has been retained:
//             { id, file, startedAt, finishedAt, sourceCommit,
//               compiler: { commit, sha256 }, harness: { identity, contract },
//               machine: { identity, conditions },
//               comparators: { <comparator>: { version, commit } | null },
//               verdictPolicy: { version, authority } }
//             `conditions` is the run's own, verbatim: its producer decides
//             its shape, and older runs recorded other fields.
//   columns   each backend's column in the run: { c: "nts C", llvm: "nts LLVM", jvm: "nts JVM" }
//   counts    { <backend>: { <comparator>: { <verdict kind>: n } } }, full.md's
//             header counts; null with no run
//   rows      by case name, each
//             { name,
//               cells: { <column>: { status, nanoseconds, spread, verified, reason } },
//               backends: { <backend>: {
//                 versus: { <comparator>: { kind, ratio, tolerance } },
//                 references: { "C++": <ratio>, "Java": <ratio> },
//                 ownBest: { nanoseconds, spread, compiler, run } | null,
//                 slowerThanBest } },
//               llvmVersusC: { ratio, tolerance, trailing } | null }
//
// The comparators are node, Bun JIT, Bun AOT and ScriptC; the columns are the
// run's standing ones, the three backends', the C++ and Java references' and
// the comparators'. A cell's status is OK, or why it has no time (REFUSED,
// ABORTED, NOT_PROVIDED, INVALID, ...) with the reason; nanoseconds and spread
// are null without a time, and verified is false for a historical time kept
// without its checksum or spread. A verdict's ratio is the backend's time over
// the comparator's. Its kind is WON, SHORT or LOSS against node and Bun JIT,
// won at 0.80 or below (tolerance null), and WON, TIE or LOSS against Bun AOT
// and ScriptC, a tie within `tolerance`; it is UNAVAILABLE when the backend has
// no time and NOT_COMPARABLE when the comparator has none, both with a null
// ratio. A reference ratio is the backend's time over C++'s or Java's, null
// unless both ran. ownBest is the backend's best verified time for the case in
// any run on this machine, workload and harness contract, with the compiler and
// run that made it; slowerThanBest says the current time is past it by more
// than max(1.05, either spread). llvmVersusC is LLVM's time over C's beside the
// larger of their spreads, and `trailing` the backend slower beyond it (c,
// llvm, or null for neither); null unless both ran.
//
// ## conformance
//
// The records each backend is held to, counted by outcome: what the gate's
// record steps check and the full check's recorders write.
//
//   backends  { <backend>: { <record>: ... } }; a record a backend lacks is absent
//     test262        results/test262/<backend>/<slice>.tsv, the cases of each
//                    test262 directory that ran to a verdict:
//                    { cases, outcomes, runtime, frontend,
//                      slices: { <slice>: { file, under, commit, compiler, harness, cases, outcomes } } }
//                    runtime and frontend ({ cases, outcomes }) split the cases a
//                    backend runs from the parse, early and resolution negatives
//                    the frontend judges once, on C; both are absent without the
//                    test262 checkout
//     typescript     results/typescript/<backend>/cases.tsv, every TypeScript conformance case:
//                    { file, version, commit, compiler, harness, under, cases, outcomes, pending }
//     benchmarks     results/benchmarks/<backend>/outcomes.tsv, what each benchmark compiles to:
//                    { file, version, commit, compiler, harness, under,
//                      scopes: { <scope>: { cases, outcomes } }, pending }
//     benchmarkRuns  results/benchmarks/<backend>/runs.tsv, how each benchmark runs,
//                    the record bench-agree keeps (the JVM's):
//                    { file, version, commit, compiler, under, cases, outcomes, pending }
//     dex            results/dex/outcomes.tsv, whether d8 accepts the JVM's classes
//                    for each example and benchmark (jvm only): { file, cases, outcomes, pending }
//
// `commit` is the commit a record was written at, and `compiler` and `harness`
// are the fingerprints it names; a test262 record written before records named
// them has null. test262's outcomes are pass and fail: a case that was refused,
// or that the harness cannot run, is not recorded. The others' are the kinds
// their records hold: pass, refused, wrong, build-failure, runtime-abort, ...
// test262's `cases` and `outcomes` are its slices' together. `pending` counts
// the cases whose source exists and whose record has no row yet, which the
// full check records after landing (tooling/records/pending.ts); a test262
// record has none, since a full run is what adds a case to it.
//
// Not summarized: the suite pages (results/suite/*.md), which nts-suite
// renders as Markdown with no record behind them and which do not split by
// backend; the oracle counts (results/oracle-counts/), node's case counts per
// program rather than outcomes; and the outcomes fixtures (tests/outcomes/),
// whose backend each fixture names on a `// backend:` line that only
// tooling/conformance/outcomes-check.ts reads.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEX_RECORD, recordedOutcomes } from "../android/dex-record.ts";
import { compileRecordPath, parseBenchmarkRecord } from "../bench/outcomes.ts";
import { BENCH_AGREE_BACKENDS, parseRunRecord, runsRecord } from "../bench/run-outcomes.ts";
import { BACKENDS as BACKEND_COLUMNS, COLUMNS, COMPARATORS, readRuns, results, type Backend as BackendColumn } from "../bench/run-record.ts";
import { negativePhaseOf } from "../census/project.ts";
import { parseTest262Record } from "../census/test262-record.ts";
import { parseTypeScriptRecord } from "../census/typescript-record.ts";
import { findPending } from "./record-pending.ts";

export const VERSION = 1;
export const KINDS = ["benchmarks", "conformance"] as const;
export type Kind = typeof KINDS[number];

/** Each backend by the name `--backend` and results/ give it, and its column in a benchmark run. */
const COLUMN = { c: "nts C", llvm: "nts LLVM", jvm: "nts JVM" } as const satisfies Record<string, BackendColumn>;
type Backend = keyof typeof COLUMN;
const BACKENDS = Object.keys(COLUMN) as Backend[];
// A backend the runs hold that this contract does not name is a new version of
// the contract, never a backend left out of every summary without a word.
assert.deepEqual(Object.values(COLUMN), [...BACKEND_COLUMNS], "the summary names every backend a benchmark run holds");
const backendOf = (column: BackendColumn): Backend => BACKENDS.find(backend => COLUMN[backend] === column)!;

/** The envelope every summary shares. */
function envelope(kind: Kind, root: string) {
  const asked = spawnSync("git", ["rev-parse", "--show-toplevel", "HEAD"], { cwd: root, encoding: "utf8" });
  const [top, head] = asked.status === 0 ? asked.stdout.trim().split("\n") : [];
  const commit = top && head && realpathSync(top) === realpathSync(root) ? head : null;
  return { version: VERSION, kind, at: new Date().toISOString(), read: { root: resolve(root), commit } };
}

/** The newest complete run, as full.md shows it. */
export function benchmarkSummary(root: string) {
  const model = results(readRuns(root)), run = model?.run ?? null;
  return {
    ...envelope("benchmarks", root),
    run: run && {
      id: run.id,
      file: `results/benchmarks/runs/${run.id}.json`,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      sourceCommit: run.sourceCommit,
      compiler: run.compiler,
      harness: { identity: run.harness.identity, contract: run.harness.contract },
      machine: run.machine,
      comparators: Object.fromEntries(COMPARATORS.map(name => {
        const build = run.comparators[name];
        return [name, build && { version: build.version, commit: build.commit }];
      })),
      verdictPolicy: run.verdictPolicy,
    },
    columns: COLUMN,
    counts: model && Object.fromEntries(BACKENDS.map(backend => [backend, model.counts[COLUMN[backend]]])),
    rows: (model?.rows ?? []).map(({ row, backends, llvmVersusC }) => ({
      name: row.name,
      cells: Object.fromEntries(COLUMNS.map(column => {
        const { status, nanoseconds, spread, verified, reason } = row.cells[column];
        return [column, { status, nanoseconds, spread, verified, reason }];
      })),
      backends: Object.fromEntries(BACKENDS.map(backend => {
        const { versus, references, ownBest, slowerThanBest } = backends[COLUMN[backend]];
        return [backend, {
          versus,
          references,
          ownBest: ownBest && { nanoseconds: ownBest.nanoseconds, spread: ownBest.spread, compiler: ownBest.compiler, run: ownBest.run },
          slowerThanBest,
        }];
      })),
      llvmVersusC: llvmVersusC && {
        ratio: llvmVersusC.ratio,
        tolerance: llvmVersusC.tolerance,
        trailing: llvmVersusC.trailing && backendOf(llvmVersusC.trailing),
      },
    })),
  };
}

/** How many cases had each outcome, the kinds in alphabetical order. */
function tally(kinds: readonly string[]): Record<string, number> {
  const count: Record<string, number> = {};
  for (const kind of [...kinds].sort()) count[kind] = (count[kind] ?? 0) + 1;
  return count;
}

function test262(root: string, backend: Backend, judge: Judge | undefined) {
  const directory = `results/test262/${backend}`;
  if (!existsSync(join(root, directory))) return undefined;
  const slices = readdirSync(join(root, directory)).filter(name => name.endsWith(".tsv")).sort().map(name => {
    const file = `${directory}/${name}`, { header, rows } = parseTest262Record(readFileSync(join(root, file), "utf8"));
    assert.equal(header.backend, backend, `${file} records the ${header.backend} backend`);
    return { slice: name.slice(0, -".tsv".length), file, header, rows };
  });
  const rows = slices.flatMap(({ rows }) => rows);
  const outcomes = rows.map(row => row.outcome);
  return {
    cases: outcomes.length,
    outcomes: tally(outcomes),
    ...(judge && judgedBy(judge, rows)),
    slices: Object.fromEntries(slices.map(({ slice, file, header, rows }) => [slice, {
      file, under: header.under, commit: header.commit, compiler: header.compiler, harness: header.harness,
      cases: rows.length, outcomes: tally(rows.map(row => row.outcome)),
    }])),
  };
}

const TEST262 = "third_party/test262";

/**
 * Who judges a test262 case. One whose front matter names a negative phase
 * other than runtime is judged by the frontend before any backend runs, so the
 * census runs it on C alone (tooling/census/project.ts, populationOf); every
 * other case is one a backend runs.
 */
type Judge = (path: string) => "runtime" | "frontend";

/**
 * Each case's judge, read from its front matter once per summary, since every
 * backend's records name the same cases; undefined without the test262
 * checkout, where the records keep their totals alone.
 */
function test262Judge(root: string): Judge | undefined {
  if (!existsSync(join(root, TEST262))) return undefined;
  const judged = new Map<string, "runtime" | "frontend">();
  return path => {
    let judge = judged.get(path);
    if (judge === undefined) {
      const file = join(root, TEST262, path);
      assert.ok(existsSync(file), `a test262 record names ${path}, which the checkout at ${TEST262} does not have`);
      const phase = negativePhaseOf(readFileSync(file, "utf8"));
      judged.set(path, (judge = phase === undefined || phase === "runtime" ? "runtime" : "frontend"));
    }
    return judge;
  };
}

function judgedBy(judge: Judge, rows: readonly { path: string; outcome: string }[]) {
  const outcomes = { runtime: [] as string[], frontend: [] as string[] };
  for (const row of rows) outcomes[judge(row.path)].push(row.outcome);
  return {
    runtime: { cases: outcomes.runtime.length, outcomes: tally(outcomes.runtime) },
    frontend: { cases: outcomes.frontend.length, outcomes: tally(outcomes.frontend) },
  };
}

/** How many cases each record file has no row for yet, by the full check's own notion of pending. */
type Pending = ReadonlyMap<string, number>;
function pendingByRecord(root: string): Pending {
  const pending = new Map<string, number>();
  for (const kind of ["typescript", "benchmarks", "benchmark-runs", "dex"] as const)
    for (const one of findPending(root, kind)) pending.set(one.record, (pending.get(one.record) ?? 0) + 1);
  return pending;
}

function typescript(root: string, backend: Backend, pending: Pending) {
  const file = `results/typescript/${backend}/cases.tsv`;
  if (!existsSync(join(root, file))) return undefined;
  const { metadata, cases } = parseTypeScriptRecord(readFileSync(join(root, file), "utf8"));
  assert.equal(metadata.backend, backend, `${file} records the ${metadata.backend} backend`);
  const { version, commit, compiler, harness, under } = metadata;
  return {
    file, version, commit, compiler, harness, under,
    cases: cases.size, outcomes: tally([...cases.values()].map(one => one.kind)), pending: pending.get(file) ?? 0,
  };
}

function benchmarks(root: string, backend: Backend, pending: Pending) {
  const file = compileRecordPath(backend);
  if (!existsSync(join(root, file))) return undefined;
  const { metadata, rows } = parseBenchmarkRecord(readFileSync(join(root, file), "utf8"));
  assert.equal(metadata.backend, backend, `${file} records the ${metadata.backend} backend`);
  const { version, commit, compiler, harness, under } = metadata;
  return {
    file, version, commit, compiler, harness, under,
    scopes: Object.fromEntries(metadata.scopes.map(scope => {
      const outcomes = rows.filter(row => row.scope === scope).map(row => row.outcome.kind);
      return [scope, { cases: outcomes.length, outcomes: tally(outcomes) }];
    })),
    pending: pending.get(file) ?? 0,
  };
}

function benchmarkRuns(root: string, backend: Backend, pending: Pending) {
  const file = (BENCH_AGREE_BACKENDS as readonly string[]).includes(backend) ? runsRecord(backend) : null;
  if (file === null || !existsSync(join(root, file))) return undefined;
  const { metadata, rows } = parseRunRecord(readFileSync(join(root, file), "utf8"));
  assert.equal(metadata.backend, backend, `${file} records the ${metadata.backend} backend`);
  const { version, commit, compiler, under } = metadata;
  return {
    file, version, commit, compiler, under,
    cases: rows.size, outcomes: tally([...rows.values()].map(run => run.kind)), pending: pending.get(file) ?? 0,
  };
}

function dex(root: string, backend: Backend, pending: Pending) {
  if (backend !== "jvm" || !existsSync(join(root, DEX_RECORD))) return undefined;
  const rows = recordedOutcomes(readFileSync(join(root, DEX_RECORD), "utf8"));
  return { file: DEX_RECORD, cases: rows.length, outcomes: tally(rows.map(row => row.outcome.kind)), pending: pending.get(DEX_RECORD) ?? 0 };
}

/** Every backend's records, counted by outcome. */
export function conformanceSummary(root: string) {
  const pending = pendingByRecord(root), judge = test262Judge(root);
  return {
    ...envelope("conformance", root),
    backends: Object.fromEntries(BACKENDS.map(backend => {
      const records = {
        test262: test262(root, backend, judge),
        typescript: typescript(root, backend, pending),
        benchmarks: benchmarks(root, backend, pending),
        benchmarkRuns: benchmarkRuns(root, backend, pending),
        dex: dex(root, backend, pending),
      };
      return [backend, Object.fromEntries(Object.entries(records).filter(([, record]) => record !== undefined))];
    })),
  };
}

export function summary(kind: Kind, root: string) {
  return kind === "benchmarks" ? benchmarkSummary(root) : conformanceSummary(root);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [kind, ...rest] = process.argv.slice(2), at = rest.indexOf("--root");
  const root = at === -1 ? fileURLToPath(new URL("../..", import.meta.url)) : rest[at + 1];
  const extra = at === -1 ? rest : rest.filter((_, index) => index !== at && index !== at + 1);
  if (!(KINDS as readonly (string | undefined)[]).includes(kind) || !root || extra.length) {
    console.error(`usage: node tooling/records/summary.ts ${KINDS.join("|")} [--root <tree>]`);
    process.exitCode = 2;
  } else {
    try { process.stdout.write(JSON.stringify(summary(kind as Kind, resolve(root)), null, 2) + "\n"); }
    catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
  }
}
