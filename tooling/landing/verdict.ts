// Durable step evidence from the service's actual checked tip. Queue answers
// and log retention can change independently of this portable receipt.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { durableRecord } from "../gate/durable-record.ts";
import { validContract, type VerdictContract } from "../gate/verdict-contract.ts";
import { unrunPlatforms, type UnrunPlatform } from "../gate/verdict-policy.ts";
import { isListedLine } from "../records/pending.ts";
import type { Selection } from "./selection.ts";
import type { Ran, StepResult } from "./run.ts";

export type CheckedStep = {
  outcome: StepResult;
  coverage: "full" | "selected";
  notices: string[];
  platforms: UnrunPlatform[];
};
export type LandingVerdict = {
  version: 1;
  commit: string;
  tree: string;
  submission: string;
  landing: string;
  base: string;
  at: string;
  run: string;
  profile: string;
  binaries: Record<string, string | null>;
  contract: VerdictContract;
  steps: CheckedStep[];
  deferred: Selection["deferred"];
};

const objectId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const successful = (step: StepResult): boolean => step.verdict === "PASS" || step.verdict === "SKIPPED" && step.accepted === true;
const binaryIdentities = (value: unknown): boolean => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.values(value).every(hash => hash === null || typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash));

export function verdictPath(home: string, commit: string): string {
  if (!objectId(commit)) throw Error("landing verdict needs a full commit ID");
  return join(home, "verdicts", commit + ".json");
}

/** An absent contract is the compatibility path for older candidate gates. */
export function writeLandingVerdict(home: string, input: {
  commit: string; tree: string; submission: string; landing: string; base: string;
  selected: { selection: Selection; interop: string | null; doctests: string | null };
  ran: Ran;
}): LandingVerdict | undefined {
  const { ran, selected } = input;
  if (!ran.contract) return undefined;
  if (ran.state !== "green" || !validContract(ran.contract) || !ran.steps.every(successful)) {
    throw Error("only a canonical completed green landing can supply a verdict receipt");
  }
  if (![input.commit, input.tree, input.submission, input.base].every(objectId)) throw Error("landing verdict has an invalid Git identity");
  const names = new Set(ran.steps.map(step => step.name));
  if (names.size !== ran.steps.length || selected.selection.landing.some(step => !names.has(step.step))) {
    throw Error("landing verdict does not cover its selected steps");
  }
  const steps: CheckedStep[] = ran.steps.map(outcome => {
    const selection = selected.selection.landing.find(step => step.step === outcome.name);
    if (!selection) throw Error("landing verdict has an unselected step: " + outcome.name);
    const log = readFileSync(outcome.log ?? join(ran.run, outcome.name + ".log"), "utf8");
    const narrowed = selection.form === "sample" ||
      outcome.name === "interop" && !!selected.interop ||
      outcome.name === "doctests" && !!selected.doctests;
    return {
      outcome, coverage: narrowed ? "selected" : "full",
      notices: [...new Set(log.split("\n").filter(isListedLine).map(line => line.trim()))],
      platforms: unrunPlatforms(outcome.name, log),
    };
  });
  const receipt: LandingVerdict = {
    version: 1, commit: input.commit, tree: input.tree, submission: input.submission,
    landing: input.landing, base: input.base, at: new Date().toISOString(), run: ran.run,
    profile: "nts-dev", binaries: ran.binaries ?? {}, contract: ran.contract, steps, deferred: selected.selection.deferred,
  };
  durableRecord(verdictPath(home, input.commit), receipt);
  return receipt;
}

function checkedReceipt(value: unknown): value is LandingVerdict {
  if (!value || typeof value !== "object") return false;
  const receipt = value as LandingVerdict;
  return receipt.version === 1 && objectId(receipt.commit) && objectId(receipt.tree) &&
    objectId(receipt.submission) && objectId(receipt.base) && typeof receipt.landing === "string" &&
    typeof receipt.run === "string" && typeof receipt.at === "string" &&
    typeof receipt.profile === "string" && binaryIdentities(receipt.binaries) && validContract(receipt.contract) &&
    receipt.contract.environment.test_profiles.includes(receipt.profile) &&
    Array.isArray(receipt.steps) && Array.isArray(receipt.deferred) &&
    new Set(receipt.steps.map(step => step?.outcome?.name)).size === receipt.steps.length &&
    receipt.steps.every(step => step && ["full", "selected"].includes(step.coverage) &&
      step.outcome && typeof step.outcome.name === "string" && /^[a-z][a-z0-9-]*$/.test(step.outcome.name) && successful(step.outcome) &&
      (step.outcome.binaries === undefined || binaryIdentities(step.outcome.binaries)) &&
      Array.isArray(step.notices) && step.notices.every(line => typeof line === "string" && isListedLine(line)) &&
      Array.isArray(step.platforms) && step.platforms.every(platform => platform &&
        typeof platform.platform === "string" && typeof platform.line === "string" && typeof platform.accepted === "boolean"));
}

export type ReusedVerdict = { receipt?: LandingVerdict; reused: CheckedStep[]; execute: string[]; reason?: string };

/** Failure to establish identity executes the caller's whole requested plan. */
export function readLandingVerdict(home: string, commit: string, tree: string, contract: VerdictContract, requested: readonly string[]): ReusedVerdict {
  const fallback = (reason: string): ReusedVerdict => ({ reused: [], execute: [...requested], reason });
  let receipt: unknown;
  try { receipt = JSON.parse(readFileSync(verdictPath(home, commit), "utf8")); }
  catch (error) { return fallback("no readable landing verdict: " + (error as Error).message); }
  if (!checkedReceipt(receipt)) return fallback("landing verdict has an invalid receipt or outcome");
  if (receipt.commit !== commit || receipt.tree !== tree) return fallback("landing verdict Git identity differs");
  if (!validContract(contract) || receipt.contract.identity !== contract.identity) return fallback("landing verdict environment contract differs");
  const reused = receipt.steps.filter(step => requested.includes(step.outcome.name) && step.coverage === "full" && step.platforms.every(platform => platform.accepted));
  const covered = new Set(reused.map(step => step.outcome.name));
  return { receipt, reused, execute: requested.filter(step => !covered.has(step)) };
}
