import type { activeCommand, ActiveResult } from "../gate/active-command.ts";

export const CHECK_STATUSES = ["nothing", "agrees", "partial", "all_unavailable", "all_declined",
  "disagrees", "aborted", "not_measured", "error"] as const;
export type CheckStatus = typeof CHECK_STATUSES[number];
export const FAILURE_KINDS = ["capture", "typecheck", "source_plan", "preparation", "backend_declined",
  "emitter", "native_build", "execution", "oracle_coverage", "oracle_execution", "internal"] as const;
export type FailureKind = typeof FAILURE_KINDS[number];
export const COUNT_NAMES = ["functions", "expected", "compared", "unavailable", "runtime_declined",
  "timeouts", "approximated", "disagreements", "aborts"] as const;
export type CheckCounts = Record<typeof COUNT_NAMES[number], number>;
export interface CheckRefusal { stage: "lowering" | "backend" | "typecheck"; code: string; message: string; }
export interface CheckFailure { kind: FailureKind; source: string | null; message: string; }
export interface CheckReport {
  version: 1 | 2;
  status: CheckStatus;
  counts: CheckCounts | null;
  oracle: { expected: number; received: number; complete: boolean } | null;
  refusals: CheckRefusal[];
  disagreements: { compiled: string; node: string }[];
  aborts: string[];
  incomplete?: {kind: "hung" | "runaway" | "tooling-setup"; reason: string; case_index: number | null}[];
  error: CheckFailure | null;
}
export type CheckFormat = "json-v1" | "legacy";
export type CheckCommandResult = ActiveResult & {memoryKilled?: boolean; residentLimitBytes?: number; residentRunBytes?: number};
export type CheckRunner = (...args: Parameters<typeof activeCommand>) => Promise<CheckCommandResult>;
export type CheckRunOptions = Partial<Parameters<CheckRunner>[2]> & { run?: CheckRunner };
export type CheckConsumer = "program" | "benchmark" | "refusal";
export interface CheckObservation {
  category: "invalid-hir" | "aborted" | "refused" | "wrong-answer" | "agrees" | "not-measured";
  nts: string;
  check?: CheckReport;
}
export interface DecodedCheck {
  format: CheckFormat;
  outcome: string;
  status: number | null;
  checked: number;
  expected: number;
  unavailable?: number;
  declined: number;
  timeouts: number;
  refused: number;
  refusedRoots: number;
  answers: string[];
  compiledAnswers: string[];
  refusals: CheckRefusal[];
  oracleStopped: number;
  missingPopulation: string | null;
  first: string;
  report?: CheckReport;
}
export type LegacyIdentity =
  | { kind: "preparation"; message: string }
  | { kind: "emitter"; message: string }
  | { kind: "abort"; message: string }
  | { kind: "runtime_declined"; count: number }
  | { kind: "refusal"; stage: "backend" | "lowering"; diagnostic: string }
  | { kind: "population"; compared: number; expected: number; functions: number | null;
      refusals: string[]; runtime_declined: number; disagreements: number; agreement: boolean };
