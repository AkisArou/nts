import {gitArguments} from "../gate/git-arguments.ts";
// The git half of landing a change: rebase it onto the newest main, move main
// to it, push main, and delete the change's branch where nothing on it is lost.
// Every operation names its repository and environment; none touches a
// working tree except the one that has main checked out, which `git merge
// --ff-only` keeps in step.
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { issuesNamed, withFixes } from "../tasks/links.ts";

export type Git = { root: string; env?: NodeJS.ProcessEnv };
export class GitError extends Error {}

function run(git: Git, args: readonly string[], cwd = git.root, env = git.env ?? process.env, input?: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("git",gitArguments( args), { cwd, env, encoding: "utf8", maxBuffer: 64 << 20, input });
  if (r.error) throw new GitError(`git ${args[0]}: ${r.error.message}`);
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: (r.stderr ?? "").trim() };
}
function checked(git: Git, args: readonly string[], cwd = git.root, env?: NodeJS.ProcessEnv, input?: string): string {
  const r = run(git, args, cwd, env, input);
  if (r.status !== 0) throw new GitError(`git ${args.join(" ")}: ${r.stderr || `exit ${r.status}`}`);
  return r.stdout.trim();
}

/** The checkout every worktree shares: main lives there. */
export function sharedCheckout(cwd = process.cwd()): string {
  const r = spawnSync("git",gitArguments( ["rev-parse", "--path-format=absolute", "--git-common-dir"]), { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new GitError(`not in a git repository: ${cwd}`);
  return dirname(r.stdout.trim());
}

export function revParse(git: Git, rev: string): string {
  return checked(git, ["rev-parse", "--verify", "--end-of-options", `${rev}^{commit}`]);
}
export function treeOf(git: Git, rev: string): string {
  return checked(git, ["rev-parse", "--verify", "--end-of-options", `${rev}^{tree}`]);
}
export function isAncestor(git: Git, ancestor: string, of: string): boolean {
  const r = run(git, ["merge-base", "--is-ancestor", ancestor, of]);
  if (r.status > 1) throw new GitError(`git merge-base --is-ancestor: ${r.stderr}`);
  return r.status === 0;
}
export function hasCommit(git: Git, sha: string): boolean {
  return run(git, ["cat-file", "-e", `${sha}^{commit}`]).status === 0;
}

/** Every path a range touches, both sides of a rename. */
export function changedPaths(git: Git, base: string, tip: string): string[] {
  return checked(git, ["diff", "--name-only", "--no-renames", "-z", base, tip]).split("\0").filter(Boolean);
}

export type Rebased = { tip: string; replayed: number; skipped: number } | { conflict: string; files: string[]; reason?: string };

/**
 * `sha` replayed onto `onto`, without touching a working tree (`git replay`).
 * Only the commits whose change `onto` does not already have are replayed, as
 * `git rebase` skips them (`git cherry`): a fixture that landed on its own
 * ahead of its fix is not replayed again. A conflict names the commit and the
 * files it conflicts in.
 */
export function rebaseOnto(git: Git, onto: string, sha: string): Rebased {
  if (isAncestor(git, onto, sha)) return { tip: sha, replayed: 0, skipped: 0 };
  const from = checked(git, ["merge-base", onto, sha]);
  // `git replay` does not replay merges, and a task's branch is a line of commits.
  const merge = checked(git, ["rev-list", "--merges", `${from}..${sha}`]).split("\n").filter(Boolean).at(-1);
  if (merge) return { conflict: merge, files: [], reason: "it is a merge: rebase the branch onto main by hand, as a line of commits" };
  const marks = checked(git, ["cherry", onto, sha, from]).split("\n").filter(Boolean);
  const pending = marks.filter(line => line.startsWith("+ ")).map(line => line.slice(2));
  let tip = onto;
  for (const commit of pending) {
    const replay = run(git, ["replay", "--onto", tip, "--ref", "refs/landing/replayed", "--ref-action", "print", `${commit}^..${commit}`]);
    const update = /^update \S+ ([0-9a-f]{40,64}) /m.exec(replay.stdout);
    if (replay.status !== 0 || !update) return { conflict: commit, files: conflictedFiles(git, commit, tip) };
    tip = update[1]!;
  }
  return { tip, replayed: pending.length, skipped: marks.length - pending.length };
}

/**
 * `tip` naming issue `n`, so that GitHub closes the issue when main reaches
 * it: "Fixes #n" added to the last commit's message. A change that names the
 * issue already, in any of its commits since `base` (as fixed, or as "Part of"
 * it when the task goes on), lands as it is. The new commit keeps the old
 * one's tree, parents and author; only its message and committer differ, as
 * a replayed commit's committer does.
 */
export function namingIssue(git: Git, base: string, tip: string, n: number): string {
  if (issuesNamed(checked(git, ["log", "--format=%B", `${base}..${tip}`])).includes(n)) return tip;
  const [tree, parents, name, email, date] = checked(git, ["log", "-1", "--format=%T%x00%P%x00%an%x00%ae%x00%ad", "--date=raw", tip]).split("\0");
  const message = withFixes(checked(git, ["log", "-1", "--format=%B", tip]), n);
  const env = { ...(git.env ?? process.env), GIT_AUTHOR_NAME: name!, GIT_AUTHOR_EMAIL: email!, GIT_AUTHOR_DATE: date! };
  const parentArgs = (parents ?? "").split(" ").filter(Boolean).flatMap(parent => ["-p", parent]);
  return checked(git, ["commit-tree", tree!, ...parentArgs, "-F", "-"], git.root, env, message);
}

/** The files `commit` conflicts in when picked onto `onto`. */
export function conflictedFiles(git: Git, commit: string, onto: string): string[] {
  const r = run(git, ["merge-tree", "--write-tree", "--name-only", "--no-messages", "--merge-base", `${commit}^`, onto, commit]);
  if (r.status !== 1) return [];
  const lines = r.stdout.split("\n");
  const files: string[] = [];
  for (const line of lines.slice(1)) { if (line === "") break; files.push(line); }
  return [...new Set(files)];
}

export type Worktree = { path: string; head: string; branch: string | null };
/** `git worktree list`, one row per tree; `branch` is null for a detached one. */
export function worktrees(git: Git): Worktree[] {
  const out: Worktree[] = [];
  for (const record of checked(git, ["worktree", "list", "--porcelain", "-z"]).split("\0\0")) {
    const fields = record.split("\0").filter(Boolean);
    const path = fields.find(f => f.startsWith("worktree "))?.slice(9);
    if (!path || fields.includes("bare")) continue;
    out.push({ path, head: fields.find(f => f.startsWith("HEAD "))?.slice(5) ?? "", branch: fields.find(f => f.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null });
  }
  return out;
}

export type Advanced = { ok: true; via: string } | { ok: false; moved: string } | { ok: false; blocked: string };
/**
 * Move main from `base` to `tip`, a fast-forward, only if main is still at
 * `base`. The tree that has main checked out moves with it (`merge
 * --ff-only`, which refuses rather than overwrite a local change there).
 */
export function advanceMain(git: Git, base: string, tip: string): Advanced {
  const current = revParse(git, "refs/heads/main");
  if (current !== base) return { ok: false, moved: current };
  if (!isAncestor(git, base, tip)) return { ok: false, blocked: `${tip.slice(0, 12)} is not a fast-forward of main` };
  const where = worktrees(git).find(t => t.branch === "main");
  if (where) {
    const r = run(git, ["merge", "--ff-only", "-q", tip], where.path);
    if (r.status !== 0) {
      const now = revParse(git, "refs/heads/main");
      return now !== base ? { ok: false, moved: now } : { ok: false, blocked: `main's checkout ${where.path} refused the fast-forward: ${r.stderr}` };
    }
    return { ok: true, via: where.path };
  }
  const r = run(git, ["update-ref", "-m", "landing: fast-forward", "refs/heads/main", tip, base]);
  if (r.status !== 0) return { ok: false, moved: revParse(git, "refs/heads/main") };
  return { ok: true, via: "refs/heads/main" };
}

export type Pushed = { ok: true } | { ok: false; reason: string };
/** `git push <remote> main`: never forced; a rejection is reported, not resolved. */
export function pushMain(git: Git, remote: string): Pushed {
  const r = run(git, ["push", "--porcelain", remote, "refs/heads/main:refs/heads/main"]);
  return r.status === 0 ? { ok: true } : { ok: false, reason: pushFailure(r) };
}

/** What a refused push says: its porcelain status line, else git's errors. */
function pushFailure(r: { status: number; stdout: string; stderr: string }): string {
  const status = r.stdout.split("\n").find(line => line.startsWith("!"))?.split("\t").slice(2).join(" ");
  const errors = r.stderr.split("\n").filter(line => /^(error|fatal):/.test(line)).join("; ");
  return status || errors || r.stderr.split("\n").filter(Boolean).at(-1) || `exit ${r.status}`;
}

/** Whether origin's main has everything local main has. */
export function pushedMain(git: Git, remote: string): boolean {
  const r = run(git, ["ls-remote", "--heads", remote, "refs/heads/main"]);
  const remoteMain = /^([0-9a-f]{40,64})\s/.exec(r.stdout)?.[1];
  return r.status === 0 && remoteMain === revParse(git, "refs/heads/main");
}

export type BranchOutcome = { where: "local" | "remote"; state: "deleted" | "absent" | "kept"; reason?: string };
/**
 * Delete `branch` here and on `remote` when everything on it is in
 * `submitted`: the commit that landed, or the tip a dropped task gave back
 * (pool.ts's `give --discard`). A branch an agent moved on since then keeps
 * its new work. A branch checked out in a tree is kept; the caller frees the
 * tree first. Each deletion is a compare-and-swap on the value checked.
 */
/**
 * The branches open pull requests on `remote` are based on, with their
 * numbers, or why they cannot be read. Deleting a branch on GitHub closes every
 * pull request based on it: on 11-07 deleting 46 landed port branches closed
 * seven unlanded ports stacked on one of them. A remote that is not on GitHub
 * has no pull requests.
 */
export type PullBases = { read: ReadonlyMap<string, readonly number[]> } | { unreadable: string };
export function openPullBases(git: Git, remote: string): PullBases {
  const url = run(git, ["remote", "get-url", remote]);
  if (url.status !== 0) return { unreadable: `no remote ${remote}: ${url.stderr.trim()}` };
  if (!/github\.com[:/]/.test(url.stdout)) return { read: new Map() };
  const r = spawnSync("gh", ["pr", "list", "--state", "open", "--limit", "1000", "--json", "number,baseRefName,isCrossRepository"], { cwd: git.root, env: git.env, encoding: "utf8" });
  if (r.error || r.status !== 0) return { unreadable: `cannot list open pull requests: ${(r.error?.message ?? r.stderr ?? "").trim()}` };
  const bases = new Map<string, number[]>();
  for (const pull of JSON.parse(r.stdout) as { number: number; baseRefName: string; isCrossRepository?: boolean }[]) {
    if (pull.isCrossRepository) continue;
    bases.set(pull.baseRefName, [...(bases.get(pull.baseRefName) ?? []), pull.number]);
  }
  return { read: bases };
}

export function deleteBranch(git: Git, branch: string, submitted: string, remote: string | null, bases?: PullBases): BranchOutcome[] {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch === "main" || branch.startsWith("-")) throw new GitError(`not a task branch: ${branch}`);
  const ref = `refs/heads/${branch}`;
  const out: BranchOutcome[] = [];
  const local = run(git, ["rev-parse", "--verify", "--quiet", ref]).stdout.trim();
  if (!local) out.push({ where: "local", state: "absent" });
  else if (!isAncestor(git, local, submitted)) out.push({ where: "local", state: "kept", reason: `it is at ${local.slice(0, 12)}, with commits ${submitted.slice(0, 12)} does not have` });
  else {
    const holder = worktrees(git).find(t => t.branch === branch);
    if (holder) out.push({ where: "local", state: "kept", reason: `checked out in ${holder.path}` });
    else {
      const r = run(git, ["update-ref", "-d", ref, local]);
      out.push(r.status === 0 ? { where: "local", state: "deleted" } : { where: "local", state: "kept", reason: r.stderr });
    }
  }
  if (remote === null) return out;
  const listed = run(git, ["ls-remote", "--heads", remote, ref]);
  if (listed.status !== 0) { out.push({ where: "remote", state: "kept", reason: `cannot read ${remote}: ${listed.stderr}` }); return out; }
  const there = /^([0-9a-f]{40,64})\s/.exec(listed.stdout)?.[1];
  if (!there) { out.push({ where: "remote", state: "absent" }); return out; }
  if (!hasCommit(git, there)) run(git, ["fetch", "--quiet", "--no-tags", remote, ref]);
  if (!hasCommit(git, there) || !isAncestor(git, there, submitted)) {
    out.push({ where: "remote", state: "kept", reason: `${remote}/${branch} is at ${there.slice(0, 12)}, with commits ${submitted.slice(0, 12)} does not have` });
    return out;
  }
  // An open pull request based on the branch would close with it.
  const based = bases ?? openPullBases(git, remote);
  if ("unreadable" in based) { out.push({ where: "remote", state: "kept", reason: based.unreadable }); return out; }
  const dependents = based.read.get(branch);
  if (dependents?.length) {
    out.push({ where: "remote", state: "kept", reason: `open pull request ${dependents.map(n => `#${n}`).join(", ")} ${dependents.length === 1 ? "is" : "are"} based on it` });
    return out;
  }
  const r = run(git, ["push", "--porcelain", `--force-with-lease=${ref}:${there}`, remote, `:${ref}`]);
  out.push(r.status === 0 ? { where: "remote", state: "deleted" } : { where: "remote", state: "kept", reason: pushFailure(r) });
  return out;
}
