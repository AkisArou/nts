// Complete measured observations, distinct from the census's redacted rankings.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { outcomeDisposition, outcomeTransition, type OutcomeTransition } from "../conformance/outcome-transition.ts";
import { normalizeGeneratedNumbers, stableRuntimeAbortOutput } from "../conformance/observation-text.ts";

// Version 2 recognizes the TypeScript case body when classifying diagnostics.
// An older raw checkpoint must be remeasured, not resumed with stale locations.
export const TYPESCRIPT_OBSERVATIONS_VERSION = 2;

export type Backend = "c" | "llvm" | "jvm";
export interface RecordMetadata {
  version: 2;
  backend: Backend;
  commit: string;
  compiler: string;
  harness: string;
  under: string;
}
export interface RefusalDiagnostic { code: string; where: "body" | "harness" | "other" | "none"; }
export interface RuntimeFailure { exit: number | null; signal: string | null; output: string; }
export type TypeScriptObservation =
  | { kind: "pass" }
  | { kind: "wrong"; errorClass: string; failure: RuntimeFailure }
  | { kind: "refused"; diagnostics: RefusalDiagnostic[] }
  | { kind: "invalid-hir"; validator: string }
  | { kind: "runtime-abort"; failure: RuntimeFailure };
export interface TypeScriptRecord { metadata: RecordMetadata; cases: Map<string, TypeScriptObservation>; }
const prefix = "# nts-typescript-outcomes ";

function object(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), label);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label}: malformed fields`);
}
function text(value: unknown, label: string, empty = false): string {
  assert.ok(typeof value === "string" && (empty || value.length > 0), label);
  return value;
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  for (const member of allowed) if (value === member) return member;
  throw new Error(label);
}
function canonical(path: string, label: string): void {
  assert.ok(path.startsWith("tests/typescript/") && !/[\\\t\r\n\0]/.test(path) &&
    path.split("/").every(part => part !== "" && part !== "." && part !== ".."), label);
}
function metadata(value: unknown): RecordMetadata {
  const row = object(value, "missing TypeScript record metadata");
  keys(row, ["version", "backend", "commit", "compiler", "harness", "under"], "TypeScript record metadata");
  assert.equal(row.version, 2, "unsupported TypeScript record version");
  const backend = oneOf(row.backend, ["c", "llvm", "jvm"], "unknown TypeScript backend");
  const commit = text(row.commit, "missing compiler commit");
  assert.match(commit, /^[0-9a-f]{40}$/, "invalid compiler commit");
  const compiler = text(row.compiler, "missing compiler fingerprint");
  const harness = text(row.harness, "missing harness fingerprint");
  assert.match(compiler, /^[0-9a-f]{16}$/, "invalid compiler fingerprint");
  assert.match(harness, /^[0-9a-f]{16}$/, "invalid harness fingerprint");
  const under = text(row.under, "missing record selection");
  if (under !== "tests/typescript") canonical(under, "invalid record selection");
  return { version: 2, backend, commit, compiler, harness, under };
}
function runtimeFailure(value: unknown): RuntimeFailure {
  const row = object(value, "missing raw runtime observation");
  keys(row, ["exit", "signal", "output"], "runtime observation");
  assert.ok(row.exit === null || typeof row.exit === "number" && Number.isSafeInteger(row.exit) && row.exit >= 0,
    "invalid runtime exit status");
  assert.ok(row.signal === null || typeof row.signal === "string" && /^SIG[A-Z0-9]+$/.test(row.signal), "invalid runtime signal");
  assert.ok((row.exit === null) !== (row.signal === null), "runtime termination must name one exit status or signal");
  return { exit: row.exit, signal: row.signal, output: text(row.output, "invalid runtime output", true) };
}
function refusalDiagnostic(value: unknown): RefusalDiagnostic {
  const row = object(value, "invalid refusal diagnostic");
  keys(row, ["code", "where"], "refusal diagnostic");
  const code = text(row.code, "missing refusal code");
  assert.match(code, /^(?:NTS\d{4}|TS\d{4,5})$/, "invalid refusal code");
  return { code,
    where: oneOf(row.where, ["body", "harness", "other", "none"], "unknown refusal location") };
}

export function parseObservation(input: unknown): TypeScriptObservation {
  const row = object(input, "invalid TypeScript observation");
  switch (row.kind) {
    case "pass":
      keys(row, ["kind"], "pass observation");
      return { kind: "pass" };
    case "wrong":
      keys(row, ["kind", "errorClass", "failure"], "wrong observation");
      return { kind: "wrong", errorClass: text(row.errorClass, "missing thrown class"), failure: runtimeFailure(row.failure) };
    case "refused": {
      keys(row, ["kind", "diagnostics"], "refused observation");
      assert.ok(Array.isArray(row.diagnostics) && row.diagnostics.length > 0, "a refusal needs compiler diagnostics");
      const diagnostics = row.diagnostics.map(refusalDiagnostic);
      const identities = diagnostics.map(value => JSON.stringify(value));
      assert.equal(new Set(identities).size, identities.length, "duplicate refusal diagnostic");
      diagnostics.sort((a, b) => a.code.localeCompare(b.code, "en") || a.where.localeCompare(b.where, "en"));
      return { kind: "refused", diagnostics };
    }
    case "invalid-hir":
      keys(row, ["kind", "validator"], "validator observation");
      return { kind: "invalid-hir", validator: normalizeGeneratedNumbers(text(row.validator, "missing validator error")) };
    case "runtime-abort": {
      keys(row, ["kind", "failure"], "abort observation");
      const failure = runtimeFailure(row.failure);
      return { kind: "runtime-abort", failure: { ...failure, output: stableRuntimeAbortOutput(failure.output) } };
    }
    default: throw new Error(`unknown TypeScript observation kind: ${String(row.kind)}`);
  }
}

/** A timeout, oracle failure, missing row or tool failure cannot become an expected result. */
export function observationFromRow(input: unknown): TypeScriptObservation {
  const row = object(input, "case produced no measured row");
  switch (row.bucket) {
    case "strict-pass": return { kind: "pass" };
    case "threw": return parseObservation({ kind: "wrong", errorClass: row.thrown, failure: row.runtimeFailure });
    case "invalid-hir": return parseObservation({ kind: "invalid-hir", validator: row.validatorError });
    case "crash": return parseObservation({ kind: "runtime-abort", failure: row.runtimeFailure });
    case "unsupported": {
      assert.ok(row.why === "lowering" || row.why === "typescript" || row.why === "backend", `unmeasured case: ${String(row.why)}`);
      assert.ok(Array.isArray(row.diagnostics), "refusal has no diagnostics");
      // Codes and locations identify a refusal; its prose remains in raw rows
      // and rankings. Keep a cascade code when the compiler omitted its root.
      const observed = row.diagnostics.map(value => object(value, "invalid compiler diagnostic"))
        .map(value => refusalDiagnostic({ code: value.code, where: value.where }));
      const unique = new Map(observed.map(value => [JSON.stringify(value), value]));
      const diagnostics = [...unique].sort(([a], [b]) => a.localeCompare(b, "en")).map(([, value]) => value);
      return parseObservation({ kind: "refused", diagnostics });
    }
    default: throw new Error(`unmeasured case: ${String(row.bucket)} (${String(row.why ?? "")})`);
  }
}

export function parseTypeScriptRecord(contents: string): TypeScriptRecord {
  const lines = contents.split("\n");
  assert.ok(lines[0].startsWith(prefix), "missing versioned TypeScript record header; re-record the complete suite");
  const meta = metadata(JSON.parse(lines[0].slice(prefix.length)));
  const cases = new Map<string, TypeScriptObservation>();
  for (const line of lines.slice(1)) {
    if (line === "" || line.startsWith("#")) continue;
    const fields = line.split("\t");
    assert.equal(fields.length, 2, "malformed TypeScript record row");
    const [path, json] = fields;
    canonical(path, "invalid TypeScript case path");
    assert.ok(path.endsWith(".ts") && (path === meta.under || path.startsWith(meta.under + "/")), "case outside record selection");
    assert.ok(!cases.has(path), `duplicate recorded case: ${path}`);
    cases.set(path, parseObservation(JSON.parse(json)));
  }
  assert.ok(cases.size > 0, "an empty record measures nothing");
  return { metadata: meta, cases };
}

export function serializeTypeScriptRecord(record: TypeScriptRecord): string {
  const header = metadata(record.metadata);
  const lines = [...record.cases].sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([path, value]) => `${path}\t${JSON.stringify(parseObservation(value))}`);
  const result = prefix + JSON.stringify(header) + "\n" + lines.join("\n") + "\n";
  parseTypeScriptRecord(result);
  return result;
}

/** Check source identity before --recorded can narrow the executed population. */
export function assertRecordedInventory(record: TypeScriptRecord, sourcePaths: readonly string[]): void {
  const source = new Set(sourcePaths);
  assert.equal(source.size, sourcePaths.length, "duplicate source case");
  for (const path of source) assert.ok(record.cases.has(path), `new case has no record: ${path}`);
  for (const path of record.cases.keys()) assert.ok(source.has(path), `recorded case gone missing: ${path}`);
}

export function compareTypeScriptObservation(before: TypeScriptObservation, after: TypeScriptObservation): OutcomeTransition {
  return outcomeTransition(outcomeDisposition(before.kind), outcomeDisposition(after.kind), isDeepStrictEqual(before, after));
}
