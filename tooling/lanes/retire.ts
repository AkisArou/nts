// Post-success upkeep of the submission tree, never of the gate's warm tree.
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectWorktree, parseWorktrees, toolOwnedTrees } from "./branches.ts";
import { classifyHistory } from "./history.ts";
import { processesInTree, type ProcessOptions } from "./processes.ts";
import { revisitLandedTopics } from "./topics.ts";

export type Submission = { tree: string; sha: string; branch: string | null };
export type RetirementEvent = { operation: string; item: string; status: string; reason?: string; [key: string]: unknown };
export type RetirementOptions = ProcessOptions & { home?: string; toolRoot?: string; retireTopic?: boolean; onEvent?: (event: RetirementEvent) => void };
function canonical(path: string): string { try { return realpathSync(path); } catch { return resolve(path); } }
function within(root: string, path: string): boolean { const r = relative(resolve(root), resolve(path)); return r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r); }

export async function retireLanding(repo: string, submission: Submission, options: RetirementOptions = {}) {
  const events: RetirementEvent[] = [];
  const emit = (operation: string, item: string, status: string, detail: Record<string, unknown> = {}) => {
    const event = { operation, item, status, ...detail }; events.push(event); options.onEvent?.(event);
  };
  const git = (args: string[], cwd = repo) => {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" };
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) delete env[key];
    return spawnSync("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "gc.auto=0", "-c", "maintenance.auto=false", "-C", cwd, ...args], { env, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  };
  const read = (args: string[], cwd = repo): string => {
    const r = git(args, cwd); if (r.error || r.status) throw new Error(r.error?.message ?? r.stderr); return r.stdout.trim();
  };
  const trees = () => parseWorktrees(read(["worktree", "list", "--porcelain", "-z"]));
  const branchRef = submission.branch ? `refs/heads/${submission.branch}` : null;
  let treeState = "kept", branchState = branchRef ? "kept" : "none";
  try {
    if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(submission.sha)) throw new Error("invalid queued SHA");
    const main = read(["rev-parse", "refs/heads/main"]);
    const proofRef = branchRef ?? "submission";
    const proof = (await classifyHistory(repo, main, [{ ref: proofRef, sha: submission.sha }])).classified.get(proofRef)!;
    if (!["ANCESTOR", "LANDED"].includes(proof.stateOfLanding)) throw new Error(`submission is ${proof.stateOfLanding}; complete patch equivalence required`);
    const home = options.home ?? homedir();
    const common = read(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const owned = toolOwnedTrees(options.toolRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), "../.."), home);
    const stillOnMain = () => git(["merge-base", "--is-ancestor", main, "refs/heads/main"]).status === 0;
    const treeGuard = (): string | null => {
      if (!stillOnMain()) return "main no longer retains the proved history";
      if (canonical(submission.tree) !== resolve(submission.tree)) return "submission path resolves elsewhere";
      const all = trees(), w = all.find(w => resolve(w.path) === resolve(submission.tree));
      if (!w) return "submission registration is gone";
      if (w.sha !== submission.sha || w.branch !== submission.branch) return "submission HEAD or checkout branch moved";
      if (w.locked) return "submission worktree is locked";
      if (canonical(w.path) === canonical(repo) || canonical(w.path) === canonical(dirname(common))) return "shared landing checkout";
      if (within(join(home, "Projects/nts-lanes"), canonical(w.path))) return "lane home / resume point";
      if (owned.some(t => canonical(t.path) === canonical(w.path))) return "tool-owned tree";
      if (!within(join(home, ".cache/nts-scratch"), canonical(w.path))) return "not a scratch submission tree";
      if (all.some(other => other.path !== w.path && within(w.path, other.path))) return "contains another registered worktree";
      for (const other of all.filter(t => t.path !== w.path)) {
        const target = join(other.path, "target");
        if (existsSync(target) && within(w.path, canonical(target))) return `supplies target storage to ${other.path}`;
      }
      inspectWorktree(w, new Map(), dirname(common), home, owned, new Map(), new Map());
      if (w.missing || w.errors.length || w.dirty !== false) return w.errors.join("; ") || "submission has work or is inaccessible";
      if (canonical(read(["rev-parse", "--path-format=absolute", "--git-common-dir"], w.path)) !== canonical(common)) return "submission belongs to another repository";
      for (const lock of ["index.lock", "HEAD.lock"]) if (existsSync(read(["rev-parse", "--path-format=absolute", "--git-path", lock], w.path))) return "submission Git metadata is locked";
      const active = processesInTree(w.path, { procRoot: options.procRoot, readCwd: options.readCwd,
        onExemption: detail => emit("process-cwd-exemption", w.path, "info", detail) });
      return active.length ? `process cwd inside submission: ${active.join(",")}` : null;
    };
    // This is the originating process, after its flock child exited. Moving
    // cwd changes no files and lets the guard see any OTHER live user of it.
    if (within(submission.tree, process.cwd())) process.chdir(repo);
    let treeReason = treeGuard();
    if (!treeReason) {
      const argv = ["worktree", "remove", "--force", submission.tree];
      emit("remove-submission-tree", submission.tree, "attempt", { argv });
      treeReason = treeGuard();
      if (!treeReason) {
        const r = git(argv);
        if (r.status || r.error) treeReason = r.error?.message ?? r.stderr.trim();
        else { treeState = "removed"; emit("remove-submission-tree", submission.tree, "done"); }
      }
    }
    if (treeReason) emit("remove-submission-tree", submission.tree, "kept", { reason: treeReason });
    if (branchRef && options.retireTopic !== false) {
      const topics = await revisitLandedTopics(repo, [branchRef], event => emit(event.operation, event.item, event.status, event));
      if (topics.some(e => e.operation === "revisit-landed-topic" && e.status === "deleted")) branchState = "deleted";
    }

  } catch (e) { emit("retire-landing", submission.tree, "kept", { reason: String(e) }); }
  return { tree: treeState, branch: branchState, events };
}
