// A culprit's revert, made on the newest main, and the task line that asks for
// it to be landed again with a fix. The revert is `git revert` of the culprit
// computed in the object store (git.ts), with git's own first line, so the
// next search and the landing check read it as a revert of that commit.
import { composeReverts, type Git } from "./git.ts";
import type { Part } from "./state.ts";

export type Finding = {
  part: Part;
  culprit: string;
  subject: string;
  steps: string[];
  /** The red run the search started from, and the commit it measured. */
  run: string;
  tip: string;
  /** The part's last green commit. */
  good: string;
  /** How many commits the search had to choose from, and the runs it measured. */
  candidates: number;
  probes: string[];
};

const short = (sha: string) => sha.slice(0, 12);

export function revertMessage(finding: Finding): string {
  const runs = finding.probes.length ? `\nProbes: ${finding.probes.join(", ")}.` : "";
  return [
    `Revert "${finding.subject}"`,
    "",
    `This reverts commit ${finding.culprit}.`,
    "",
    `The full check's ${finding.part} run was red at ${short(finding.tip)} in`,
    `${finding.steps.join(", ")} (run ${finding.run}). Among the ${finding.candidates}`,
    `commit(s) since the last green ${finding.part} run at ${short(finding.good)}, the culprit`,
    `search found ${short(finding.culprit)} to be the first red one.${runs}`,
    "",
    `Full-check-step: ${finding.steps.join(" ")}`,
    `Full-check-run: ${finding.run}`,
    "",
  ].join("\n");
}

/** The line the coordinator adds to docs/plan.md's task list. */
export function taskLine(finding: Finding, revert: string | null, why?: string): string {
  const done = revert ? `its revert ${short(revert)} is queued first` : `it could not be reverted automatically (${why ?? "no revert"}): revert it by hand`;
  return `- Land ${short(finding.culprit)} ("${finding.subject}") again with a fix: it turned ${finding.steps.join(", ")} red in the full check's ${finding.part} run (${finding.run}); ${done}.`;
}

export type Reverted = { commit: string } | { conflict: string };

/** The revert of the culprit on top of `main`, or why it cannot be made there. */
export function makeRevert(git: Git, main: string, finding: Finding): Reverted {
  return composeReverts(git, main, [finding.culprit], () => revertMessage(finding));
}
