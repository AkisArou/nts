// The worktree pool: a fixed set of trees, one per agent that can work at once,
// each with its own cargo target kept warm (docs/workflow.md, "The machine").
//
//   node tooling/landing/pool.ts status                 which task holds which tree
//   node tooling/landing/pool.ts take <branch>          a free tree, on the task's branch at the newest main
//   node tooling/landing/pool.ts give <branch|tree> [--discard]
//                                                       give a tree back, detached at main
//   node tooling/landing/pool.ts init <size>            create the trees that are missing (the switch)
//
// A tree's state is git's own: a tree with a task's branch checked out is held
// by that task, a detached clean one is free. Nothing else records it, so
// nothing else can disagree. The landing check gives a task's tree back when
// the task lands; a tree with uncommitted changes is never reset, so nothing
// left in it is lost -- `give --discard` is the person's decision.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { revParse, sharedCheckout, worktrees, type Git } from "./git.ts";
import { withLock } from "./lock.ts";

export type TreeState = "free" | "held" | "dirty" | "missing";
export type PoolTree = { name: string; path: string; state: TreeState; branch: string | null; head: string; changes: string[]; ahead: number; behind: number };
export type Inputs = (tree: string) => void;

function run(git: Git, args: readonly string[], cwd: string) {
  const r = spawnSync("git", args, { cwd, env: git.env ?? process.env, encoding: "utf8", maxBuffer: 64 << 20 });
  return { status: r.status ?? 1, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() };
}
function checked(git: Git, args: readonly string[], cwd: string): string {
  const r = run(git, args, cwd);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} in ${cwd}: ${r.stderr || `exit ${r.status}`}`);
  return r.stdout;
}
const taskBranch = (branch: string) => /^[A-Za-z0-9._/-]+$/.test(branch) && branch !== "main" && !branch.startsWith("-") && !branch.includes("..");

export class Pool {
  readonly dir: string; readonly git: Git; readonly inputs: Inputs;
  constructor(dir: string, git: Git, inputs: Inputs = () => {}) { this.dir = resolve(dir); this.git = git; this.inputs = inputs; }

  private names(): string[] {
    try { return readdirSync(this.dir).filter(name => /^[1-9][0-9]*$/.test(name)).sort((a, b) => Number(a) - Number(b)); } catch { return []; }
  }
  /** Every tree of the pool, by number, with what holds it. */
  trees(): PoolTree[] {
    const registered = new Map(worktrees(this.git).map(t => [resolve(t.path), t]));
    const main = revParse(this.git, "refs/heads/main");
    return this.names().map(name => {
      const path = join(this.dir, name), tree = registered.get(path);
      if (!tree || !existsSync(join(path, ".git"))) return { name, path, state: "missing" as const, branch: null, head: "", changes: [], ahead: 0, behind: 0 };
      const changes = checked(this.git, ["status", "--porcelain", "--untracked-files=normal"], path).split("\n").filter(Boolean);
      const [behind, ahead] = checked(this.git, ["rev-list", "--left-right", "--count", `${main}...HEAD`], path).split(/\s+/).map(Number);
      const state: TreeState = tree.branch ? "held" : changes.length ? "dirty" : "free";
      return { name, path, state, branch: tree.branch, head: tree.head, changes, ahead: ahead ?? 0, behind: behind ?? 0 };
    });
  }
  private locked<T>(body: () => T): T { mkdirSync(this.dir, { recursive: true }); return withLock(join(this.dir, ".lock"), body); }

  /** Create the trees 1..size that are missing, detached at main, with their inputs. */
  init(size: number): PoolTree[] {
    if (!Number.isSafeInteger(size) || size < 1) throw new Error(`a pool of ${size} trees`);
    return this.locked(() => {
      for (let n = 1; n <= size; n++) {
        const path = join(this.dir, String(n));
        if (existsSync(path)) continue;
        checked(this.git, ["worktree", "add", "-q", "--detach", path, "refs/heads/main"], this.git.root);
        this.inputs(path);
      }
      return this.trees();
    });
  }

  /** A free tree on `branch`: the task's branch if it exists, else a new one at the newest main. */
  take(branch: string): PoolTree {
    if (!taskBranch(branch)) throw new Error(`not a task branch: ${branch}`);
    return this.locked(() => {
      const trees = this.trees();
      const mine = trees.find(t => t.branch === branch);
      if (mine) return mine;
      const elsewhere = worktrees(this.git).find(t => t.branch === branch);
      if (elsewhere) throw new Error(`${branch} is checked out in ${elsewhere.path}, outside the pool`);
      const free = trees.find(t => t.state === "free");
      if (!free) throw new Error(`no free tree: ${trees.map(t => `${t.name} ${t.state}${t.branch ? ` (${t.branch})` : ""}`).join(", ") || `no trees in ${this.dir}`}`);
      const exists = run(this.git, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], this.git.root).status === 0;
      checked(this.git, exists ? ["switch", "-q", branch] : ["switch", "-q", "-c", branch, "refs/heads/main"], free.path);
      this.inputs(free.path);
      return this.trees().find(t => t.name === free.name)!;
    });
  }

  private find(asked: string): PoolTree {
    const trees = this.trees();
    const tree = trees.find(t => t.name === asked || t.path === resolve(asked) || t.branch === asked);
    if (!tree) throw new Error(`no pool tree is ${asked}: ${trees.map(t => `${t.name} ${t.branch ?? t.state}`).join(", ")}`);
    return tree;
  }

  /**
   * Give a tree back: detached at the newest main. Its branch stays -- a task
   * handed back keeps its work there. Uncommitted changes refuse the give;
   * `discard` drops them, the person's decision.
   */
  give(asked: string, { discard = false } = {}): PoolTree {
    return this.locked(() => {
      const tree = this.find(asked);
      if (tree.state === "missing") throw new Error(`pool tree ${tree.name} is missing: ${tree.path}`);
      if (tree.changes.length && !discard) throw new Error(`pool tree ${tree.name} has uncommitted changes, kept: ${tree.changes.slice(0, 5).join("; ")}${tree.changes.length > 5 ? "; ..." : ""} (give it back with --discard to drop them)`);
      this.detach(tree.path, discard);
      return this.trees().find(t => t.name === tree.name)!;
    });
  }

  /** After `branch` landed: its tree, detached at main, unless it has uncommitted changes. */
  release(branch: string): { tree: PoolTree | null; state: "reset" | "kept" | "none"; reason?: string } {
    return this.locked(() => {
      const tree = this.trees().find(t => t.branch === branch) ?? null;
      if (!tree) return { tree: null, state: "none" };
      if (tree.changes.length) return { tree, state: "kept", reason: `pool tree ${tree.name} has uncommitted changes: ${tree.changes.slice(0, 3).join("; ")}` };
      this.detach(tree.path, false);
      return { tree: this.trees().find(t => t.name === tree.name)!, state: "reset" };
    });
  }

  private detach(path: string, discard: boolean): void {
    if (discard) {
      checked(this.git, ["checkout", "-q", "--detach", "--force", "refs/heads/main"], path);
      checked(this.git, ["clean", "-fdq", "-e", "third_party", "-e", "node_modules", "-e", "**/node_modules"], path);
    } else checked(this.git, ["switch", "-q", "--detach", "refs/heads/main"], path);
  }
}

/** A tree's untracked inputs, linked from the shared checkout as a lane's are (inputs.sh). */
export function linkInputs(root: string): Inputs {
  return tree => {
    const script = join(tree, "tooling/lanes/inputs.sh");
    if (!existsSync(script)) return;
    const r = spawnSync("sh", [script, "lane", root, tree], { cwd: tree, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`inputs for ${tree}: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join("; ")}`);
  };
}

export const POOL_HOME = join(homedir(), ".cache/nts-pool");

export function describePool(trees: readonly PoolTree[]): string {
  if (!trees.length) return "  no pool trees";
  return trees.map(t => {
    const task = t.branch ? `task ${t.branch}` : t.state;
    const where = t.state === "missing" ? "" : `${t.ahead ? `${t.ahead} ahead of main` : ""}${t.ahead && t.behind ? ", " : ""}${t.behind ? `${t.behind} behind` : ""}`;
    const changes = t.changes.length ? `, ${t.changes.length} uncommitted` : "";
    return `  ${t.name.padStart(2)}  ${t.path}  ${task}${where ? ` (${where})` : ""}${changes}`;
  }).join("\n");
}

function main(argv: string[]): number {
  const at = argv.indexOf("--pool");
  const dir = at >= 0 ? argv[at + 1]! : POOL_HOME;
  const args = argv.filter((arg, i) => arg !== "--pool" && argv[i - 1] !== "--pool");
  const [command, target] = args;
  const root = sharedCheckout();
  const pool = new Pool(dir, { root }, linkInputs(root));
  try {
    if (command === "status" || command === undefined) console.log(`pool ${pool.dir}:\n${describePool(pool.trees())}`);
    else if (command === "take" && target) { const t = pool.take(target); console.log(`${t.path}\n  task ${t.branch}, at ${t.head.slice(0, 12)}`); }
    else if (command === "give" && target) { const t = pool.give(target, { discard: args.includes("--discard") }); console.log(`pool tree ${t.name} is free, at main ${t.head.slice(0, 12)}`); }
    else if (command === "init" && target) console.log(describePool(pool.init(Number(target))));
    else { console.error("usage: pool.ts status | take <branch> | give <branch|tree> [--discard] | init <size>  [--pool <dir>]"); return 2; }
    return 0;
  } catch (error) { console.error(`pool: ${(error as Error).message}`); return 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
