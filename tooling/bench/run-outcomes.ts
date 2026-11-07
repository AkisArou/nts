// How each benchmark runs on each backend: bench-agree's record, one row per
// benchmark, results/benchmarks/<backend>/runs.tsv. Like the TypeScript records
// (docs/workflow.md, Records): a benchmark with no row is pending, not run at
// landing, and the full check writes its row after landing; a recorded outcome
// that reproduces passes, a loud defect included; one the shared ratchet accepts
// passes and is rewritten; anything else, getting worse first, is red.
//
// Rows are keyed by the benchmark alone: an edit that changes how a benchmark
// runs deletes its row in the same commit, which makes it pending. The header
// names the pin that first recorded it, as provenance only. The compile record
// beside it (outcomes.tsv) is a different scope with its own key.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { mergeLineRecord, parseLineRecord, serializeLineRecord, type LineRecordFormat } from "../census/line-record.ts";
import { outcomeDisposition, outcomeTransition, type OutcomeTransition } from "../conformance/outcome-transition.ts";
import { normalizeGeneratedNumbers, stableCheckText, stableRuntimeAbortOutput } from "../conformance/observation-text.ts";
import { inventory } from "../records/pending.ts";
import type { DecodedCheck } from "../differential/check-report-types.ts";

/** The backends bench-agree checks, and so records: the JVM, as it always has. */
export const BENCH_AGREE_BACKENDS = ["jvm"] as const;
export type RunBackend = "c" | "llvm" | "jvm";
export const runsRecord = (backend: RunBackend) => `results/benchmarks/${backend}/runs.tsv`;

export type BenchmarkRun =
  | { kind: "agrees" }
  | { kind: "no-scalar-exports" }
  | { kind: "refused"; diagnostic: string }
  | { kind: "aborted"; failure: string }
  | { kind: "invalid-hir"; validator: string }
  | { kind: "timeout"; stage: "compile" | "run" }
  | { kind: "wrong"; node: string; compiled: string };
export interface RunMetadata { version: 1; backend: RunBackend; commit: string; compiler: string; under: "benchmarks/cases" }
export interface RunRecord { metadata: RunMetadata; rows: Map<string, BenchmarkRun> }

function object(value: unknown): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "invalid benchmark run record object");
  return value as Record<string, unknown>;
}
function keys(row: Record<string, unknown>, names: readonly string[]): void {
  assert.deepEqual(Object.keys(row).sort(), [...names].sort(), "malformed benchmark run fields");
}
function text(value: unknown): string { assert.ok(typeof value === "string" && value.length > 0, "missing benchmark run observation"); return value; }

export function parseBenchmarkRun(value: unknown): BenchmarkRun {
  const row = object(value);
  switch (row.kind) {
    case "agrees": case "no-scalar-exports": keys(row, ["kind"]); return { kind: row.kind };
    case "refused": keys(row, ["kind", "diagnostic"]); return { kind: "refused", diagnostic: text(row.diagnostic) };
    case "aborted": keys(row, ["kind", "failure"]); return { kind: "aborted", failure: text(row.failure) };
    case "invalid-hir": keys(row, ["kind", "validator"]); return { kind: "invalid-hir", validator: text(row.validator) };
    case "timeout": {
      keys(row, ["kind", "stage"]);
      assert.ok(row.stage === "compile" || row.stage === "run", "a timeout is compiling or running");
      return { kind: "timeout", stage: row.stage };
    }
    case "wrong": {
      keys(row, ["kind", "node", "compiled"]);
      const node = text(row.node), compiled = text(row.compiled);
      assert.notEqual(node, compiled, "a wrong answer needs different answers");
      return { kind: "wrong", node, compiled };
    }
    default: throw new Error(`unrecordable benchmark run: ${String(row.kind)}`);
  }
}

const format: LineRecordFormat<RunMetadata, BenchmarkRun> = {
  prefix: "# nts-benchmark-runs ", label: "benchmark run",
  metadata(value) {
    const row = object(value); keys(row, ["version", "backend", "commit", "compiler", "under"]);
    assert.equal(row.version, 1, "unsupported benchmark run record version"); assert.equal(row.under, "benchmarks/cases");
    assert.ok(row.backend === "c" || row.backend === "llvm" || row.backend === "jvm", "unknown benchmark run backend");
    assert.match(text(row.commit), /^[0-9a-f]{40}$/, "a benchmark run record names its pin's commit");
    assert.match(text(row.compiler), /^[0-9a-f]{16}$/, "a benchmark run record names its pin's compiler");
    return { version: 1, backend: row.backend, commit: row.commit as string, compiler: row.compiler as string, under: "benchmarks/cases" };
  },
  row(path, value) {
    assert.match(path, /^benchmarks\/cases\/[A-Za-z0-9][A-Za-z0-9_.-]*$/, "invalid benchmark case path");
    return parseBenchmarkRun(value);
  },
  key: path => path,
};

export function parseRunRecord(contents: string): RunRecord {
  const parsed = parseLineRecord(contents, format);
  return { metadata: parsed.metadata, rows: new Map(parsed.rows.map(({ path, value }) => [path, value])) };
}
export function serializeRunRecord(record: RunRecord): string {
  return serializeLineRecord({ metadata: record.metadata, rows: [...record.rows].map(([path, value]) => ({ path, value })) }, format);
}
/** Write these rows into a record, every other line byte for byte. */
export function mergeRunRecord(contents: string, updates: ReadonlyMap<string, BenchmarkRun>): string {
  return mergeLineRecord(contents, [...updates].map(([path, value]) => ({ path, value })), format);
}

/** What a completed check says about how the benchmark runs, or null when it compared nothing it can record (no oracle record yet). */
export function benchmarkRun(record: DecodedCheck): BenchmarkRun | null {
  const report = record.report, refusal = (stage: string) => report?.refusals.find(one => one.stage === stage);
  const diagnostic = (one: { code: string; message: string } | undefined, otherwise: string) =>
    normalizeGeneratedNumbers(stableCheckText(one ? `${one.code} ${one.message}` : otherwise));
  switch (record.outcome) {
    case "pending": return null;
    case "agrees": case "agrees on what it compared": return { kind: "agrees" };
    case "nothing to check": return { kind: "no-scalar-exports" };
    case "timed out": return { kind: "timeout", stage: record.timeout!.stage };
    case "disagrees": {
      const first = report?.disagreements[0];
      assert.ok(first, "a disagreement without its answers cannot be recorded");
      return { kind: "wrong", node: first.node, compiled: first.compiled };
    }
    case "aborted": return { kind: "aborted", failure: stableRuntimeAbortOutput(report?.aborts[0] ?? report?.error?.message ?? record.first) };
    case "declined every case": return { kind: "aborted", failure: "the compiled program declined every case" };
    case "compiled bindings unavailable": return { kind: "refused", diagnostic: diagnostic(refusal("lowering"), "compiled bindings unavailable") };
    case "backend declined": return { kind: "refused", diagnostic: diagnostic(refusal("backend"), report?.error?.message ?? record.first) };
    case "does not typecheck": return { kind: "refused", diagnostic: diagnostic(refusal("typecheck"), report?.error?.message ?? record.first) };
    case "invalid HIR": return { kind: "invalid-hir", validator: normalizeGeneratedNumbers(stableCheckText(report?.error?.message ?? record.first)) };
    default: throw new Error(`a ${record.outcome} check is not a recordable run`);
  }
}

/** The shared ratchet over two runs of one benchmark. */
export function compareBenchmarkRun(before: BenchmarkRun, after: BenchmarkRun): OutcomeTransition {
  const unchanged = isDeepStrictEqual(before, after);
  // No scalar export is a fact about the benchmark's source, not a rank.
  if (before.kind === "no-scalar-exports" || after.kind === "no-scalar-exports") return { word: unchanged ? "reproduces" : "CHANGED", ok: unchanged, loud: !unchanged };
  return outcomeTransition(outcomeDisposition(before.kind), outcomeDisposition(after.kind), unchanged);
}

/** The benchmarks a record has no row for (pending), after refusing rows whose benchmark is gone. */
export function pendingRuns(record: RunRecord | null, benchmarks: readonly string[]): string[] {
  if (!record) return [...benchmarks].sort();
  const { pending, stale } = inventory(record.rows.keys(), benchmarks);
  for (const path of stale) assert.fail(`recorded benchmark gone missing: ${path}; the change that deletes a benchmark deletes its row`);
  return pending;
}
