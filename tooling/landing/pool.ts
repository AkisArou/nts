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
// decision. Nor is a tree reset while a process uses it (tree-users.ts): such a
// tree, or one with work left in it, stays on its landed branch with a ref
// naming the commit that landed (LANDED_REFS), and the next upkeep resets it
// once nothing uses it and nothing is left in it.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TEMP_DISK_FLOOR_BYTES } from "../gate/run-temporary.ts";
import { deleteBranch, revParse, sharedCheckout, worktrees, type BranchOutcome, type Git } from "./git.ts";
import { linkTree } from "../inputs/linker.ts";
import { issueBranch } from "../tasks/branch.ts";
import { describeUsers, treeUsers, type TreeUser } from "./tree-users.ts";
import {DiskCapacity,coldBuildForecast,type BuildLease,type BuildForecast} from '../gate/disk-capacity.ts';
import {completedBuild} from '../gate/build-completion.ts';
import type {HostObservations} from '../gate/host-observations.ts';

const GB = 2 ** 30, HOUR = 3_600_000, DAY = 24 * HOUR;
/** Where a held tree's branch is marked landed, at the commit that landed: refs/nts/landed/<branch>. */
export const LANDED_REFS = "refs/nts/landed/";
/** A free tree idle longer than this goes in the hourly upkeep. */
export const IDLE_LIMIT_MS = 3 * DAY;
/** The free trees the upkeep always keeps, warm for the next tasks. */
export const WARM_MINIMUM = 2;
/** The measured declared build outputs, rounded once, never a target-folder guess. */
export const COLD_TARGET_BYTES = coldBuildForecast().bytes;
/** What must stay free beside a new tree's target: the gate's floor for its temporaries. */
export const DISK_MARGIN_BYTES = TEMP_DISK_FLOOR_BYTES;

/** "landed": held by a task that landed while its tree was in use or had work left in it, and reset once neither holds. */
export type TreeState = "free" | "held" | "landed" | "dirty" | "missing";
export type PoolTree = {
  name: string; path: string; state: TreeState; branch: string | null; head: string; changes: string[]; ahead: number; behind: number;
  /** When the tree's HEAD last moved (ms since the epoch): a task taking it, committing in it, or giving it back. */
  movedAt: number | null;
  /** What still uses a landed tree (tree-users.ts); read for landed trees only. */
  users: TreeUser[];
};
/** A tree with its cargo target measured; null when it has none yet. */
export type MeasuredTree = PoolTree & { targetBytes: number | null };
/**
 * Whether the disk can host another measured cold build above the hard floor
 * and the unconsumed promises of active leases. Display-only target sizes do
 * not enter admission; free checkouts promise nothing.
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
  /** A fixture owns the complete disk and allocated-byte observations. */
  host?:HostObservations;
  forecast?:BuildForecast;
  /** A tree's cargo target in bytes on disk, or null when it has none. */
  targetBytes?: (tree: string) => number | null;
};
export type Given = { tree: PoolTree; branch: BranchOutcome[] };
/**
 * The upkeep's work: landed trees reset now that nothing uses them, with what
 * became of their branch here; landed trees still kept, and why; free trees
 * removed; and free trees that could not be.
 */
export type Pruned = {
  released: { tree: PoolTree; branch: string; outcome: BranchOutcome[] }[]; waiting: { tree: PoolTree; why: string }[];
  removed: { tree: PoolTree; targetBytes: number | null }[]; kept: { tree: PoolTree; why: string }[]; free: number;
};

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
const compatible = (tree: PoolTree) => ['nts-dev','clippy'].every(name=>completedBuild(tree.path,name as 'nts-dev'|'clippy',join(tree.path,'target',name))) ? 1 : 0;

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
  readonly capacity:DiskCapacity;private readonly target: (tree: string) => number | null;
  constructor(dir: string, git: Git, inputs: Inputs = () => {}, options: PoolOptions = {}) {
    this.dir = resolve(dir); this.git = git; this.inputs = inputs; this.remote = options.remote === undefined ? "origin" : options.remote;
    this.capacity=new DiskCapacity({env:git.env,host:options.host,forecast:options.forecast,pool:{dir:this.dir,git}});
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
  /** Each branch marked landed, at the commit that landed (LANDED_REFS). */
  landed(): Map<string, string> {
    const listed = checked(this.git, ["for-each-ref", "--format=%(objectname) %(refname)", LANDED_REFS], this.git.root);
    return new Map(listed.split("\n").filter(Boolean).map(line => { const [sha, ref] = line.split(" "); return [ref!.slice(LANDED_REFS.length), sha!]; }));
  }
  private mark(branch: string, sha: string): void { checked(this.git, ["update-ref", `${LANDED_REFS}${branch}`, sha], this.git.root); }
  private forget(branch: string | null): void { if (branch) run(this.git, ["update-ref", "-d", `${LANDED_REFS}${branch}`], this.git.root); }
  /** Every tree of the pool, by number, with what holds it. */
  trees(): PoolTree[] {
    const registered = new Map(worktrees(this.git).map(t => [resolve(t.path), t]));
    const main = revParse(this.git, "refs/heads/main"), landed = this.landed();
    return this.names().map(name => {
      const path = join(this.dir, name), tree = registered.get(path);
      if (!tree || !existsSync(join(path, ".git"))) return { name, path, state: "missing" as const, branch: null, head: "", changes: [], ahead: 0, behind: 0, movedAt: null, users: [] };
      const changes = checked(this.git, ["status", "--porcelain", "--untracked-files=normal"], path).split("\n").filter(Boolean);
      const [behind, ahead] = checked(this.git, ["rev-list", "--left-right", "--count", `${main}...HEAD`], path).split(/\s+/).map(Number);
      // A branch marked landed at the commit its tree is still on: the task is done there.
      const done = tree.branch !== null && landed.get(tree.branch) === tree.head;
      const state: TreeState = done ? "landed" : tree.branch ? "held" : changes.length ? "dirty" : "free";
      return { name, path, state, branch: tree.branch, head: tree.head, changes, ahead: ahead ?? 0, behind: behind ?? 0, movedAt: this.movedAt(path),
        users: done ? treeUsers(path) : [] };
    });
  }
  /** Every tree, with its target measured. */
  measured(): MeasuredTree[] { return this.trees().map(t => ({ ...t, targetBytes: this.target(t.path) })); }

  /** Whether the disk can host one more tree (`Room`). */
  room(trees: readonly MeasuredTree[] = this.measured()): Room {
    const snapshot=this.capacity.poolSnapshot(this.dir,this.leases(trees));
    return this.roomFor(snapshot.freeBytes,snapshot.reservedBytes,snapshot.leases.filter(lease=>lease.remainingBytes>0).length,this.capacity.forecast.bytes);
  }
  private leases(trees:readonly PoolTree[]):BuildLease[]{return trees.filter(tree=>tree.state==='held').map(tree=>({root:tree.path,target:join(tree.path,'target')}));}
  private roomFor(freeBytes:number,reservedBytes:number,unbuilt:number,treeBytes:number):Room {
    const floorBytes = treeBytes + DISK_MARGIN_BYTES;
    const ok = freeBytes - reservedBytes >= floorBytes;
    const why = ok ? null : `${gb(freeBytes)} free${unbuilt ? `, ${gb(reservedBytes)} of it promised to ${unbuilt} active cold lease${unbuilt === 1 ? "" : "s"}` : ""}; `
      + `another tree needs ${gb(treeBytes)} for its target and ${gb(DISK_MARGIN_BYTES)} must stay free beside it (the gate's floor), ${gb(floorBytes)} in all. `
      + `Wait for a tree to be given back, or free disk.`;
    return { ok, freeBytes, treeBytes, unbuilt, reservedBytes, floorBytes, why };
  }

  private locked<T>(body: () => T): T { return this.capacity.locked(body); }

  /** A new tree, detached at main, with its inputs, when the disk can host it. */
  private grow(name: string): void {
    const snapshot=this.capacity.poolSnapshot(this.dir,this.leases(this.trees()));
    const room=this.roomFor(snapshot.freeBytes,snapshot.reservedBytes,snapshot.leases.filter(lease=>lease.remainingBytes>0).length,0);
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
      // Asked for again, a landed task's tree is held: its task goes on there.
      if (mine?.state === "landed") { this.forget(branch); return this.trees().find(t => t.name === mine.name)!; }
      if (mine) return mine;
      const elsewhere = worktrees(this.git).find(t => t.branch === branch);
      if (elsewhere) throw new Error(`${branch} is checked out in ${elsewhere.path}, outside the pool`);
      // A warm target saves the task a cold build.
      let tree = trees.filter(t => t.state === "free").sort((a, b) => compatible(b) - compatible(a) || Number(a.name) - Number(b.name))[0]?.name;
      if (!tree)tree=this.nextName();
      const path = join(this.dir, tree);
      const leases=this.leases(trees),before=this.capacity.poolSnapshot(this.dir,leases);
      const after=this.capacity.poolSnapshot(this.dir,[...leases,{root:path,target:join(path,'target')}]);
      const room=this.roomFor(before.freeBytes,before.reservedBytes,before.leases.filter(lease=>lease.remainingBytes>0).length,after.reservedBytes-before.reservedBytes);
      if(!room.ok)throw new PoolFull(room);
      if(!existsSync(path))this.grow(tree);
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
      // A person's give decides for a landed tree too.
      this.forget(tree.branch);
      return { tree: this.trees().find(t => t.name === tree.name)!, branch };
    });
  }

  /**
   * After `branch` landed at `landed`: its tree, detached at main. A tree
   * with uncommitted changes, or one a process still uses (tree-users.ts), is
   * kept on its branch, marked landed at `landed`, and the upkeep resets it
   * once nothing uses it and nothing is left in it.
   */
  release(branch: string, landed: string): { tree: PoolTree | null; state: "reset" | "kept" | "none"; reason?: string } {
    return this.locked(() => {
      const tree = this.trees().find(t => t.branch === branch) ?? null;
      if (!tree) return { tree: null, state: "none" };
      // Committed on past what landed: its task goes on there.
      if (tree.head !== landed) return { tree, state: "kept", reason: `pool tree ${tree.name} has commits past the one that landed, so it stays its task's` };
      const users = treeUsers(tree.path);
      if (tree.changes.length || users.length) {
        this.mark(branch, landed);
        const held = this.trees().find(t => t.name === tree.name)!;
        return { tree: held, state: "kept", reason: tree.changes.length
          ? `pool tree ${tree.name} has uncommitted changes: ${tree.changes.slice(0, 3).join("; ")}; it stays on its branch, and the next upkeep resets it once they are gone and nothing uses it`
          : `pool tree ${tree.name} stays on its branch while ${using(users)} (a shell or editor with its working directory there counts too); the next upkeep resets it once nothing does` };
      }
      this.detach(tree.path, false);
      this.forget(branch);
      return { tree: this.trees().find(t => t.name === tree.name)!, state: "reset" };
    });
  }

  /**
   * A landed tree (`release`), reset now that nothing uses it and nothing is
   * left in it, its branch here deleted while it is still at the commit that
   * landed; else why it stays. A landed branch that moved on is its task's
   * again: its mark goes, and its tree stays held.
   */
  private settle(tree: PoolTree, landed: string): { outcome: BranchOutcome[] } | { why: string } | null {
    if (tree.head !== landed) { this.forget(tree.branch); return null; }
    if (tree.changes.length) return { why: `it has uncommitted changes: ${tree.changes.slice(0, 3).join("; ")}` };
    const users = treeUsers(tree.path);
    if (users.length) return { why: `${using(users)} (a shell or editor with its working directory there counts too)` };
    this.detach(tree.path, false);
    const outcome = deleteBranch(this.git, tree.branch!, landed, null);
    this.forget(tree.branch);
    return { outcome };
  }

  private detach(path: string, discard: boolean): void {
    if (discard) {
      checked(this.git, ["checkout", "-q", "--detach", "--force", "refs/heads/main"], path);
      checked(this.git, ["clean", "-fdq", "-e", "third_party", "-e", "node_modules", "-e", "**/node_modules"], path);
    } else checked(this.git, ["switch", "-q", "--detach", "refs/heads/main"], path);
  }

  /**
   * The upkeep: first each landed tree is reset once nothing uses it and
   * nothing is left in it (`settle`). Then free trees idle longer than
   * `idleMs` go, cold ones first, then the longest idle, while more than
   * `keep` trees are free. A held, dirty or missing tree is never touched.
   * One tree at a time under the pool's lock, so a task taking a tree waits
   * for one reset or removal at most.
   */
  prune({ idleMs = IDLE_LIMIT_MS, keep = WARM_MINIMUM, now = Date.now() }: { idleMs?: number; keep?: number; now?: number } = {}): Pruned {
    const out: Pruned = { released: [], waiting: [], removed: [], kept: [], free: 0 };
    if (!existsSync(this.dir)) return out;
    for (const name of this.locked(() => this.trees().filter(t => t.state === "landed").map(t => t.name))) {
      this.locked(() => {
        const tree = this.trees().find(t => t.name === name), landed = tree?.branch ? this.landed().get(tree.branch) : undefined;
        if (!tree || landed === undefined) return;
        const settled = this.settle(tree, landed);
        if (settled && "why" in settled) out.waiting.push({ tree, why: settled.why });
        else if (settled) out.released.push({ tree: this.trees().find(t => t.name === name)!, branch: tree.branch!, outcome: settled.outcome });
      });
    }
    // A mark whose branch moved on is its task's again, and one whose branch no
    // tree holds was given back by hand or lost its tree: either marks nothing.
    this.locked(() => {
      const heads = new Map(this.trees().flatMap(t => t.branch ? [[t.branch, t.head] as const] : []));
      for (const [branch, landed] of this.landed()) if (heads.get(branch) !== landed) this.forget(branch);
    });
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
/** "pid 123 zsh (its working directory) uses it", "... use it". */
const using = (users: readonly TreeUser[]) => `${describeUsers(users)} still ${users.length === 1 ? "uses" : "use"} it`;
/** "4d 2h", "3h 12m", "7m". */
export function idleFor(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000)), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}

export function describePool(trees: readonly (PoolTree | MeasuredTree)[], now = Date.now()): string {
  if (!trees.length) return "  no pool trees";
  return trees.map(t => {
    const task = t.state === "landed" ? `landed ${t.branch}` : t.branch ? `task ${t.branch}` : t.state;
    const where = t.state === "missing" ? "" : `${t.ahead ? `${t.ahead} ahead of main` : ""}${t.ahead && t.behind ? ", " : ""}${t.behind ? `${t.behind} behind` : ""}`;
    const changes = t.changes.length ? `, ${t.changes.length} uncommitted` : "";
    const landed = t.state !== "landed" ? "" : t.users.length ? `, kept while ${using(t.users)}` : t.changes.length ? "" : ", reset at the next upkeep";
    const idle = t.movedAt === null ? "" : `, idle ${idleFor(now - t.movedAt)}`;
    const target = "targetBytes" in t ? `, ${t.targetBytes === null ? "no target" : `target ${gb(t.targetBytes)}`}` : "";
    return `  ${t.name.padStart(2)}  ${t.path}  ${task}${where ? ` (${where})` : ""}${changes}${landed}${idle}${target}`;
  }).join("\n");
}

export function describeRoom(room: Room): string {
  return room.ok ? `room for another tree (${gb(room.freeBytes)} free, ${gb(room.reservedBytes)} promised to ${room.unbuilt} active cold leases; ${gb(room.treeBytes)} for its declared build outputs, ${gb(DISK_MARGIN_BYTES)} floor)`
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
      users: t.users.map(user => ({ pid: user.pid, command: user.command, where: user.where })),
    })),
  };
}

/** The upkeep's lines, for the full check's log. */
export function pruneLines(pruned: Pruned, now = Date.now()): string[] {
  const lines = pruned.released.map(({ tree, branch, outcome }) =>
    `pool: reset tree ${tree.name}, whose task ${branch} landed, now that nothing uses it${outcome.map(b => `; its branch here ${b.state}${b.reason ? ` (${b.reason})` : ""}`).join("")}`);
  for (const { tree, why } of pruned.waiting) lines.push(`pool: kept tree ${tree.name} on its landed branch ${tree.branch}: ${why}`);
  lines.push(...pruned.removed.map(({ tree, targetBytes }) =>
    `pool: removed tree ${tree.name}, free and idle ${tree.movedAt === null ? "?" : idleFor(now - tree.movedAt)}${targetBytes === null ? "" : `, with its ${gb(targetBytes)} target`}`));
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
