// The worktree pool, elastic (docs/workflow.md, "The machine"). A task takes a
// free tree, warm with the cargo target the task before it built; when every
// tree is held, the pool grows by one, as long as the disk can hold another
// tree's target. The full check's hourly upkeep removes free trees idle for
// days and keeps a few warm, so the pool is as large as the work, not a number
// chosen in advance.
//
//   node tooling/landing/pool.ts status [--json]        each tree's state, task, idle time and target size
//   node tooling/landing/pool.ts take <branch>          a tree on the task's branch at the newest main
//   node tooling/landing/pool.ts take --issue <N> [--slug <words>]   the same, on issue N's branch (tooling/tasks/branch.ts)
//   node tooling/landing/pool.ts give <branch|tree> [--discard]
//                                                       give a tree back, detached at main and warm;
//                                                       --discard drops the task: its uncommitted work
//                                                       and its branch, here and on GitHub
//   node tooling/landing/pool.ts init <n>               prewarm trees 1..n that are missing; never a cap
//   node tooling/landing/pool.ts prune                  the hourly upkeep, by hand
//
// `take` and `init` exit 75 (EX_TEMPFAIL) when the machine cannot host another
// tree, naming why: a scheduler waits for a tree to be given back, or for disk,
// and asks again.
//
// A tree's state is git's own: a tree with a task's branch checked out is held
// by that task, a detached clean one is free, and how long a tree has been
// idle is how long ago its HEAD last moved (its reflog). Nothing else records
// them, so nothing else can disagree. The landing check gives a task's tree
// back when the task lands; a tree with uncommitted changes is never reset or
// removed, so nothing left in it is lost -- `give --discard` is the person's
// decision.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statfsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TEMP_DISK_FLOOR_BYTES } from "../gate/run-temporary.ts";
import { deleteBranch, revParse, sharedCheckout, worktrees, type BranchOutcome, type Git } from "./git.ts";
import { withLock } from "./lock.ts";
import { linkTree } from "../inputs/linker.ts";
import { issueBranch } from "../tasks/branch.ts";

const GB = 2 ** 30, HOUR = 3_600_000, DAY = 24 * HOUR;
/** A free tree idle longer than this goes in the hourly upkeep. */
export const IDLE_LIMIT_MS = 3 * DAY;
/** The free trees the upkeep always keeps, warm for the next tasks. */
export const WARM_MINIMUM = 2;
/** One cold build's target: what a tree is taken to need until the pool's own trees are larger. */
export const COLD_TARGET_BYTES = 25 * GB;
/** What must stay free beside a new tree's target: the gate's floor for its temporaries. */
export const DISK_MARGIN_BYTES = TEMP_DISK_FLOOR_BYTES;

export type TreeState = "free" | "held" | "dirty" | "missing";
export type PoolTree = {
  name: string; path: string; state: TreeState; branch: string | null; head: string; changes: string[]; ahead: number; behind: number;
  /** When the tree's HEAD last moved (ms since the epoch): a task taking it, committing in it, or giving it back. */
  movedAt: number | null;
};
/** A tree with its cargo target measured; null when it has none yet. */
export type MeasuredTree = PoolTree & { targetBytes: number | null };
/**
 * Whether the disk can host one more tree. A tree is taken to need the largest
 * target the pool holds, and at least one cold build; each tree that has not
 * built yet will need that much too, so it is reserved; and the gate's floor
 * must stay free beside them.
 */
export type Room = {
  ok: boolean; freeBytes: number; treeBytes: number; unbuilt: number; reservedBytes: number; floorBytes: number;
  /** Why not, when not: the line a scheduler shows while it waits. */
  why: string | null;
};
export type Inputs = (tree: string) => void;
export type PoolOptions = {
  /** Where `give --discard` deletes the task's branch too; null for nowhere. */
  remote?: string | null;
  /** Free bytes on the pool's disk. */
  freeBytes?: () => number;
  /** A tree's cargo target in bytes on disk, or null when it has none. */
  targetBytes?: (tree: string) => number | null;
};
export type Given = { tree: PoolTree; branch: BranchOutcome[] };
export type Pruned = { removed: { tree: PoolTree; targetBytes: number | null }[]; kept: { tree: PoolTree; why: string }[]; free: number };

/** The machine cannot host another tree now: `room` says why. */
export class PoolFull extends Error {
  readonly room: Room;
  constructor(room: Room) { super(`the machine cannot host another tree: ${room.why}`); this.room = room; }
}

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
/** 1 for a tree with a cargo target, which a task reuses instead of building cold. */
const warm = (tree: PoolTree) => existsSync(join(tree.path, "target")) ? 1 : 0;

/** A target's bytes on disk, as the gate measures its temporaries (`du -sx -B1`); null when there is no target. */
export function duTarget(tree: string): number | null {
  const target = join(tree, "target");
  try { if (!lstatSync(target).isDirectory()) return null; } catch { return null; }
  const r = spawnSync("du", ["-sx", "-B1", "--", target], { encoding: "utf8" });
  const bytes = Number((r.stdout ?? "").split("\t")[0]);
  if (r.status !== 0 || !Number.isFinite(bytes)) throw new Error(`cannot measure ${target}: ${(r.stderr ?? "").trim() || `du exited ${r.status}`}`);
  return bytes;
}

/** Give this user's own directories under `path` their write permission back, never through a link. */
function writable(path: string): void {
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isDirectory() || info.uid !== process.getuid?.()) return;
  if ((info.mode & 0o700) !== 0o700) chmodSync(path, (info.mode & 0o7777) | 0o700);
  for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name));
}

export class Pool {
  readonly dir: string; readonly git: Git; readonly inputs: Inputs; readonly remote: string | null;
  private readonly free: () => number; private readonly target: (tree: string) => number | null;
  constructor(dir: string, git: Git, inputs: Inputs = () => {}, options: PoolOptions = {}) {
    this.dir = resolve(dir); this.git = git; this.inputs = inputs; this.remote = options.remote === undefined ? "origin" : options.remote;
    this.free = options.freeBytes ?? (() => { const s = statfsSync(this.dir); return s.bavail * s.bsize; });
    this.target = options.targetBytes ?? duTarget;
  }

  private names(): string[] {
    try { return readdirSync(this.dir).filter(name => /^[1-9][0-9]*$/.test(name)).sort((a, b) => Number(a) - Number(b)); } catch { return []; }
  }
  /** When the tree's HEAD last moved: its reflog's newest entry, else its HEAD file's change. */
  private movedAt(path: string): number | null {
    const r = run(this.git, ["reflog", "-1", "--date=unix", "--format=%gd", "HEAD"], path);
    const at = /@\{(\d+)\}/.exec(r.stdout)?.[1];
    if (r.status === 0 && at) return Number(at) * 1000;
    const head = run(this.git, ["rev-parse", "--path-format=absolute", "--git-path", "HEAD"], path);
    try { return head.status === 0 ? statSync(head.stdout).mtimeMs : null; } catch { return null; }
  }
  /** Every tree of the pool, by number, with what holds it. */
  trees(): PoolTree[] {
    const registered = new Map(worktrees(this.git).map(t => [resolve(t.path), t]));
    const main = revParse(this.git, "refs/heads/main");
    return this.names().map(name => {
      const path = join(this.dir, name), tree = registered.get(path);
      if (!tree || !existsSync(join(path, ".git"))) return { name, path, state: "missing" as const, branch: null, head: "", changes: [], ahead: 0, behind: 0, movedAt: null };
      const changes = checked(this.git, ["status", "--porcelain", "--untracked-files=normal"], path).split("\n").filter(Boolean);
      const [behind, ahead] = checked(this.git, ["rev-list", "--left-right", "--count", `${main}...HEAD`], path).split(/\s+/).map(Number);
      const state: TreeState = tree.branch ? "held" : changes.length ? "dirty" : "free";
      return { name, path, state, branch: tree.branch, head: tree.head, changes, ahead: ahead ?? 0, behind: behind ?? 0, movedAt: this.movedAt(path) };
    });
  }
  /** Every tree, with its target measured. */
  measured(): MeasuredTree[] { return this.trees().map(t => ({ ...t, targetBytes: this.target(t.path) })); }

  /** Whether the disk can host one more tree (`Room`). */
  room(trees: readonly MeasuredTree[] = this.measured()): Room {
    const built = trees.map(t => t.targetBytes).filter((bytes): bytes is number => bytes !== null);
    const treeBytes = Math.max(COLD_TARGET_BYTES, ...built);
    const unbuilt = trees.filter(t => t.state !== "missing" && t.targetBytes === null).length;
    const reservedBytes = unbuilt * treeBytes, floorBytes = treeBytes + DISK_MARGIN_BYTES, freeBytes = this.free();
    const ok = freeBytes - reservedBytes >= floorBytes;
    const why = ok ? null : `${gb(freeBytes)} free${unbuilt ? `, ${gb(reservedBytes)} of it kept for ${unbuilt} tree${unbuilt === 1 ? "" : "s"} still to build` : ""}; `
      + `another tree needs ${gb(treeBytes)} for its target and ${gb(DISK_MARGIN_BYTES)} must stay free beside it (the gate's floor), ${gb(floorBytes)} in all. `
      + `Wait for a tree to be given back, or free disk.`;
    return { ok, freeBytes, treeBytes, unbuilt, reservedBytes, floorBytes, why };
  }

  private locked<T>(body: () => T): T { mkdirSync(this.dir, { recursive: true }); return withLock(join(this.dir, ".lock"), body); }

  /** A new tree, detached at main, with its inputs, when the disk can host it. */
  private grow(name: string): void {
    const room = this.room();
    if (!room.ok) throw new PoolFull(room);
    const path = join(this.dir, name);
    checked(this.git, ["worktree", "add", "-q", "--detach", path, "refs/heads/main"], this.git.root);
    this.inputs(path);
  }
  /** The lowest number with no folder and no registered tree. */
  private nextName(): string {
    const registered = new Set(worktrees(this.git).map(t => resolve(t.path)));
    for (let n = 1; ; n++) if (!existsSync(join(this.dir, String(n))) && !registered.has(join(this.dir, String(n)))) return String(n);
  }

  /** Prewarm: create the trees 1..n that are missing, as the disk allows. Never a cap: `take` grows past it. */
  init(n: number): PoolTree[] {
    if (!Number.isSafeInteger(n) || n < 1) throw new Error(`a pool of ${n} trees`);
    return this.locked(() => {
      for (let i = 1; i <= n; i++) if (!existsSync(join(this.dir, String(i)))) this.grow(String(i));
      return this.trees();
    });
  }

  /**
   * A tree on `branch`: the task's own if it holds one; else a free tree,
   * warm first; else a new one, when the disk can host it (`PoolFull` when it
   * cannot). The task's branch is checked out if it exists, else made at the
   * newest main.
   */
  take(branch: string): PoolTree {
    if (!taskBranch(branch)) throw new Error(`not a task branch: ${branch}`);
    return this.locked(() => {
      const trees = this.trees();
      const mine = trees.find(t => t.branch === branch);
      if (mine) return mine;
      const elsewhere = worktrees(this.git).find(t => t.branch === branch);
      if (elsewhere) throw new Error(`${branch} is checked out in ${elsewhere.path}, outside the pool`);
      // A warm target saves the task a cold build.
      let tree = trees.filter(t => t.state === "free").sort((a, b) => warm(b) - warm(a) || Number(a.name) - Number(b.name))[0]?.name;
      if (!tree) { tree = this.nextName(); this.grow(tree); }
      const path = join(this.dir, tree);
      const exists = run(this.git, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], this.git.root).status === 0;
      checked(this.git, exists ? ["switch", "-q", branch] : ["switch", "-q", "-c", branch, "refs/heads/main"], path);
      this.inputs(path);
      return this.trees().find(t => t.name === tree)!;
    });
  }

  private find(asked: string): PoolTree {
    const trees = this.trees();
    const tree = trees.find(t => t.name === asked || t.path === resolve(asked) || t.branch === asked);
    if (!tree) throw new Error(`no pool tree is ${asked}: ${trees.map(t => `${t.name} ${t.branch ?? t.state}`).join(", ")}`);
    return tree;
  }

  /**
   * Give a tree back, detached at the newest main, its target kept warm. Its
   * branch stays: a task handed back keeps its work there. Uncommitted changes
   * refuse the give. `discard` drops the task: its uncommitted changes, and
   * its branch here and on the remote, by git.ts's rules -- each deletion
   * checks that the branch is still at the tip given back, and a remote
   * branch with commits the tip does not have is kept.
   */
  give(asked: string, { discard = false } = {}): Given {
    return this.locked(() => {
      const tree = this.find(asked);
      if (tree.state === "missing") throw new Error(`pool tree ${tree.name} is missing: ${tree.path}`);
      if (tree.changes.length && !discard) throw new Error(`pool tree ${tree.name} has uncommitted changes, kept: ${tree.changes.slice(0, 5).join("; ")}${tree.changes.length > 5 ? "; ..." : ""} (give it back with --discard to drop them)`);
      this.detach(tree.path, discard);
      const branch = discard && tree.branch ? deleteBranch(this.git, tree.branch, tree.head, this.remote) : [];
      return { tree: this.trees().find(t => t.name === tree.name)!, branch };
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

  /**
   * The upkeep: free trees idle longer than `idleMs` go, cold ones first, then
   * the longest idle, while more than `keep` trees are free. A held, dirty or
   * missing tree is never touched. One tree at a time under the pool's lock,
   * so a task taking a tree waits for one removal at most.
   */
  prune({ idleMs = IDLE_LIMIT_MS, keep = WARM_MINIMUM, now = Date.now() }: { idleMs?: number; keep?: number; now?: number } = {}): Pruned {
    const out: Pruned = { removed: [], kept: [], free: 0 };
    if (!existsSync(this.dir)) return out;
    const tried = new Set<string>();
    for (;;) {
      const next = this.locked(() => {
        const free = this.trees().filter(t => t.state === "free");
        out.free = free.length;
        const stale = free.filter(t => !tried.has(t.name) && t.movedAt !== null && now - t.movedAt > idleMs)
          .sort((a, b) => warm(a) - warm(b) || a.movedAt! - b.movedAt! || Number(a.name) - Number(b.name));
        if (free.length <= keep || !stale.length) return null;
        const tree = stale[0]!;
        tried.add(tree.name);
        const targetBytes = this.target(tree.path);
        const kept = this.remove(tree);
        if (kept !== null) out.kept.push({ tree, why: kept });
        else { out.removed.push({ tree, targetBytes }); out.free = free.length - 1; }
        return tree;
      });
      if (!next) return out;
    }
  }

  /**
   * Remove a free tree with its target: `git worktree remove`, which refuses a
   * tree with changes, then what is left of its folder, its own directories'
   * write permission restored first. Null when it is gone; else why it stays.
   */
  private remove(tree: PoolTree): string | null {
    const r = run(this.git, ["worktree", "remove", tree.path], this.git.root);
    if (worktrees(this.git).some(t => resolve(t.path) === tree.path)) return r.stderr || `git worktree remove exited ${r.status}`;
    if (existsSync(tree.path)) { writable(tree.path); rmSync(tree.path, { recursive: true, force: true }); }
    return null;
  }
}

/** A tree's untracked inputs, linked from the shared checkout by the tree's own linker, for work. */
export function linkInputs(root: string): Inputs {
  return tree => linkTree(tree, "work", root);
}

export const POOL_HOME = join(homedir(), ".cache/nts-pool");

const gb = (bytes: number) => `${(bytes / GB).toFixed(1)} GB`;
/** "4d 2h", "3h 12m", "7m". */
export function idleFor(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000)), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}

export function describePool(trees: readonly (PoolTree | MeasuredTree)[], now = Date.now()): string {
  if (!trees.length) return "  no pool trees";
  return trees.map(t => {
    const task = t.branch ? `task ${t.branch}` : t.state;
    const where = t.state === "missing" ? "" : `${t.ahead ? `${t.ahead} ahead of main` : ""}${t.ahead && t.behind ? ", " : ""}${t.behind ? `${t.behind} behind` : ""}`;
    const changes = t.changes.length ? `, ${t.changes.length} uncommitted` : "";
    const idle = t.movedAt === null ? "" : `, idle ${idleFor(now - t.movedAt)}`;
    const target = "targetBytes" in t ? `, ${t.targetBytes === null ? "no target" : `target ${gb(t.targetBytes)}`}` : "";
    return `  ${t.name.padStart(2)}  ${t.path}  ${task}${where ? ` (${where})` : ""}${changes}${idle}${target}`;
  }).join("\n");
}

export function describeRoom(room: Room): string {
  return room.ok ? `room for another tree (${gb(room.freeBytes)} free${room.unbuilt ? `, ${gb(room.reservedBytes)} kept for ${room.unbuilt} still to build` : ""}; ${gb(room.floorBytes)} needed)`
    : `no room for another tree: ${room.why}`;
}

/** What the pool's status says, for a scheduler (`status --json`). */
export function statusJson(dir: string, trees: readonly MeasuredTree[], room: Room, now = Date.now()) {
  return {
    version: 1, pool: dir, idle_limit_ms: IDLE_LIMIT_MS, warm_minimum: WARM_MINIMUM,
    room: { ok: room.ok, free_bytes: room.freeBytes, tree_bytes: room.treeBytes, unbuilt: room.unbuilt, reserved_bytes: room.reservedBytes, floor_bytes: room.floorBytes, why: room.why },
    trees: trees.map(t => ({
      name: t.name, path: t.path, state: t.state, task: t.branch, head: t.head, ahead: t.ahead, behind: t.behind, uncommitted: t.changes.length,
      moved_at: t.movedAt === null ? null : new Date(t.movedAt).toISOString(), idle_ms: t.movedAt === null ? null : Math.max(0, now - t.movedAt), target_bytes: t.targetBytes,
    })),
  };
}

/** The upkeep's lines, for the full check's log. */
export function pruneLines(pruned: Pruned, now = Date.now()): string[] {
  const lines = pruned.removed.map(({ tree, targetBytes }) =>
    `pool: removed tree ${tree.name}, free and idle ${tree.movedAt === null ? "?" : idleFor(now - tree.movedAt)}${targetBytes === null ? "" : `, with its ${gb(targetBytes)} target`}`);
  for (const { tree, why } of pruned.kept) lines.push(`pool: kept tree ${tree.name}, which could not be removed: ${why}`);
  if (pruned.removed.length) lines.push(`pool: ${pruned.free} free tree${pruned.free === 1 ? "" : "s"} kept warm`);
  return lines;
}

function main(argv: string[]): number {
  const value = (name: string) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
  const dir = value("--pool") ?? POOL_HOME;
  const args = argv.filter((arg, i) => !["--pool", "--issue", "--slug"].includes(arg) && !["--pool", "--issue", "--slug"].includes(argv[i - 1]!));
  const [command] = args;
  const root = sharedCheckout();
  const pool = new Pool(dir, { root }, linkInputs(root));
  try {
    // A task's tree is taken by its issue: the branch rule (tooling/tasks/branch.ts) names its branch.
    const issue = value("--issue");
    const target = command === "take" && issue !== undefined ? issueBranch(Number(issue), value("--slug")) : args[1];
    if (command === "status" || command === undefined) {
      const trees = pool.measured(), room = pool.room(trees);
      if (args.includes("--json")) console.log(JSON.stringify(statusJson(pool.dir, trees, room), null, 2));
      else console.log(`pool ${pool.dir}: ${trees.length} tree${trees.length === 1 ? "" : "s"}, ${describeRoom(room)}\n${describePool(trees)}`);
    } else if (command === "take" && target) { const t = pool.take(target); console.log(`${t.path}\n  task ${t.branch}, at ${t.head.slice(0, 12)}`); }
    else if (command === "give" && target) {
      const given = pool.give(target, { discard: args.includes("--discard") });
      console.log(`pool tree ${given.tree.name} is free, at main ${given.tree.head.slice(0, 12)}`);
      for (const b of given.branch) console.log(`  branch ${b.where === "local" ? "here" : `on ${pool.remote}`}: ${b.state}${b.reason ? ` (${b.reason})` : ""}`);
    } else if (command === "init" && target) console.log(describePool(pool.init(Number(target))));
    else if (command === "prune") { const lines = pruneLines(pool.prune()); console.log(lines.length ? lines.join("\n") : "pool: nothing to remove"); }
    else { console.error("usage: pool.ts status [--json] | take <branch> | take --issue <N> [--slug <words>] | give <branch|tree> [--discard] | init <n> | prune  [--pool <dir>]"); return 2; }
    return 0;
  } catch (error) {
    console.error(`pool: ${(error as Error).message}`);
    return error instanceof PoolFull ? 75 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
