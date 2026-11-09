// A culprit's revert, made on the newest main, and what asks for it to be
// landed again with a fix: its task's issue, reopened with a comment that
// names the red steps, their logs and the revert, or, for a commit that names
// no issue, the task line the coordinator makes an issue of. The revert is
// `git revert` of the culprit computed in the object store (git.ts), with
// git's own first line, so the next search and the landing check read it as a
// revert of that commit.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
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

/** The line the coordinator makes an issue of, for a culprit whose commit names none. */
export function taskLine(finding: Finding, revert: string | null, why?: string): string {
  const done = revert ? `its revert ${short(revert)} is queued first` : `it could not be reverted automatically (${why ?? "no revert"}): revert it by hand`;
  return `- Land ${short(finding.culprit)} ("${finding.subject}") again with a fix: it turned ${finding.steps.join(", ")} red in the full check's ${finding.part} run (${finding.run}); ${done}.`;
}

/** What the full check says on the culprit's issue: the red steps, their logs, the search and the revert. */
export function issueComment(finding: Finding, revert: string | null, why?: string): string {
  const logs = finding.steps.map(step => `\`${join(finding.run, `${step}.log`)}\``).join(", ");
  const probes = finding.probes.length ? `, measured in ${finding.probes.map(run => `\`${run}\``).join(", ")}` : "";
  return [
    `The full check found that ${short(finding.culprit)} ("${finding.subject}") turned ${finding.steps.join(", ")} red in its ${finding.part} run at ${short(finding.tip)}.`,
    "",
    `- The logs: ${logs}.`,
    `- The culprit search chose it among the ${finding.candidates} commit(s) since the last green ${finding.part} run at ${short(finding.good)}${probes}.`,
    revert ? `- Its revert, ${short(revert)}, is queued first in the landing check.` : `- It could not be reverted automatically (${why ?? "no revert"}): revert it by hand.`,
    "",
    "The task is open again: land it again with a fix.",
    "",
  ].join("\n");
}

/** gh in the repository at `root`: its arguments, and what to read on stdin. */
export type Gh = (args: readonly string[], input?: string) => { status: number; stderr: string };

export function ghIn(root: string, env: NodeJS.ProcessEnv = process.env): Gh {
  return (args, input) => {
    const r = spawnSync("gh", args, { cwd: root, env, encoding: "utf8", input });
    return { status: r.error ? -1 : r.status ?? 1, stderr: (r.error?.message ?? r.stderr ?? "").trim() };
  };
}

/**
 * Comment on issue `n`, then reopen it. The comment goes first, on its own:
 * a task landed in slices leaves its issue open, and is told all the same.
 */
export function reopenIssue(gh: Gh, n: number, comment: string): { ok: boolean; line: string } {
  const commented = gh(["issue", "comment", String(n), "--body-file", "-"], comment);
  if (commented.status !== 0) return { ok: false, line: `issue #${n} was not told: ${commented.stderr || `gh exited ${commented.status}`}` };
  const reopened = gh(["issue", "reopen", String(n)]);
  if (reopened.status !== 0) return { ok: false, line: `issue #${n} was told, but not reopened: ${reopened.stderr || `gh exited ${reopened.status}`}` };
  return { ok: true, line: `issue #${n} is open again, with the red steps, their logs and the revert` };
}

export type Reverted = { commit: string } | { conflict: string };

/** The revert of the culprit on top of `main`, or why it cannot be made there. */
export function makeRevert(git: Git, main: string, finding: Finding): Reverted {
  return composeReverts(git, main, [finding.culprit], () => revertMessage(finding));
}
