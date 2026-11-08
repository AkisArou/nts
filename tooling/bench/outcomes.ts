/** Correctness records are distinct from benchmark timing run records. */
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { mergeLineRecord, parseLineRecord, serializeLineRecord, type LineRecordFormat } from "../census/line-record.ts";
import type { Backend } from "../census/typescript-record.ts";
import { compilerStopped, stableBuildDiagnostic } from "../conformance/compile-diagnostics.ts";
import { outcomeDisposition, outcomeTransition, type OutcomeTransition } from "../conformance/outcome-transition.ts";
import { inventory } from "../records/pending.ts";

export const BENCHMARK_SCOPES = ["compile", "scalar", "workload"] as const;
export type BenchmarkScope = typeof BENCHMARK_SCOPES[number];
export type BenchmarkOutcome =
  | { kind: "pass" }
  | { kind: "refused"; diagnostic: string }
  | { kind: "build-failure"; stage: "emit" | "link" | "compiler-crash"; diagnostic: string }
  | { kind: "wrong"; node: string; compiled: string }
  | { kind: "timeout"; stage: "compile" | "run" }
  | { kind: "no-scalar-exports" };
export interface BenchmarkCell { scope: BenchmarkScope; source: string; driver: string; outcome: BenchmarkOutcome; }
export interface BenchmarkRow extends BenchmarkCell { path: string; }
export interface BenchmarkMetadata {
  version: 1; backend: Backend; commit: string; compiler: string; harness: string; under: "benchmarks/cases";
  scopes: BenchmarkScope[];
}
export interface BenchmarkRecord { metadata: BenchmarkMetadata; rows: BenchmarkRow[]; }

function object(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "invalid benchmark record object");
  return value as Record<string, unknown>;
}
function keys(row: Record<string, unknown>, names: readonly string[]): void {
  assert.deepEqual(Object.keys(row).sort(), [...names].sort(), "malformed benchmark record fields");
}
function text(value: unknown): string { assert.ok(typeof value === "string" && value.length > 0, "missing benchmark observation"); return value; }
function digest(value: unknown, length: number): string {
  const result = text(value); assert.match(result, new RegExp(`^[0-9a-f]{${length}}$`), "invalid benchmark identity"); return result;
}
function choice<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  assert.ok(typeof value === "string" && values.includes(value), `unknown benchmark value: ${String(value)}`);
  return value as T[number];
}

export function parseBenchmarkOutcome(value: unknown): BenchmarkOutcome {
  const row = object(value);
  switch (row.kind) {
    case "pass": case "no-scalar-exports": keys(row, ["kind"]); return { kind: row.kind };
    case "refused": keys(row, ["kind", "diagnostic"]); return { kind: "refused", diagnostic: stableBuildDiagnostic(text(row.diagnostic)) };
    case "build-failure": {
      keys(row, ["kind", "stage", "diagnostic"]);
      const diagnostic = text(row.diagnostic);
      assert.ok(!/toolchain did not survive|out of memory|memory limit|timed out/i.test(diagnostic), "an infrastructure or resource stop cannot be recorded");
      const signal = /\bSIG[A-Z0-9]+\b/.exec(diagnostic)?.[0];
      assert.ok(!signal || (row.stage === "compiler-crash" && compilerStopped(null, signal)), "an external or link-tool signal cannot be recorded");
      return { kind: "build-failure", stage: choice(row.stage, ["emit", "link", "compiler-crash"]), diagnostic: stableBuildDiagnostic(diagnostic) };
    }
    case "wrong": {
      keys(row, ["kind", "node", "compiled"]);
      const node = text(row.node), compiled = text(row.compiled);
      assert.notEqual(node, compiled, "a wrong-answer record needs different answers");
      return { kind: "wrong", node, compiled };
    }
    case "timeout": keys(row, ["kind", "stage"]); return { kind: "timeout", stage: choice(row.stage, ["compile", "run"]) };
    default: throw new Error(`unrecordable benchmark outcome: ${String(row.kind)}`);
  }
}

export const benchmarkKey = (row: Pick<BenchmarkRow, "path" | "scope">): string => `${row.path}\0${row.scope}`;
const format: LineRecordFormat<BenchmarkMetadata, BenchmarkCell> = {
  prefix: "# nts-benchmark-outcomes ", label: "benchmark",
  metadata(value) {
    const row = object(value); keys(row, ["version", "backend", "commit", "compiler", "harness", "under", "scopes"]);
    assert.equal(row.version, 1, "unsupported benchmark outcome version"); assert.equal(row.under, "benchmarks/cases");
    assert.ok(Array.isArray(row.scopes) && row.scopes.length > 0, "benchmark coverage must name its scopes");
    const scopes = row.scopes.map(scope => choice(scope, BENCHMARK_SCOPES));
    assert.equal(new Set(scopes).size, scopes.length, "duplicate benchmark scope");
    return { version: 1, backend: choice(row.backend, ["c", "llvm", "jvm"]), commit: digest(row.commit, 40),
      compiler: digest(row.compiler, 16), harness: digest(row.harness, 16), under: "benchmarks/cases", scopes: BENCHMARK_SCOPES.filter(scope => scopes.includes(scope)) };
  },
  row(path, value, metadata) {
    assert.match(path, /^benchmarks\/cases\/[A-Za-z0-9][A-Za-z0-9_.-]*$/, "invalid benchmark case path");
    assert.ok(!path.split("/").some(part => part === "." || part === ".."), "invalid benchmark case path");
    const row = object(value); keys(row, ["scope", "source", "driver", "outcome"]);
    const scope = choice(row.scope, BENCHMARK_SCOPES), outcome = parseBenchmarkOutcome(row.outcome);
    assert.ok(metadata.scopes.includes(scope), `undeclared benchmark scope: ${scope}`);
    assert.ok(outcome.kind !== "no-scalar-exports" || scope === "scalar", "only scalar scope can have no scalar exports");
    assert.ok(scope !== "compile" || outcome.kind !== "wrong", "compilation cannot claim runtime agreement");
    assert.ok(scope !== "compile" || outcome.kind !== "timeout" || outcome.stage === "compile", "a compile can time out only compiling");
    return { scope, source: digest(row.source, 64), driver: digest(row.driver, 64), outcome };
  },
  key: (path, row) => benchmarkKey({ path, scope: row.scope }),
};

export function parseBenchmarkRecord(contents: string): BenchmarkRecord {
  const parsed = parseLineRecord(contents, format);
  const rows = parsed.rows.map(({ path, value }) => ({ path, ...value }));
  const byKey = new Map(rows.map(row => [benchmarkKey(row), row]));
  for (const row of rows) {
    for (const scope of parsed.metadata.scopes) assert.ok(byKey.has(benchmarkKey({ path: row.path, scope })), `missing ${scope} outcome: ${row.path}`);
    if (row.outcome.kind === "no-scalar-exports") {
      const workload = byKey.get(benchmarkKey({ path: row.path, scope: "workload" }))?.outcome;
      assert.ok(workload?.kind === "pass" || workload?.kind === "wrong", `no scalar exports needs a measured workload: ${row.path}`);
    }
  }
  return { metadata: parsed.metadata, rows };
}

export function requireBenchmarkScopes(record: BenchmarkRecord, scopes: readonly BenchmarkScope[]): void {
  for (const scope of scopes) assert.ok(record.metadata.scopes.includes(scope), `benchmark record does not cover ${scope}; record that scope first`);
}

export function serializeBenchmarkRecord(record: BenchmarkRecord): string {
  const contents = serializeLineRecord({ metadata: record.metadata, rows: record.rows.map(({ path, ...value }) => ({ path, value })) }, format);
  parseBenchmarkRecord(contents); return contents;
}

/** Write these rows into a record, every other line byte for byte. */
export function mergeBenchmarkRecord(contents: string, rows: readonly BenchmarkRow[]): string {
  const merged = mergeLineRecord(contents, rows.map(({ path, ...value }) => ({ path, value })), format);
  parseBenchmarkRecord(merged); return merged;
}

type Identity = Pick<BenchmarkRow, "path" | "scope" | "source" | "driver">;

/**
 * The cells a record has no row for yet: pending, recorded after landing. A
 * recorded cell whose case is gone, or whose source or driver changed, is an
 * error. Metadata's compiler is provenance, never a row-validity key.
 */
export function benchmarkInventory<T extends Identity>(record: BenchmarkRecord, expected: readonly T[]): T[] {
  const current = new Map(expected.map(row => [benchmarkKey(row), row]));
  assert.equal(current.size, expected.length, "duplicate benchmark inventory member");
  const recorded = new Map(record.rows.map(row => [benchmarkKey(row), row]));
  for (const key of inventory(recorded.keys(), current.keys()).stale) {
    const row = recorded.get(key)!;
    assert.fail(`recorded benchmark scope gone missing: ${row.path} ${row.scope}`);
  }
  for (const row of record.rows) {
    const now = current.get(benchmarkKey(row))!;
    assert.equal(now.source, row.source, `benchmark source changed: ${row.path}`);
    assert.equal(now.driver, row.driver, `benchmark driver changed: ${row.path} ${row.scope}`);
  }
  return expected.filter(row => !recorded.has(benchmarkKey(row)));
}

/** What the shared ratchet accepts passes: better (a pass now, a refusal where there was a defect, a build that fails where it built a wrong answer), or a refusal for other reasons. Any other movement fails. */
export function compareBenchmarkOutcome(before: BenchmarkOutcome, after: BenchmarkOutcome): OutcomeTransition {
  const unchanged = isDeepStrictEqual(parseBenchmarkOutcome(before), parseBenchmarkOutcome(after));
  if (before.kind === "no-scalar-exports" || after.kind === "no-scalar-exports")
    return { word: unchanged ? "reproduces" : "CHANGED", ok: unchanged, loud: !unchanged };
  return outcomeTransition(outcomeDisposition(before.kind), outcomeDisposition(after.kind), unchanged);
}

/** The compile record of one backend, relative to the repository. */
export const compileRecordPath = (backend: Backend): string => `results/benchmarks/${backend}/outcomes.tsv`;

/** The compile outcome a benchmark's row records on one backend, or null when it has no row yet (pending). */
export function recordedCompileOutcome(record: BenchmarkRecord, path: string): BenchmarkOutcome | null {
  requireBenchmarkScopes(record, ["compile"]);
  return record.rows.find(row => row.path === path && row.scope === "compile")?.outcome ?? null;
}

/**
 * A compile that timed out elsewhere (the dex step's emit-jvm is the same
 * compile), judged against the benchmark's row: a timeout the row records
 * reproduces; a row not written yet leaves it pending; any other row means the
 * compile got worse.
 */
export function judgeCompileTimeout(recorded: BenchmarkOutcome | null): "as recorded" | "pending" | "worse" {
  if (recorded === null) return "pending";
  return compareBenchmarkOutcome(recorded, { kind: "timeout", stage: "compile" }).word === "reproduces" ? "as recorded" : "worse";
}

/**
 * A compile that produced nothing elsewhere (the dex step's emit-jvm declined
 * the program, or emitted no class), judged against the benchmark's row: a row
 * that records no passing compile either holds it; a row not written yet
 * leaves it pending; a row that records a pass means the compile got worse.
 */
export function judgeCompileDecline(recorded: BenchmarkOutcome | null): "as recorded" | "pending" | "worse" {
  if (recorded === null) return "pending";
  return recorded.kind === "pass" ? "worse" : "as recorded";
}
