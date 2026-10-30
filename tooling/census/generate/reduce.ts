import { stripTypeScriptTypes } from "node:module";
import { parse } from "acorn";
import { assessFinding, sameFailure } from "./oracle.ts";
import type { FailureSignature, Oracle, OracleRequest, OracleResult } from "./oracle.ts";

export interface ReductionCandidate<Model> {
  model: Model;
  source: string;
  phase: "baseline" | "model" | "text";
}
export interface ReductionOptions<Model> {
  initial: { model: Model; source: string };
  modelCandidates(model: Model): Iterable<Model>;
  print(model: Model): string;
  /** Strict checking, both Node runs, twin equivalence and a live control witness. */
  precheck(candidate: ReductionCandidate<Model>): Promise<{ ok: boolean; reason?: string }>;
  /** Materializes this candidate and returns its current function contracts. */
  request(candidate: ReductionCandidate<Model>): Promise<OracleRequest> | OracleRequest;
  oracle: Oracle;
  maxCandidates?: number;
}
export interface ReductionStats {
  attempted: number;
  accepted: number;
  modelAccepted: number;
  textAccepted: number;
  rejected: Record<string, number>;
  budgetExhausted: boolean;
}
export interface ReductionResult<Model> {
  model: Model;
  source: string;
  /** Text reduction may make source differ from printing this retained model. */
  textReduced: boolean;
  signature: FailureSignature;
  observation: OracleResult;
  stats: ReductionStats;
}

interface SyntaxNode {
  type: string;
  start: number;
  end: number;
  [field: string]: unknown;
}
function node(value: unknown): value is SyntaxNode {
  return typeof value === "object" && value !== null && "type" in value
    && "start" in value && "end" in value && typeof value.type === "string"
    && typeof value.start === "number" && typeof value.end === "number";
}

/** Remove actual syntax-list statements, including nested and multiline ones. */
export function* statementDeletionCandidates(source: string): Generator<string> {
  const syntax: unknown = parse(stripTypeScriptTypes(source, { mode: "strip" }), {
    ecmaVersion: "latest", sourceType: "module",
  });
  if (!node(syntax)) throw new Error("source parser returned no program");
  const lists: SyntaxNode[][] = [];
  function visit(at: SyntaxNode): void {
    const statements = at.type === "Program" || at.type === "BlockStatement" ? at.body
      : at.type === "SwitchCase" ? at.consequent : undefined;
    if (Array.isArray(statements)) lists.push(statements.filter(node));
    for (const value of Object.values(at)) {
      if (node(value)) visit(value);
      else if (Array.isArray(value)) for (const item of value) if (node(item)) visit(item);
    }
  }
  visit(syntax);
  const seen = new Set<string>();
  for (const statements of lists) {
    // Large deletions first; the final size-one pass also handles tiny lists.
    for (let size = statements.length; size >= 1; size = size === 1 ? 0 : Math.max(1, Math.floor(size / 2))) {
      for (let start = 0; start < statements.length; start += size) {
        const first = statements[start];
        const last = statements[Math.min(statements.length, start + size) - 1];
        if (first === undefined || last === undefined) continue;
        const candidate = source.slice(0, first.start) + source.slice(last.end);
        if (candidate !== source && !seen.has(candidate)) {
          seen.add(candidate);
          yield candidate;
        }
      }
    }
  }
}

/**
 * Every acceptance passes the same gates. No model edit, syntax deletion, or
 * oracle failure can bypass Node/strict/control checks; failed candidates never
 * replace the current source. Model search finishes before text search starts.
 */
export async function reduceProgram<Model>(options: ReductionOptions<Model>): Promise<ReductionResult<Model>> {
  const maximum = options.maxCandidates ?? 500;
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new Error("maxCandidates must be a nonnegative safe integer");
  const stats: ReductionStats = {
    attempted: 0, accepted: 0, modelAccepted: 0, textAccepted: 0,
    rejected: {}, budgetExhausted: false,
  };
  let current: ReductionCandidate<Model> = { ...options.initial, phase: "baseline" };
  const firstCheck = await options.precheck(current);
  if (!firstCheck.ok) throw new Error(`initial program fails prechecks: ${firstCheck.reason ?? "unspecified"}`);
  const firstRequest = await options.request(current);
  let observation = await options.oracle.evaluate(firstRequest);
  const baseline = assessFinding(firstRequest, observation);
  if (!baseline.ok) throw new Error(`initial program is not a verified finding: ${baseline.reason}`);
  const signature = baseline.signature;
  const seen = new Set([current.source]);

  function reject(reason: string): void {
    stats.rejected[reason] = (stats.rejected[reason] ?? 0) + 1;
  }
  async function attempt(candidate: ReductionCandidate<Model>): Promise<boolean> {
    if (seen.has(candidate.source)) return false;
    seen.add(candidate.source);
    if (stats.attempted >= maximum) {
      stats.budgetExhausted = true;
      return false;
    }
    stats.attempted++;
    const checked = await options.precheck(candidate);
    if (!checked.ok) {
      reject(`precheck:${checked.reason ?? "unspecified"}`);
      return false;
    }
    const request = await options.request(candidate);
    const result = await options.oracle.evaluate(request);
    const assessed = assessFinding(request, result);
    if (!assessed.ok) {
      reject(assessed.reason);
      return false;
    }
    if (!sameFailure(signature, assessed.signature)) {
      reject("changed-failure-signature");
      return false;
    }
    current = candidate;
    observation = result;
    stats.accepted++;
    if (candidate.phase === "model") stats.modelAccepted++;
    else stats.textAccepted++;
    return true;
  }

  let changed = true;
  while (changed && !stats.budgetExhausted) {
    changed = false;
    for (const model of options.modelCandidates(current.model)) {
      if (await attempt({ model, source: options.print(model), phase: "model" })) {
        changed = true;
        break;
      }
      if (stats.budgetExhausted) break;
    }
  }
  changed = true;
  while (changed && !stats.budgetExhausted) {
    changed = false;
    for (const source of statementDeletionCandidates(current.source)) {
      if (await attempt({ model: current.model, source, phase: "text" })) {
        changed = true;
        break;
      }
      if (stats.budgetExhausted) break;
    }
  }
  return {
    model: current.model, source: current.source, textReduced: stats.textAccepted > 0,
    signature, observation, stats,
  };
}
