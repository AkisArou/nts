import {testEnvironment} from "../gate/test-environment.ts";
// The summaries over trees of their own: the benchmark summary against the
// page the same model renders, full.md as it rendered before the model was
// shared, the numbers-as-numbers rule, the conformance summary over one record
// of each kind, and the command, which prints and writes nothing.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { DEX_RECORD, written as dexRecord } from "../android/dex-record.ts";
import { compileRecordPath, serializeBenchmarkRecord, type BenchmarkOutcome } from "../bench/outcomes.ts";
import { runsRecord, serializeRunRecord } from "../bench/run-outcomes.ts";
import { BACKENDS, COLUMNS, COMPARATORS, POLICY, publishRun, renderFull, results, sealRun, type Cell, type RunRecord } from "../bench/run-record.ts";
import { censusReportPath, writeCensusReport, type CensusReport } from "../census/census-report.ts";
import { serializeTest262Record } from "../census/test262-record.ts";
import { serializeTypeScriptRecord, type TypeScriptObservation } from "../census/typescript-record.ts";
import { testScratch } from "../gate/test-scratch.ts";
import { benchmarkSummary, conformanceSummary } from "./summary.ts";

const SUMMARY = fileURLToPath(new URL("./summary.ts", import.meta.url));
const current = "a".repeat(40), older = "c".repeat(40), digest = "b".repeat(64);
const ok = (nanoseconds: number, spread = 1): Cell =>
  ({ status: "OK", nanoseconds, spread, checksum: "4000000000000000", verified: true, reason: null, details: null });
const legacy = (nanoseconds: number): Cell =>
  ({ status: "OK", nanoseconds, spread: null, checksum: null, verified: false, reason: "Historical checksum or spread was not retained", details: null });
const absent = (status: Exclude<Cell["status"], "OK">, reason: string): Cell =>
  ({ status, nanoseconds: null, spread: null, checksum: null, verified: false, reason, details: null });
const row = (name: string, cells: Record<string, Cell>, eligibleForBest = true) => ({
  name, workloadIdentity: eligibleForBest ? digest : null, eligibleForBest, conditions: { spoiled: false },
  cells: Object.fromEntries(COLUMNS.map(column => [column, cells[column] ?? ok(100)])), verdicts: {},
});
const run = (label: string, at: string, compiler: string, rows: ReturnType<typeof row>[]): RunRecord => sealRun({
  schemaVersion: 1, id: `2026-11-0${at.slice(9, 10)}-${compiler.slice(0, 12)}-${label}`, startedAt: at, finishedAt: at,
  complete: true, inventory: rows.map(one => one.name), columns: [...COLUMNS], sourceCommit: compiler,
  compiler: { commit: compiler, sha256: digest },
  harness: { identity: digest, contract: "opaque-bit-input-v1", files: [{ path: "loop.ts", sha256: digest }] },
  machine: { identity: "host-core-4", conditions: { cpu: 4, sibling: 5, load: [0.5, 0.75, 1] } },
  comparators: Object.fromEntries(COMPARATORS.map(name => [name, name === "ScriptC" ? null : { version: "v26.13.0", commit: null, sha256: digest, command: [name] }])),
  verdictPolicy: POLICY, provenance: { kind: "fixture" }, rows,
});
/**
 * Two complete runs: the newer is the one shown, the older holds some of the
 * own bests. Between them, every verdict kind, both trailing flags, an own
 * best far behind, just behind and just within the bound, a legacy time, and
 * reasons a page must escape.
 */
function runs(): RunRecord[] {
  const earlier = run("earlier", "2026-11-01T12:00:00.000Z", older, [
    row("fast", { "nts C": ok(40), "nts LLVM": ok(130) }),
    row("gaps", { "nts C": ok(30), "nts LLVM": ok(47), "nts JVM": ok(88) }),
    row("legacy", {}, false),
  ]);
  const newest = run("newest", "2026-11-02T12:00:00.000Z", current, [
    row("legacy", { "nts C": legacy(100), "nts LLVM": ok(50) }, false),
    row("fast", {
      "nts C": ok(80), "nts LLVM": ok(120), "nts JVM": ok(300), "C++": ok(70), Java: ok(250), "Bun AOT": ok(100, 1.2),
    }),
    row("gaps", {
      "nts C": absent("REFUSED", "NTS1001 a shape | with a pipe\nand a second line"), "nts LLVM": ok(50), "nts JVM": ok(90),
      "C++": ok(45), Java: absent("NOT_PROVIDED", "no Java reference"), "Bun JIT": ok(70), "Bun AOT": ok(60),
      ScriptC: absent("NOT_PROVIDED", "ScriptC refused it"),
    }),
  ]);
  return [earlier, newest];
}
/** The runs published into a tree, by the publisher nts-bench uses. */
function publish(root: string): string {
  for (const one of runs()) publishRun(root, one, false);
  return root;
}
const benchmarkTree = (t: { after(fn: () => void): void }) => publish(testScratch(t, "summary-benchmarks"));

/**
 * The fixture's page, as main's renderer drew it before full.md and the
 * summary shared one model (a64d4a137). It changes only with a deliberate
 * change to the page, which re-renders full.md in the same commit.
 */
const GOLDEN = [
  "# Benchmark results",
  "",
  "Newest complete run: [2026-11-02-aaaaaaaaaaaa-newest](runs/2026-11-02-aaaaaaaaaaaa-newest.json). Compiler aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; source aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa. Harness bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; contract opaque-bit-input-v1. Verdict policy v1, [The bar](../../docs/README.md#the-bar).",
  "",
  "- **nts C**: node: 1 SHORT, 1 WON, 1 UNAVAILABLE; Bun JIT: 1 SHORT, 1 WON, 1 UNAVAILABLE; Bun AOT: 1 TIE, 1 WON, 1 UNAVAILABLE; ScriptC: 1 TIE, 1 WON, 1 UNAVAILABLE.",
  "- **nts LLVM**: node: 2 WON, 1 LOSS; Bun JIT: 2 WON, 1 LOSS; Bun AOT: 2 WON, 1 TIE; ScriptC: 1 WON, 1 LOSS, 1 NOT_COMPARABLE.",
  "- **nts JVM**: node: 2 SHORT, 1 LOSS; Bun JIT: 1 SHORT, 2 LOSS; Bun AOT: 1 TIE, 2 LOSS; ScriptC: 1 TIE, 1 LOSS, 1 NOT_COMPARABLE.",
  "",
  "Conditions: {\"cpu\":4,\"sibling\":5,\"load\":[0.5,0.75,1]}. Per-row conditions and sibling samples are retained in the run JSON. All ratios are within this run. Each backend is held separately to the bar: node and Bun JIT require 0.80×; Bun AOT/ScriptC ties use max(1.05, the two cells' observed spread). A refusal is not a timing.",
  "",
  "Own-best values are per backend, using compatible machine, workload/input and harness contracts. Unknown historical identities and invalid cells are excluded. A slower-than-best flag is a cross-run observation with provenance, beside the current value. Historical runs with unknown completion times sort by the date recorded in their filename.",
  "",
  "| Case | nts C | nts LLVM | nts JVM | C++ | Java | node | Bun JIT | Bun AOT | ScriptC | nts C/node | nts C/Bun JIT | nts C/Bun AOT | nts C/ScriptC | nts LLVM/node | nts LLVM/Bun JIT | nts LLVM/Bun AOT | nts LLVM/ScriptC | LLVM versus C | nts C own best | nts LLVM own best | nts JVM own best |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  "|fast|80.0 ns|120.0 ns|300.0 ns|70.0 ns|250.0 ns|100.0 ns|100.0 ns|100.0 ns|100.0 ns|0.800× WON|0.800× WON|0.800× WON|0.800× WON|1.200× LOSS|1.200× LOSS|1.200× TIE|1.200× LOSS|1.500× **LLVM TRAILS C**|40.0 ns; cccccccccccccccccccccccccccccccccccccccc; [2026-11-01-cccccccccccc-earlier](runs/2026-11-01-cccccccccccc-earlier.json) **SLOWER THAN BEST**|120.0 ns; aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; [2026-11-02-aaaaaaaaaaaa-newest](runs/2026-11-02-aaaaaaaaaaaa-newest.json)|100.0 ns; cccccccccccccccccccccccccccccccccccccccc; [2026-11-01-cccccccccccc-earlier](runs/2026-11-01-cccccccccccc-earlier.json) **SLOWER THAN BEST**|",
  "|gaps|REFUSED|50.0 ns|90.0 ns|45.0 ns|NOT_PROVIDED|100.0 ns|70.0 ns|60.0 ns|NOT_PROVIDED|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|UNAVAILABLE|0.500× WON|0.714× WON|0.833× WON|NOT_COMPARABLE|unavailable|30.0 ns; cccccccccccccccccccccccccccccccccccccccc; [2026-11-01-cccccccccccc-earlier](runs/2026-11-01-cccccccccccc-earlier.json)|47.0 ns; cccccccccccccccccccccccccccccccccccccccc; [2026-11-01-cccccccccccc-earlier](runs/2026-11-01-cccccccccccc-earlier.json) **SLOWER THAN BEST**|88.0 ns; cccccccccccccccccccccccccccccccccccccccc; [2026-11-01-cccccccccccc-earlier](runs/2026-11-01-cccccccccccc-earlier.json)|",
  "|legacy|100.0 ns (legacy unverified)|50.0 ns|100.0 ns|100.0 ns|100.0 ns|100.0 ns|100.0 ns|100.0 ns|100.0 ns|1.000× SHORT|1.000× SHORT|1.000× TIE|1.000× TIE|0.500× WON|0.500× WON|0.500× WON|0.500× WON|0.500× **C TRAILS LLVM**|not established|not established|not established|",
  "",
  "- gaps, nts C: REFUSED: NTS1001 a shape \\| with a pipe and a second line",
  "- gaps, Java: NOT_PROVIDED: no Java reference",
  "- gaps, ScriptC: NOT_PROVIDED: ScriptC refused it",
  "",
].join("\n");

test("full.md renders as it did before it shared its model with the summary", () => {
  assert.equal(renderFull(runs()), GOLDEN);
});

test("the benchmark summary is the newest complete run, from the model full.md renders", t => {
  const root = benchmarkTree(t), summary = benchmarkSummary(root);
  assert.deepEqual([summary.version, summary.kind, summary.read], [1, "benchmarks", { root, commit: null }]);
  assert.ok(Number.isFinite(Date.parse(summary.at)) && summary.at === new Date(summary.at).toISOString(), summary.at);
  const newest = "2026-11-02-aaaaaaaaaaaa-newest";
  assert.deepEqual(summary.run, {
    id: newest, file: `results/benchmarks/runs/${newest}.json`, startedAt: "2026-11-02T12:00:00.000Z", finishedAt: "2026-11-02T12:00:00.000Z",
    sourceCommit: current, compiler: { commit: current, sha256: digest }, harness: { identity: digest, contract: "opaque-bit-input-v1" },
    machine: { identity: "host-core-4", conditions: { cpu: 4, sibling: 5, load: [0.5, 0.75, 1] } },
    comparators: { node: { version: "v26.13.0", commit: null }, "Bun JIT": { version: "v26.13.0", commit: null }, "Bun AOT": { version: "v26.13.0", commit: null }, ScriptC: null },
    verdictPolicy: POLICY,
  });
  assert.deepEqual(summary.columns, { c: "nts C", llvm: "nts LLVM", jvm: "nts JVM" });
  assert.deepEqual(summary.rows.map(one => one.name), ["fast", "gaps", "legacy"]);
  const [fast, gaps, old] = summary.rows as [typeof summary.rows[0], typeof summary.rows[0], typeof summary.rows[0]];

  assert.deepEqual(fast.cells["nts C"], { status: "OK", nanoseconds: 80, spread: 1, verified: true, reason: null });
  assert.deepEqual(fast.backends.c.versus, {
    node: { kind: "WON", ratio: 0.8, tolerance: null }, "Bun JIT": { kind: "WON", ratio: 0.8, tolerance: null },
    "Bun AOT": { kind: "WON", ratio: 0.8, tolerance: 1.2 }, ScriptC: { kind: "WON", ratio: 0.8, tolerance: 1.05 },
  });
  assert.deepEqual(fast.backends.llvm.versus["Bun AOT"], { kind: "TIE", ratio: 1.2, tolerance: 1.2 });
  assert.deepEqual(fast.backends.c.references, { "C++": 80 / 70, Java: 80 / 250 });
  assert.deepEqual(fast.backends.jvm.references, { "C++": 300 / 70, Java: 300 / 250 });
  // C's best is the earlier run's, and today's time is past it; LLVM's best is today's.
  assert.deepEqual(fast.backends.c.ownBest, { nanoseconds: 40, spread: 1, compiler: older, run: "2026-11-01-cccccccccccc-earlier" });
  assert.equal(fast.backends.c.slowerThanBest, true);
  assert.deepEqual([fast.backends.llvm.ownBest?.run, fast.backends.llvm.slowerThanBest], [newest, false]);
  assert.deepEqual(fast.llvmVersusC, { ratio: 1.5, tolerance: 1, trailing: "llvm" });

  // A refused backend is UNAVAILABLE, a comparator without a time NOT_COMPARABLE, both without a ratio.
  assert.deepEqual(gaps.cells["nts C"], { status: "REFUSED", nanoseconds: null, spread: null, verified: false, reason: "NTS1001 a shape | with a pipe\nand a second line" });
  assert.deepEqual(gaps.backends.c.versus.node, { kind: "UNAVAILABLE", ratio: null, tolerance: null });
  assert.deepEqual(gaps.backends.llvm.versus.ScriptC, { kind: "NOT_COMPARABLE", ratio: null, tolerance: null });
  assert.deepEqual(gaps.backends.llvm.references, { "C++": 50 / 45, Java: null });
  assert.deepEqual(gaps.backends.c.references, { "C++": null, Java: null });
  assert.deepEqual([gaps.backends.c.ownBest?.nanoseconds, gaps.backends.c.slowerThanBest], [30, false]);
  // Slower than its best past max(1.05, either spread) is flagged, and within it is not.
  assert.deepEqual([gaps.backends.llvm.ownBest?.nanoseconds, gaps.backends.llvm.slowerThanBest], [47, true]);
  assert.deepEqual([gaps.backends.jvm.ownBest?.nanoseconds, gaps.backends.jvm.slowerThanBest], [88, false]);
  assert.equal(gaps.llvmVersusC, null);

  // A legacy time is unverified and has no own best; here C trails LLVM.
  assert.equal(old.cells["nts C"].verified, false);
  assert.deepEqual(Object.values(old.backends).map(one => one.ownBest), [null, null, null]);
  assert.deepEqual(old.llvmVersusC, { ratio: 0.5, tolerance: 1, trailing: "c" });

  const model = results(runs())!;
  assert.deepEqual(summary.counts, { c: model.counts["nts C"], llvm: model.counts["nts LLVM"], jvm: model.counts["nts JVM"] });
});

test("the page and the summary say the same thing: every count, verdict and ratio full.md prints is the summary's", t => {
  const summary = benchmarkSummary(benchmarkTree(t)), page = renderFull(runs()).split("\n");
  const ids = { "nts C": "c", "nts LLVM": "llvm", "nts JVM": "jvm" } as const;
  for (const column of BACKENDS) {
    const counts = summary.counts![ids[column]]!;
    const line = COMPARATORS.map(name => `${name}: ${Object.entries(counts[name]).map(([kind, n]) => `${n} ${kind}`).join(", ")}`).join("; ");
    assert.ok(page.includes(`- **${column}**: ${line}.`), column);
  }
  for (const one of summary.rows) {
    const cells = page.find(line => line.startsWith(`|${one.name}|`))!.split("|").slice(2, -1);
    const verdicts = (["c", "llvm"] as const).flatMap(backend => COMPARATORS.map(name => {
      const { kind, ratio } = one.backends[backend].versus[name];
      return (ratio === null ? "" : `${ratio.toFixed(3)}× `) + kind;
    }));
    assert.deepEqual(cells.slice(COLUMNS.length, COLUMNS.length + verdicts.length), verdicts, one.name);
    const versusC = one.llvmVersusC;
    const flag: Record<string, string> = { llvm: " **LLVM TRAILS C**", c: " **C TRAILS LLVM**" };
    assert.equal(cells[COLUMNS.length + verdicts.length], versusC === null ? "unavailable"
      : `${versusC.ratio.toFixed(3)}×${versusC.trailing === null ? "" : flag[versusC.trailing]}`, one.name);
    for (const [index, backend] of (["c", "llvm", "jvm"] as const).entries()) {
      const best = one.backends[backend], shown = cells[COLUMNS.length + verdicts.length + 1 + index]!;
      assert.equal(shown === "not established", best.ownBest === null, `${one.name} ${backend}`);
      assert.equal(shown.endsWith(" **SLOWER THAN BEST**"), best.slowerThanBest, `${one.name} ${backend}`);
    }
  }
});

/** Every leaf of a summary, by where it is, apart from a run's own conditions, which its producer shapes. */
function leaves(value: unknown, at = "$"): [string, unknown][] {
  if (value === null || typeof value !== "object") return [[at, value]];
  return Object.entries(value).flatMap(([key, one]) => at === "$.run.machine" && key === "conditions" ? [] : leaves(one, `${at}.${key}`));
}

test("numbers are numbers: no time, ratio or count is text", t => {
  for (const summary of [benchmarkSummary(benchmarkTree(t)), conformanceSummary(conformanceTree(t))]) {
    const all = leaves(summary);
    const texts = all.filter(([, value]) => typeof value === "string" && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$|\d\s*(?:ns|µs|ms)\b|×/.test(value));
    assert.deepEqual(texts, [], `${summary.kind}: numbers rendered as text`);
    assert.equal(summary.version, 1);
    const measures = all.filter(([at]) => /\.(nanoseconds|spread|ratio|tolerance|references\.(C\+\+|Java))$/.test(at));
    const counts = all.filter(([at]) => /\.counts\.[^.]+\.[^.]+\.[^.]+$|\.outcomes\.[^.]+$|\.(cases|pending)$/.test(at));
    assert.ok(measures.length + counts.length > 20, `${summary.kind}: the walk found its numbers`);
    for (const [at, value] of measures) assert.ok(value === null || typeof value === "number" && Number.isFinite(value), `${at}: ${JSON.stringify(value)}`);
    for (const [at, value] of counts) assert.ok(Number.isSafeInteger(value) && (value as number) >= 0, `${at}: a count is an integer: ${JSON.stringify(value)}`);
  }
});

const commit = "7e".repeat(20), compiler = "e".repeat(16), harness = "f".repeat(16);
/** Where a backend's test262 slice is recorded, as all.sh's test262 steps name it. */
const test262Record = (backend: string, slice: string) => `results/test262/${backend}/${slice}.tsv`;
const refused: TypeScriptObservation = { kind: "refused", diagnostics: [{ code: "NTS1001", where: "body" }] };
/**
 * One record of each kind, each with one case recorded and, where its kind
 * has them, one pending: test262 on C and LLVM, the TypeScript cases and the
 * compile records on every backend, and the JVM's run and dex records.
 */
function conformanceTree(t: { after(fn: () => void): void }): string {
  const root = testScratch(t, "summary-conformance");
  const put = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const test262 = (backend: string, slice: string, under: string, rows: { path: string; outcome: "pass" | "fail"; detail: string }[]) =>
    put(test262Record(backend, slice), serializeTest262Record({ under, compiler, commit, backend, harness, machine: "fixture", jobs: 1 }, rows));
  test262("c", "language", "test/language", [
    { path: "test/language/a.js", outcome: "pass", detail: "" }, { path: "test/language/b.js", outcome: "fail", detail: "nts: uncaught Test262Error: #1" }]);
  test262("c", "annexb", "test/annexB", [{ path: "test/annexB/c.js", outcome: "pass", detail: "" }]);
  test262("llvm", "language", "test/language", [{ path: "test/language/a.js", outcome: "pass", detail: "" }]);
  // The cases themselves, whose front matter says who judges each: b.js is a parse negative, which only the frontend decides.
  put("third_party/test262/test/language/a.js", "/*---\nfeatures: []\n---*/\nassert.sameValue(1, 1);\n");
  put("third_party/test262/test/language/b.js", "/*---\nnegative:\n  type: SyntaxError\n  phase: parse\n---*/\n$DONOTEVALUATE();\nvar a\\u0061;\n");
  put("third_party/test262/test/annexB/c.js", "/*---\nnegative:\n  phase: runtime\n  type: Test262Error\n---*/\nthrow new Test262Error();\n");
  for (const name of ["recorded", "new"]) put(`tests/typescript/family/${name}.ts`, "/*---\nfeatures: []\n---*/\nassert.sameValue(1, 1);\n");
  for (const name of ["recorded", "new"]) put(`benchmarks/cases/${name}/case.ts`, "export function run(): number { return 1; }\n");
  put("tests/programs/recorded/tsconfig.json", '{"files":["src/main.ts"]}\n');
  put("tests/programs/recorded/src/main.ts", "export function work(n: number): number { return n; }\n");
  const compiled: Record<string, BenchmarkOutcome> = { c: { kind: "pass" }, llvm: { kind: "refused", diagnostic: "NTS1001 a shape" }, jvm: { kind: "timeout", stage: "compile" } };
  for (const backend of ["c", "llvm", "jvm"] as const) {
    put(`results/typescript/${backend}/cases.tsv`, serializeTypeScriptRecord({
      metadata: { version: 3, backend, commit, compiler, harness, under: "tests/typescript" },
      cases: new Map([["tests/typescript/family/recorded.ts", backend === "c" ? { kind: "pass" } : refused]]) }));
    put(compileRecordPath(backend), serializeBenchmarkRecord({
      metadata: { version: 1, backend, commit, compiler, harness, under: "benchmarks/cases", scopes: ["compile"] },
      rows: [{ path: "benchmarks/cases/recorded", scope: "compile", source: "1".repeat(64), driver: "2".repeat(64), outcome: compiled[backend]! }] }));
  }
  put(runsRecord("jvm"), serializeRunRecord({ metadata: { version: 1, backend: "jvm", commit, compiler, under: "benchmarks/cases" },
    rows: new Map([["benchmarks/cases/recorded", { kind: "agrees" }]]) }));
  put(DEX_RECORD, dexRecord(null, [{ path: "benchmarks/cases/recorded", value: { outcome: { kind: "pass" } } },
    { path: "tests/programs/recorded", value: { outcome: { kind: "build-failure", diagnostic: "Illegal class file" } } }]));
  return root;
}

test("the conformance summary counts each backend's records by outcome, with what is pending", t => {
  const root = conformanceTree(t), summary = conformanceSummary(root);
  assert.deepEqual([summary.version, summary.kind, summary.read], [1, "conformance", { root, commit: null }]);
  const slice = (backend: string, name: string, under: string, outcomes: Record<string, number>) => ({
    file: test262Record(backend, name), under, commit, compiler, harness, cases: Object.values(outcomes).reduce((a, b) => a + b), outcomes });
  const typescript = (backend: string, outcomes: Record<string, number>) => ({
    file: `results/typescript/${backend}/cases.tsv`, version: 3, commit, compiler, harness, under: "tests/typescript", cases: 1, outcomes, pending: 1 });
  const benchmarks = (backend: "c" | "llvm" | "jvm", outcomes: Record<string, number>) => ({
    file: compileRecordPath(backend), version: 1, commit, compiler, harness, under: "benchmarks/cases",
    scopes: { compile: { cases: 1, outcomes } }, pending: 1 });
  assert.deepEqual(summary.backends, {
    c: {
      test262: { cases: 3, outcomes: { fail: 1, pass: 2 }, runtime: { cases: 2, outcomes: { pass: 2 } }, frontend: { cases: 1, outcomes: { fail: 1 } }, slices: {
        annexb: slice("c", "annexb", "test/annexB", { pass: 1 }), language: slice("c", "language", "test/language", { fail: 1, pass: 1 }) } },
      typescript: typescript("c", { pass: 1 }),
      benchmarks: benchmarks("c", { pass: 1 }),
    },
    llvm: {
      test262: { cases: 1, outcomes: { pass: 1 }, runtime: { cases: 1, outcomes: { pass: 1 } }, frontend: { cases: 0, outcomes: {} },
        slices: { language: slice("llvm", "language", "test/language", { pass: 1 }) } },
      typescript: typescript("llvm", { refused: 1 }),
      benchmarks: benchmarks("llvm", { refused: 1 }),
    },
    jvm: {
      typescript: typescript("jvm", { refused: 1 }),
      // An outcome kind, quoted as the data it is: test-timing.ts reads a bare `timeout:` as a deadline.
      benchmarks: benchmarks("jvm", { "timeout": 1 }),
      benchmarkRuns: { file: runsRecord("jvm"), version: 1, commit, compiler, under: "benchmarks/cases", cases: 1, outcomes: { agrees: 1 }, pending: 1 },
      dex: { file: DEX_RECORD, cases: 2, outcomes: { "build-failure": 1, pass: 1 }, pending: 1 },
    },
  });
});

test("without the test262 checkout, test262's records keep their totals and no split of who judges them", t => {
  const root = conformanceTree(t);
  rmSync(join(root, "third_party/test262"), { recursive: true });
  const { c } = conformanceSummary(root).backends;
  assert.deepEqual([c?.test262?.cases, c?.test262?.outcomes, "runtime" in (c?.test262 ?? {}), "frontend" in (c?.test262 ?? {})], [3, { fail: 1, pass: 2 }, false, false]);
});

test("a record filed under another backend's name, or one that does not parse, is an error, not a summary", t => {
  const root = conformanceTree(t);
  writeFileSync(join(root, test262Record("llvm", "language")), readFileSync(join(root, test262Record("c", "annexb")), "utf8"));
  assert.throws(() => conformanceSummary(root), /results\/test262\/llvm\/language.tsv records the c backend/);
  const broken = conformanceTree(t);
  writeFileSync(join(broken, DEX_RECORD), "# nts-dex-outcomes {\"version\":1}\ntests/programs/recorded\t{\"outcome\":{\"kind\":\"maybe\"}}\n");
  assert.throws(() => conformanceSummary(broken), /malformed dex row/);
});

/** Every file of a tree outside its .git, by path, for a byte-for-byte comparison. */
function files(root: string): Map<string, string> {
  return new Map(readdirSync(root, { withFileTypes: true, recursive: true }).filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name).slice(root.length + 1)).filter(path => !path.startsWith(".git/"))
    .map(path => [path, readFileSync(join(root, path), "utf8")]));
}
const command = (...args: string[]) => spawnSync(process.execPath, [SUMMARY, ...args], {env:testEnvironment(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** A census report of one directory on one backend, its parts adding up as the census's do. */
function censusReport(backend: string, under: string, pass: number, refused: number, sloppy: number): CensusReport {
  return {
    version: 1, under, backend, pin: "1".repeat(40), compiler, commit, harness, degraded: backend === "llvm",
    selected: pass + refused + sloppy + 1, cases: pass + refused + sloppy + (backend === "c" ? 1 : 0), attempted: pass + refused + (backend === "c" ? 1 : 0),
    outcomes: { pass, fail: backend === "c" ? 1 : 0, refused, unsupported: sloppy, "no-verdict": 0 },
    inScope: { cases: pass + refused + (backend === "c" ? 1 : 0), pass }, excluded: sloppy, negativesAccepted: backend === "c" ? 1 : 0,
    notAttempted: sloppy ? { "scope:initial-lane:no-strict": sloppy } : {}, refused: refused ? { "lowering (NTS1xxx)": refused } : {},
  };
}

/** The full check's state, its last green wide run at `run`, as tooling/full-check/state.ts writes it. */
function fullCheckState(t: { after(fn: () => void): void }, run: string | null): string {
  const file = join(testScratch(t, "summary-full-check"), "state.json");
  const green = { commit: "6".repeat(40), run, verdict: "green", at: "2026-11-11T03:00:01.023Z", failed: [], listed: { pending: 0, accepted: 0 } };
  writeFileSync(file, JSON.stringify({ version: 1, core: {}, wide: run ? { last_run: green, last_green: green } : {}, culprits: [], probes: [], tasks: [] }));
  return file;
}

test("the whole suite is the census reports of the full check's last green wide run, with the directories none covers", t => {
  const root = conformanceTree(t), run = testScratch(t, "summary-wide-run");
  // A directory no census runs, counted as the inventory counts: a module's fixture is no test.
  for (const name of ["d.js", "e.js", "f_FIXTURE.js"]) mkdirSync(join(root, "third_party/test262/test/intl402"), { recursive: true }), writeFileSync(join(root, "third_party/test262/test/intl402", name), "");
  const reports = { c: { language: censusReport("c", "test/language", 2, 5, 3), annexb: censusReport("c", "test/annexB", 1, 0, 4) }, llvm: { language: censusReport("llvm", "test/language", 1, 5, 3) } };
  for (const [backend, slices] of Object.entries(reports)) for (const [slice, report] of Object.entries(slices)) writeCensusReport(censusReportPath(run, backend, slice), report);
  const { census } = conformanceSummary(root, { fullCheck: fullCheckState(t, run) });
  assert.deepEqual(census, {
    run, commit: "6".repeat(40), at: "2026-11-11T03:00:01.023Z",
    backends: {
      c: {
        selected: 17, cases: 17, attempted: 10, outcomes: { pass: 3, fail: 2, refused: 5, unsupported: 7, "no-verdict": 0 },
        inScope: { cases: 10, pass: 3 }, excluded: 7, negativesAccepted: 2,
        notAttempted: { "scope:initial-lane:no-strict": 7 }, refused: { "lowering (NTS1xxx)": 5 }, degraded: false,
        slices: { language: { file: censusReportPath(run, "c", "language"), ...reports.c.language }, annexb: { file: censusReportPath(run, "c", "annexb"), ...reports.c.annexb } },
      },
      llvm: {
        selected: 10, cases: 9, attempted: 6, outcomes: { pass: 1, fail: 0, refused: 5, unsupported: 3, "no-verdict": 0 },
        inScope: { cases: 6, pass: 1 }, excluded: 3, negativesAccepted: 0,
        notAttempted: { "scope:initial-lane:no-strict": 3 }, refused: { "lowering (NTS1xxx)": 5 }, degraded: true,
        slices: { language: { file: censusReportPath(run, "llvm", "language"), ...reports.llvm.language } },
      },
    },
    unmeasured: { "test/intl402": 2 },
  });
});

test("without a green wide run that kept a report there is no census part, and a report of another directory is an error", t => {
  const root = conformanceTree(t), run = testScratch(t, "summary-wide-run");
  assert.ok(!("census" in conformanceSummary(root)), "a caller that names no full check reads only the tree");
  assert.ok(!("census" in conformanceSummary(root, { fullCheck: fullCheckState(t, null) })), "no green wide run");
  assert.ok(!("census" in conformanceSummary(root, { fullCheck: fullCheckState(t, run) })), "a green wide run with no report");
  assert.ok(!("census" in conformanceSummary(root, { fullCheck: join(run, "absent.json") })), "no full-check state at all");
  writeCensusReport(censusReportPath(run, "jvm", "harness"), censusReport("jvm", "test/staging", 1, 1, 1));
  assert.throws(() => conformanceSummary(root, { fullCheck: fullCheckState(t, run) }), /jvm\/harness\.json reports test\/staging on jvm/);
});

test("the command prints one summary, writes nothing, and names the commit of a checkout it reads", t => {
  const root = publish(conformanceTree(t));
  const git = (...args: string[]) => {
    const done = spawnSync("git", ["-c", "user.name=summary", "-c", "user.email=summary@example.invalid", "-c", "commit.gpgsign=false", ...args], {env:testEnvironment(), cwd: root, encoding: "utf8" });
    assert.equal(done.status, 0, done.stderr);
    return done.stdout.trim();
  };
  git("init", "-q"); git("add", "."); git("commit", "-qm", "records");
  const head = git("rev-parse", "HEAD"), before = files(root);
  for (const [kind, expected] of [["benchmarks", benchmarkSummary(root)], ["conformance", conformanceSummary(root)]] as const) {
    const printed = command(kind, "--root", root, "--full-check", join(testScratch(t, "summary-no-full-check"), "state.json"));
    assert.equal(printed.status, 0, printed.stderr);
    assert.equal(printed.stderr, "");
    // The same summary, but for when it was read.
    const { at, ...summary } = JSON.parse(printed.stdout), { at: _, ...same } = expected;
    assert.ok(Date.parse(at) >= Date.parse(expected.at), at);
    assert.deepEqual(summary, same);
    assert.equal(summary.read.commit, head);
  }
  assert.deepEqual(files(root), before, "a summary wrote into the tree it read");
  for (const args of [[], ["records"], ["benchmarks", "--root"], ["conformance", "extra"], ["conformance", "--full-check"], ["conformance", "--root", root, "--root", root]]) {
    assert.equal(command(...args).status, 2, args.join(" "));
  }
  const backend = "jvm";
  writeFileSync(join(root, `results/typescript/${backend}/cases.tsv`), "not a record\n");
  const failed = command("conformance", "--root", root);
  assert.deepEqual([failed.status, failed.stdout], [1, ""]);
  assert.match(failed.stderr, /TypeScript record header/);
});
