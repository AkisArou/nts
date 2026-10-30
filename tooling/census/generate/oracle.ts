import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CHECK_STATUSES, FAILURE_KINDS, COUNT_NAMES } from "../../differential/check-report-types.ts";
import type { CheckReport } from "../../differential/check-report-types.ts";

/** The adapter inspects one unchanged whole program, including its controls. */
export interface OracleRequest {
  directory: string;
  source: string;
  cell: string;
  template: string;
  functions: {
    name: string;
    role: "subject" | "control" | "twin" | "context";
    /** Exact text after `// expect-ir: `, including the backend selector. */
    shortcut?: string;
    counterpart?: string;
  }[];
  backends: string[];
}

export interface ShortcutEvidence {
  expectation: string;
  status: "pass" | "fail" | "unresolved" | "not-measured";
  /** Output-relevant indexed/length use remains in candidate TS, even if folded. */
  use: "present" | "missing" | "not-measured";
}

export interface OracleResult {
  version: 1;
  failure: null | {
    /** `wrong-answer`, `abort`, `error:<CheckFailure.kind>`, or their sorted `+` join. */
    kind: string;
    /** Stable bug identity supplied by the adapter; excludes paths and source hashes. */
    signature: string;
    backends: string[];
  };
  backends: {
    backend: string;
    check: CheckReport;
    /**
     * Per-export projections of measurements of THIS WHOLE PROGRAM. Compiling a
     * control alone changes whole-program facts and is not admissible evidence.
     * Control-derived twins need rows too, carrying their control's shortcut.
     */
    controls: { name: string; check: CheckReport; shortcuts: ShortcutEvidence[] }[];
  }[];
}

export interface Oracle {
  evaluate(request: OracleRequest): Promise<OracleResult> | OracleResult;
}

/** Source-independent identity used while shrinking. Grouping adds a source hash. */
export interface FailureSignature {
  cell: string;
  template: string;
  kind: string;
  backends: string[];
  oracleSignature: string;
}

export type FindingAssessment =
  | { ok: true; signature: FailureSignature }
  | { ok: false; reason: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonempty);
}

function checkReport(value: unknown): value is CheckReport {
  if (!record(value) || value.version !== 1 || !CHECK_STATUSES.some(s => s === value.status)) return false;
  const counts = value.counts;
  if (counts !== null && (!record(counts) || !COUNT_NAMES.every(name => count(counts[name])))) return false;
  const oracle = value.oracle;
  if (oracle !== null && (!record(oracle) || !count(oracle.expected) || !count(oracle.received) || typeof oracle.complete !== "boolean")) return false;
  const error = value.error;
  if (error !== null && (!record(error) || !FAILURE_KINDS.some(kind => kind === error.kind)
    || !(error.source === null || typeof error.source === "string") || typeof error.message !== "string")) return false;
  return Array.isArray(value.refusals) && value.refusals.every(refusal => record(refusal)
    && ["lowering", "backend", "typecheck"].some(stage => stage === refusal.stage)
    && typeof refusal.code === "string" && typeof refusal.message === "string")
    && Array.isArray(value.disagreements) && value.disagreements.every(row => record(row)
      && typeof row.compiled === "string" && typeof row.node === "string")
    && Array.isArray(value.aborts) && value.aborts.every(line => typeof line === "string");
}

function shortcutEvidence(value: unknown): value is ShortcutEvidence {
  return record(value) && nonempty(value.expectation)
    && ["pass", "fail", "unresolved", "not-measured"].some(status => status === value.status)
    && ["present", "missing", "not-measured"].some(use => use === value.use);
}

/** CheckReport's arithmetic/disposition invariants, without importing gate runners. */
function consistentReport(report: CheckReport): boolean {
  const counts = report.counts, oracle = report.oracle;
  if (report.status === "error") return counts === null && oracle === null && report.error !== null
    && report.disagreements.length === 0 && report.aborts.length === 0;
  if (counts === null || oracle === null || report.error !== null) return false;
  if (counts.disagreements !== report.disagreements.length || counts.aborts !== report.aborts.length
    || counts.compared + counts.unavailable + counts.runtime_declined + counts.timeouts > counts.expected
    || counts.approximated > counts.compared || oracle.expected !== counts.expected
    || oracle.complete !== (oracle.received === oracle.expected)
    || (counts.functions === 0 ? counts.expected !== 0 : counts.expected === 0)) return false;
  const disposition = counts.functions === 0 ? "nothing"
    : !oracle.complete ? "not_measured"
    : counts.disagreements > 0 ? "disagrees"
    : counts.aborts > 0 ? "aborted"
    : counts.timeouts > 0 || counts.compared + counts.unavailable + counts.runtime_declined !== counts.expected ? "not_measured"
    : counts.unavailable === counts.expected && counts.expected > 0 ? "all_unavailable"
    : counts.compared === 0 ? (counts.runtime_declined === counts.expected && counts.expected > 0 ? "all_declined" : "not_measured")
    : counts.compared === counts.expected ? "agrees" : "partial";
  return report.status === disposition;
}

function oracleResult(value: unknown): value is OracleResult {
  if (!record(value) || value.version !== 1) return false;
  const failure = value.failure;
  if (failure !== null && (!record(failure) || !nonempty(failure.kind)
    || !nonempty(failure.signature) || !stringList(failure.backends))) return false;
  return Array.isArray(value.backends) && value.backends.every(backend => record(backend)
    && nonempty(backend.backend) && checkReport(backend.check) && consistentReport(backend.check) && Array.isArray(backend.controls)
    && backend.controls.every(control => record(control) && nonempty(control.name)
      && checkReport(control.check) && consistentReport(control.check) && Array.isArray(control.shortcuts)
      && control.shortcuts.every(shortcutEvidence)));
}

export function parseOracleResult(value: unknown): OracleResult {
  if (!oracleResult(value)) throw new Error("oracle must return the version 1 OracleResult, including CheckReport and per-control shortcut evidence");
  return value;
}

/** Load `export default { evaluate }` or `export function evaluate(request)`. */
export async function loadOracle(modulePath: string): Promise<Oracle> {
  const namespace: unknown = await import(pathToFileURL(resolve(modulePath)).href);
  if (!record(namespace)) throw new Error("oracle module has no exports");
  const candidate = record(namespace.default) ? namespace.default.evaluate : namespace.evaluate;
  if (typeof candidate !== "function") throw new Error("oracle module must export evaluate(request), or default { evaluate }");
  return {
    async evaluate(request) {
      const value: unknown = await candidate(request);
      return parseOracleResult(value);
    },
  };
}

function ordered(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function sameSet(left: string[], right: string[]): boolean {
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}

function completeOracle(report: CheckReport): boolean {
  return report.counts !== null && report.oracle !== null
    && report.counts.expected > 0 && report.oracle.complete
    && report.oracle.expected === report.counts.expected
    && report.oracle.received === report.oracle.expected;
}

function completeComparison(report: CheckReport): boolean {
  return completeOracle(report) && report.counts !== null
    && report.counts.compared === report.counts.expected
    && report.counts.unavailable === 0 && report.counts.runtime_declined === 0
    && report.counts.timeouts === 0 && report.counts.approximated === 0
    && report.refusals.length === 0 && report.error === null;
}

/** A verdict line alone does not prove that a control was called. */
export function controlAgrees(report: CheckReport): boolean {
  return report.status === "agrees" && completeComparison(report) && report.counts !== null
    && report.counts.functions === 1 && report.counts.disagreements === 0
    && report.counts.aborts === 0 && report.disagreements.length === 0 && report.aborts.length === 0;
}

function reportFailure(report: CheckReport): string | null {
  if (report.status === "disagrees" && completeComparison(report) && report.counts !== null
    && report.counts.disagreements > 0 && report.disagreements.length > 0
    && report.counts.aborts === 0 && report.aborts.length === 0) return "wrong-answer";
  if (report.status === "aborted" && completeOracle(report) && report.counts !== null
    && report.counts.aborts > 0 && report.aborts.length > 0
    && report.counts.unavailable === 0 && report.counts.runtime_declined === 0
    && report.counts.timeouts === 0 && report.refusals.length === 0 && report.error === null) return "abort";
  if (report.status === "error" && report.error !== null) return `error:${report.error.kind}`;
  return null;
}

function sourceHasExpectation(source: string, expectation: string): boolean {
  return source.split(/\r?\n/).some(line => line.trim() === `// expect-ir: ${expectation}`);
}

export function assessFinding(request: OracleRequest, value: unknown): FindingAssessment {
  if (!oracleResult(value)) return { ok: false, reason: "malformed-oracle-result" };
  if (value.failure === null) return { ok: false, reason: "no-failure" };
  const expectedBackends = ordered(request.backends);
  if (expectedBackends.length === 0 || expectedBackends.length !== request.backends.length
    || value.backends.length !== expectedBackends.length
    || !sameSet(value.backends.map(row => row.backend), expectedBackends)) {
    return { ok: false, reason: "backend-coverage" };
  }
  const controls = request.functions.filter(fn => fn.role === "control");
  if (controls.length === 0) return { ok: false, reason: "missing-control-contract" };
  const required = [...controls];
  for (const fn of request.functions) {
    if (fn.role === "twin" && controls.some(control => control.name === fn.counterpart)) {
      const counterpart = controls.find(control => control.name === fn.counterpart);
      if (counterpart !== undefined) required.push({ ...fn, shortcut: fn.shortcut ?? counterpart.shortcut });
    }
  }
  for (const control of required) {
    if (!control.shortcut || !sourceHasExpectation(request.source, control.shortcut)) {
      return { ok: false, reason: `missing-shortcut:${control.name}` };
    }
    for (const backend of value.backends) {
      const rows = backend.controls.filter(row => row.name === control.name);
      if (rows.length !== 1 || !controlAgrees(rows[0].check)) {
        return { ok: false, reason: `control-does-not-agree:${backend.backend}:${control.name}` };
      }
      const evidence = rows[0].shortcuts.filter(item => item.expectation === control.shortcut);
      if (evidence.length !== 1 || evidence[0].status !== "pass" || evidence[0].use !== "present") {
        return { ok: false, reason: `control-shortcut-not-proved:${backend.backend}:${control.name}` };
      }
    }
  }
  const failing: string[] = [];
  const kinds: string[] = [];
  for (const backend of value.backends) {
    if (backend.check.counts !== null && backend.check.counts.functions !== request.functions.length) {
      return { ok: false, reason: `function-coverage:${backend.backend}` };
    }
    const kind = reportFailure(backend.check);
    if (kind !== null) {
      failing.push(backend.backend);
      kinds.push(kind);
    } else if (backend.check.status !== "agrees" || !completeComparison(backend.check)
      || backend.check.counts === null || backend.check.counts.disagreements !== 0
      || backend.check.counts.aborts !== 0 || backend.check.disagreements.length !== 0
      || backend.check.aborts.length !== 0) {
      return { ok: false, reason: `unmeasured-backend:${backend.backend}` };
    }
  }
  if (failing.length === 0 || value.failure.backends.length !== ordered(value.failure.backends).length
    || !sameSet(failing, value.failure.backends)) return { ok: false, reason: "failure-backends-mismatch" };
  const kind = ordered(kinds).join("+");
  if (kind !== value.failure.kind) return { ok: false, reason: "failure-kind-mismatch" };
  return {
    ok: true,
    signature: {
      cell: request.cell, template: request.template, kind,
      backends: ordered(failing), oracleSignature: value.failure.signature,
    },
  };
}

export function sameFailure(left: FailureSignature, right: FailureSignature): boolean {
  return left.cell === right.cell && left.template === right.template && left.kind === right.kind
    && left.oracleSignature === right.oracleSignature && sameSet(left.backends, right.backends);
}
