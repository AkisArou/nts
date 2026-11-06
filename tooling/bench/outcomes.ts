/** Correctness records are distinct from benchmark timing run records. */
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { parseLineRecord, serializeLineRecord, type LineRecordFormat } from "../census/line-record.ts";
import { stableBuildDiagnostic, type Backend } from "../census/typescript-record.ts";
import { outcomeDisposition, outcomeTransition, type OutcomeTransition } from "../conformance/outcome-transition.ts";

export const BENCHMARK_SCOPES = ["compile", "scalar", "workload"] as const;
export type BenchmarkScope = typeof BENCHMARK_SCOPES[number];
export type BenchmarkOutcome =
  | { kind: "pass" }
  | { kind: "refused"; diagnostic: string }
  | { kind: "build-failure"; stage: "emit" | "link" | "compiler-crash"; diagnostic: string }
  | { kind: "wrong"; node: string; compiled: string }
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
      assert.ok(!/toolchain did not survive|SIG(?:KILL|TERM|SEGV|ABRT)|out of memory|memory limit|timed out/i.test(diagnostic), "an infrastructure or resource stop cannot be recorded");
      return { kind: "build-failure", stage: choice(row.stage, ["emit", "link", "compiler-crash"]), diagnostic: stableBuildDiagnostic(diagnostic) };
    }
    case "wrong": {
      keys(row, ["kind", "node", "compiled"]);
      const node = text(row.node), compiled = text(row.compiled);
      assert.notEqual(node, compiled, "a wrong-answer record needs different answers");
      return { kind: "wrong", node, compiled };
    }
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

/** Metadata's compiler is provenance, never a row-validity key. */
export function assertBenchmarkInventory(record: BenchmarkRecord, expected: readonly Pick<BenchmarkRow, "path" | "scope" | "source" | "driver">[]): void {
  const current = new Map(expected.map(row => [benchmarkKey(row), row]));
  assert.equal(current.size, expected.length, "duplicate benchmark inventory member");
  assert.equal(current.size, record.rows.length, "benchmark record population changed; re-record all affected cases");
  for (const row of record.rows) {
    const now = current.get(benchmarkKey(row)); assert.ok(now, `recorded benchmark scope gone missing: ${row.path} ${row.scope}`);
    assert.equal(now.source, row.source, `benchmark source changed: ${row.path}`);
    assert.equal(now.driver, row.driver, `benchmark driver changed: ${row.path} ${row.scope}`);
  }
}

export function compareBenchmarkOutcome(before: BenchmarkOutcome, after: BenchmarkOutcome): OutcomeTransition {
  const unchanged = isDeepStrictEqual(parseBenchmarkOutcome(before), parseBenchmarkOutcome(after));
  if (before.kind === "no-scalar-exports" || after.kind === "no-scalar-exports")
    return { word: unchanged ? "reproduces" : "CHANGED", ok: unchanged, loud: !unchanged };
  const result = outcomeTransition(outcomeDisposition(before.kind), outcomeDisposition(after.kind), unchanged);
  return { ...result, ok: unchanged };
}
