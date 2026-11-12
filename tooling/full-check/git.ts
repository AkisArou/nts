import {gitArguments} from "../gate/git-arguments/main.ts";
// The git the full check needs: first-parent ranges of main, the reverts a
// range already holds, and a commit with culprits reverted, made in the object
// store alone (`merge-tree` and `commit-tree`), so composing one never touches
// a worktree, an index or a ref.
import { spawnSync } from "node:child_process";

export type GitResult = { status: number; stdout: string; stderr: string };

export class Git {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  constructor(cwd: string, env: NodeJS.ProcessEnv = process.env) {
    this.cwd = cwd;
    this.env = { ...env, GIT_OPTIONAL_LOCKS: "0" };
  }
  /** The command's whole result, whatever its status. */
  try(args: string[], input?: string): GitResult {
    const r = spawnSync("git",gitArguments( args), { cwd: this.cwd, env: this.env, encoding: "utf8", input, maxBuffer: 1 << 28 });
    if (r.error) throw r.error;
    return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
  }
  /** Its output as git wrote it, for a format whose columns matter; a non-zero status throws, naming the command. */
  output(args: string[], input?: string): string {
    const r = this.try(args, input);
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim() || `exit ${r.status}`}`);
    return r.stdout;
  }
  /** Its trimmed output; a non-zero status throws, naming the command. */
  run(args: string[], input?: string): string {
    return this.output(args, input).trim();
  }
  ok(args: string[]): boolean {
    return this.try(args).status === 0;
  }
  /** The full object name of a commit, or null when `rev` names none. */
  commit(rev: string): string | null {
    const r = this.try(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
    return r.status === 0 ? r.stdout.trim() : null;
  }
  isAncestor(ancestor: string, descendant: string): boolean {
    return this.ok(["merge-base", "--is-ancestor", ancestor, descendant]);
  }
  subject(commit: string): string {
    return this.run(["log", "-1", "--format=%s", commit]);
  }
}

/** The commits after `from` up to `to` along first parents, oldest first. */
export function firstParents(git: Git, from: string, to: string): string[] {
  const out = git.run(["rev-list", "--first-parent", "--reverse", `${from}..${to}`]);
  return out ? out.split("\n") : [];
}

const REVERTS = /^This reverts commit ([0-9a-f]{40})\b/gm;

/** The commits each commit's message says it reverts (`git revert`'s own line). */
export function revertedBy(message: string): string[] {
  return [...message.matchAll(REVERTS)].map(m => m[1]!);
}

/**
 * For each commit of the range that a later commit of the range reverts, the
 * first such revert: culprit -> its revert. A revert of a revert brings the
 * first commit back, and a later failure of it is a new culprit, so only the
 * first revert of each commit closes its window.
 */
export function revertsIn(git: Git, commits: readonly string[]): Map<string, string> {
  const position = new Map(commits.map((sha, index) => [sha, index]));
  const found = new Map<string, string>();
  for (const sha of commits) {
    for (const reverted of revertedBy(git.run(["log", "-1", "--format=%B", sha]))) {
      const at = position.get(reverted);
      if (at !== undefined && at < position.get(sha)! && !found.has(reverted)) found.set(reverted, sha);
    }
  }
  return found;
}

export type Composition = { commit: string } | { conflict: string; culprit: string };

/**
 * `base` with each culprit reverted on top, newest first, as a commit only the
 * object store holds. A revert that does not apply cleanly is a conflict, and
 * nothing is made: the caller treats that candidate as one it cannot measure.
 */
export function composeReverts(git: Git, base: string, culprits: readonly string[], message: (culprit: string) => string): Composition {
  let current = base;
  for (const culprit of [...culprits].reverse()) {
    const parent = git.commit(`${culprit}^1`);
    if (!parent) return { conflict: `${culprit.slice(0, 12)} has no parent to revert to`, culprit };
    const merged = git.try(["merge-tree", "--write-tree", "--no-messages", `--merge-base=${culprit}`, current, parent]);
    if (merged.status !== 0) return { conflict: `the revert of ${culprit.slice(0, 12)} does not apply to ${current.slice(0, 12)}`, culprit };
    const tree = merged.stdout.split("\n")[0]!.trim();
    current = git.run(["commit-tree", tree, "-p", current, "-F", "-"], message(culprit));
  }
  return { commit: current };
}
