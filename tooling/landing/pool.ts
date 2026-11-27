import {DiskBuildAdmissionError} from '../gate/step-result.ts';
import {TreePin} from './tree-pin.ts';
import {randomUUID} from 'node:crypto';
import {processIdentity} from './lock.ts';
import {GitReceipt} from '../gate/disk-preparation.ts';
import {gitArguments} from "../gate/git-arguments/main.ts";
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
//   node tooling/landing/pool.ts attach <branch> | detach <branch>   worker presence; keep the task's checkout
//   node tooling/landing/pool.ts give <branch|tree> [--discard]
//                                                       give a tree back, detached at main and warm;
//                                                       --discard drops the task: its uncommitted work
//                                                       and its branch, here and on GitHub
//   node tooling/landing/pool.ts init <n>               prewarm trees 1..n that are missing; never a cap
//   node tooling/landing/pool.ts prune                  the hourly upkeep, by hand
//
// A refusal that changed nothing and can succeed when asked again exits 75
// (EX_TEMPFAIL, `PoolRetry`), naming why; a scheduler waits and asks again:
//   - `take`, `attach` and `init`: the machine cannot host another tree
//     (`PoolFull`): wait for a tree to be given back, or for disk;
//   - `take` and `attach`: a gate run or disk reclamation holds the tree's
//     resource lock (`TreeInUse`);
//   - `give`: a live process's use of the tree could not be
//     observed completely (`PoolOwnershipUnavailable`, tree-users.ts), so
//     nothing certifies the tree idle.
// `detach` records a durable pending request while owners still use the tree;
// upkeep completes it once those owners drain. Pending releases only its unused
// pool promise and grants no reclamation. Both accepted states exit 0.
// Every other error exits 1, a defect or an unreadable pool or Git path among
// them. `give` refuses, exit 1, a tree any live process uses -- the asking
// agent's own shell or session with its working directory there included:
// give a tree back from outside it. `status` reports a failed observation on
// its tree's row and goes on. A landing's `release` and the upkeep's `prune`
// never refuse for one tree: a tree in use, or one whose use could not be
// observed, stays on its landed branch with why, and the next upkeep retries it.
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
import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TEMP_DISK_FLOOR_BYTES } from "../gate/run-temporary.ts";
import { deleteBranch, revParse, sharedCheckout, worktrees, type BranchOutcome, type Git } from "./git.ts";
import { linkTree } from "../inputs/linker.ts";
import { issueBranch } from "../tasks/branch.ts";
import { describeUsers, treeUsers, TreeOwnershipUnavailable, type TreeProcessOptions, type TreeUser } from "./tree-users.ts";
import {DiskCapacity,coldBuildForecast,type BuildLease,type BuildForecast} from '../gate/disk-capacity.ts';
import {completedBuild} from '../gate/build-completion.ts';
import type {HostObservations} from '../gate/host-observations.ts';
import {describeReclamation,diskTrash,type TrashEntry,type ReclaimReport} from '../gate/disk-reclamation.ts';
import {workerPresence,writeWorkerPresence,assertWorkerPresenceWritable,removeWorkerPresence,type WorkerPresence,type DetachRequest} from './pool-presence.ts';
import {GateResource} from '../gate/gate-resource.ts';
import {assertNoHereRestore} from './here-restore-record.ts';

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
  hereReplay?: string;
  /** When the tree's HEAD last moved (ms since the epoch): a task taking it, committing in it, or giving it back. */
  movedAt: number | null;
  presence?:WorkerPresence;
};
/** A tree as status shows it: what still uses a landed tree (tree-users.ts),
 * observed for display only; a decision observes in its own reset. */
export type StatusTree = PoolTree & {
  /** What still uses a landed tree; empty for every other state. */
  users: TreeUser[];
  /** The observation could not establish ownership. Never an idle verdict. */
  ownershipError?: string;
};
/** A tree with its cargo target measured; null when it has none yet. */
export type MeasuredTree<T extends PoolTree = PoolTree> = T & { targetBytes: number | null };
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
  /** A fixture's owned process observation (tree-users.ts), read by the
   * production users rule; the pool supplies its registered run trees. */
  processes?:Omit<TreeProcessOptions,'runTrees'>;
  /** Replaces the users rule entirely: failure injection in tests only. */
  users?:(tree:string)=>TreeUser[];
  reclamation?:NonNullable<ConstructorParameters<typeof DiskCapacity>[0]>['reclamation'];
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
  reclamation:ReclaimReport|null;
  detached:PoolTree[]; detachWaiting:{tree:PoolTree;why:string}[];
};

/** A refusal that changed nothing and can succeed when asked again later: exit 75 (EX_TEMPFAIL). */
export abstract class PoolRetry extends Error {}
export const RETRY_EXIT = 75;
/** The CLI's exit code for a refusal: retryable ones exit 75, every other error 1. */
export const poolExit = (error: unknown): number => error instanceof PoolRetry ? RETRY_EXIT : 1;

/** The machine cannot host another tree now: `room` says why. */
export class PoolFull extends PoolRetry {
  readonly room: Room;
  constructor(room: Room) { super(`the machine cannot host another tree: ${room.why}`); this.room = room; }
}
/** A gate run or disk reclamation holds the tree's resource lock, so a task cannot take or attach it now. */
export class TreeInUse extends PoolRetry {
  readonly tree: string;
  constructor(tree: string) { super(`tree resource lock is held for ${tree}: a gate run or disk reclamation is using it; ask again once it ends`); this.tree = tree; }
}

/** A live process lacks enough owned evidence to decide which tree it uses. */
export class PoolOwnershipUnavailable extends PoolRetry {
  constructor(cause:TreeOwnershipUnavailable){super(cause.message,{cause});}
}

function run(git: Git, args: readonly string[], cwd: string) {
  const r = spawnSync("git", gitArguments(args), { cwd, env: git.env ?? process.env, encoding: "utf8", maxBuffer: 64 << 20 });
  return { status: r.status ?? 1, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() };
}
function checked(git: Git, args: readonly string[], cwd: string): string {
  const r = run(git, args, cwd);
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} in ${cwd}: ${r.stderr || `exit ${r.status}`}`);
  return r.stdout;
}
const taskBranch = (branch: string) => /^[A-Za-z0-9._/-]+$/.test(branch) && branch !== "main" && !branch.startsWith("-") && !branch.includes("..");
/** 1 for a tree with a cargo target, which a task reuses instead of building cold. */
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

/** The pool trees Git registers (numbered direct children of `dir`): the
 * trees whose gate-run receipts may attribute an unreadable process. */
export function registeredRunTrees(dir:string,registered:readonly {path:string}[]):string[]{
  const root=resolve(dir);
  return registered.map(row=>resolve(row.path)).filter(path=>path.startsWith(root+'/')&&/^[1-9][0-9]*$/.test(path.slice(root.length+1)));
}

export class Pool {
  readonly dir: string; readonly git: Git; readonly inputs: Inputs; readonly remote: string | null;
  readonly capacity:DiskCapacity;private readonly users:(tree:string,ownPin?:TreePin)=>TreeUser[];private readonly target: (tree: string) => number | null;
  constructor(dir: string, git: Git, inputs: Inputs = () => {}, options: PoolOptions = {}) {
    this.dir = resolve(dir); this.git = git; this.inputs = inputs; this.remote = options.remote === undefined ? "origin" : options.remote;
    this.capacity=new DiskCapacity({env:git.env,host:options.host,forecast:options.forecast,pool:{dir:this.dir,git},reclamation:options.reclamation});
    this.target = options.targetBytes ?? duTarget;
    const users:(tree:string,ownPin?:TreePin)=>TreeUser[]=options.users??((tree,ownPin)=>treeUsers(tree,{...options.processes,self:undefined,ownPin,runTrees:registeredRunTrees(this.dir,worktrees(this.git))}));
    this.users=(tree,ownPin)=>{
      try{const pins=TreePin.users(tree,ownPin);return pins.length?pins:users(tree,ownPin);}
      catch(error){if(error instanceof TreeOwnershipUnavailable)throw new PoolOwnershipUnavailable(error);throw error;}
    };
  }

  private names(): string[] {
    try { return readdirSync(this.dir).filter(name => /^[1-9][0-9]*$/.test(name)).sort((a, b) => Number(a) - Number(b)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
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
  private forget(branch: string | null): void { if (branch) checked(this.git, ["update-ref", "-d", `${LANDED_REFS}${branch}`], this.git.root); }
  /** Every tree of the pool, by number, with what holds it: Git's state only. */
  trees(): PoolTree[] {
    const registered = new Map(worktrees(this.git).map(t => [resolve(t.path), t]));
    const main = revParse(this.git, "refs/heads/main"), landed = this.landed();
    return this.names().map(name => {
      const path = join(this.dir, name), tree = registered.get(path);
      if (!tree || !existsSync(join(path, ".git"))) return { name, path, state: "missing" as const, branch: null, head: "", changes: [], ahead: 0, behind: 0, movedAt: null };
      const changes = checked(this.git, ["status", "--porcelain", "--untracked-files=normal"], path).split("\n").filter(Boolean);
      const [behind, ahead] = checked(this.git, ["rev-list", "--left-right", "--count", `${main}...${tree.head}`], path).split(/\s+/).map(Number);
      // A branch marked landed at the commit its tree is still on: the task is done there.
      const done = tree.branch !== null && landed.get(tree.branch) === tree.head;
      const state: TreeState = done ? "landed" : tree.branch ? "held" : changes.length || tree.hereReplay ? "dirty" : "free";
      return { name, path, state, branch: tree.branch, head: tree.head, changes, ahead: ahead ?? 0, behind: behind ?? 0, movedAt: this.movedAt(path),
        ...(tree.hereReplay ? { hereReplay: tree.hereReplay } : {}),
        ...(tree.branch?{presence:workerPresence(path,tree.branch)}:{}) };
    });
  }
  /**
   * Every tree, with what uses each landed one, for display. A failed
   * observation is that tree's `ownershipError`, and the others are still
   * read; a defect is a hard error. Decisions never read this: each reset
   * observes for itself (`resetTree`).
   */
  statusTrees(): StatusTree[] {
    return this.trees().map(tree => {
      if (tree.state !== "landed") return { ...tree, users: [] };
      try { return { ...tree, users: this.users(tree.path) }; }
      catch (error) { if (error instanceof PoolOwnershipUnavailable) return { ...tree, users: [], ownershipError: error.message }; throw error; }
    });
  }
  /** Each tree, with its target measured. */
  measured<T extends PoolTree>(trees: readonly T[]): MeasuredTree<T>[] { return trees.map(t => ({ ...t, targetBytes: this.target(t.path) })); }

  /** Whether the disk can host one more tree (`Room`). */
  room(trees: readonly MeasuredTree[] = this.measured(this.trees())): Room {
    const snapshot=this.capacity.poolSnapshot(this.dir,this.leases(trees));
    return this.roomFor(snapshot.freeBytes,snapshot.reservedBytes,snapshot.leases.filter(lease=>lease.remainingBytes>0).length,this.capacity.forecast.bytes);
  }
  private leases(trees:readonly PoolTree[]):BuildLease[]{return trees.filter(tree=>tree.state==='held'&&workerPresence(tree.path,tree.branch!).state==='attached').map(tree=>({root:tree.path,target:join(tree.path,'target')}));}
  /** Admission for a fresh hold or a newly restored cold/partial promise.
   * Existing counted leases are handled idempotently by setPresence. */
  private admitLease(path:string,resuming=false,previous?:ReclaimReport|null):void{
    const pending={root:path,target:join(path,'target')};
    this.capacity.protectPoolLease(pending);
    const measure=()=>{
      // Decide from one complete hypothetical snapshot. Another builder may
      // consume its promise while snapshots are read; a difference of whole
      // totals would mistake that progress for capacity belonging to this take.
      const snapshot=this.capacity.poolSnapshot(this.dir,[...this.leases(this.trees()),pending]);
      const bytes=snapshot.leases.find(lease=>lease.root===path)!.remainingBytes;
      return this.roomFor(snapshot.freeBytes,snapshot.reservedBytes-bytes,
        snapshot.leases.filter(lease=>lease.root!==path&&lease.remainingBytes>0).length,bytes);
    };
    if(resuming&&measure().treeBytes===0)return;
    const room=measure();
    if(!room.ok)throw new PoolFull({...room,why:room.why+describeReclamation(previous)});
    try{this.capacity.admitPoolLease(pending);}catch(error){if(error instanceof DiskBuildAdmissionError){const seen=measure();throw new PoolFull({...seen,ok:false,why:error.message});}throw error;}
  }
  private roomFor(freeBytes:number,reservedBytes:number,unbuilt:number,treeBytes:number):Room {
    const floorBytes = treeBytes + DISK_MARGIN_BYTES;
    const ok = freeBytes - reservedBytes >= floorBytes;
    const why = ok ? null : `${gb(freeBytes)} free${unbuilt ? `, ${gb(reservedBytes)} of it promised to ${unbuilt} active cold lease${unbuilt === 1 ? "" : "s"}` : ""}; `
      + `another tree needs ${gb(treeBytes)} for its target and ${gb(DISK_MARGIN_BYTES)} must stay free beside it (the gate's floor), ${gb(floorBytes)} in all. `
      + `Wait for a tree to be given back, or free disk.`;
    return { ok, freeBytes, treeBytes, unbuilt, reservedBytes, floorBytes, why };
  }

  private locked<T>(body: () => T): T {
    return this.capacity.poolOperation(body,()=>{throw new TreeInUse(this.dir);});
  }

  /** The FD is the ownership fence that pre-intent resetters already read. */
  private pinned<T>(path:string,create:boolean,body:(pin:TreePin)=>T):T{
    assertNoHereRestore(path);
    return this.capacity.poolTarget(path,()=>{
    let pin:TreePin|undefined;
    try{
      this.capacity.transactions.run('pool-tree-pin',path,()=>{pin=TreePin.open(path,create);});
      return body(pin!);
    }finally{
      if(pin)try{
        if(pin.emptyPlaceholder())this.capacity.transactions.run('pool-placeholder-retire',path,()=>pin!.removePlaceholder());
      }finally{pin.close();}
    }
    });
  }

  /** A new tree, detached at main, with its inputs, when the disk can host it. */
  private grow(name: string,ownPin?:TreePin): void {
    const path=join(this.dir,name);
    if(!ownPin)return this.pinned(path,true,pin=>this.grow(name,pin));
    const snapshot=this.capacity.poolSnapshot(this.dir,this.leases(this.trees()));
    const room=this.roomFor(snapshot.freeBytes,snapshot.reservedBytes,snapshot.leases.filter(lease=>lease.remainingBytes>0).length,0);
    if (!room.ok) throw new PoolFull(room);
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
    this.capacity.reclaim(this.dir);
    return this.locked(() => {
      for (let i = 1; i <= n; i++) if (!existsSync(join(this.dir, String(i)))) this.grow(String(i));
      return this.trees();
    });
  }

  /**
   * A tree on `branch`: the task's own if it holds one; else a free tree,
   * warm first; else a new one, when the disk can host it (`PoolFull` when it
   * cannot). The task's branch is checked out if it exists, else made at the
   * newest main. While a gate run or reclamation holds the chosen tree's
   * resource lock, `TreeInUse` refuses before anything changes.
   */
  take(branch: string): PoolTree {
    if (!taskBranch(branch)) throw new Error(`not a task branch: ${branch}`);
    const previous=this.prepareAdmission(branch);
    return this.locked(() => {
      for(;;){
        const trees=this.trees(),mine=trees.find(tree=>tree.branch===branch);
        if(mine){
          const result=this.pinned(mine.path,false,pin=>{
            // A legacy give already inside the shared lock finishes before
            // the pin publishes. Select again from the result it left behind.
            const current=this.trees().find(tree=>tree.name===mine.name&&tree.branch===branch);
            if(!current)return null;
            this.setPresence(current,'attached',pin);this.inputs(current.path);
            return this.trees().find(tree=>tree.name===current.name)!;
          });
          if(result)return result;continue;
        }
        const available=this.trees(),elsewhere=worktrees(this.git).find(tree=>tree.branch===branch);
        if(elsewhere)throw new Error(`${branch} is checked out in ${elsewhere.path}, outside the pool`);
        const name=available.filter(tree=>tree.state==='free').sort((a,b)=>compatible(b)-compatible(a)||Number(a.name)-Number(b.name))[0]?.name??this.nextName();
        const path=join(this.dir,name),lock=this.treeLock(path);
        try{
          const result=this.pinned(path,true,pin=>{
            const current=this.trees().find(tree=>tree.name===name);
            if(current&&current.state!=='free'&&current.state!=='missing')return null;
            const registered=worktrees(this.git).some(tree=>resolve(tree.path)===path);
            this.admitLease(path,false,previous);
            if(!registered)this.grow(name,pin);
            const exists=run(this.git,['rev-parse','--verify','--quiet',`refs/heads/${branch}`],this.git.root).status===0;
            checked(this.git,exists?['switch','-q',branch]:['switch','-q','-c',branch,'refs/heads/main'],path);
            this.publishPresence(this.trees().find(tree=>tree.name===name)!,'fresh');
            this.inputs(path);return this.trees().find(tree=>tree.name===name)!;
          });
          if(result)return result;
        }finally{lock.close();}
      }
    });
  }

  private prepareAdmission(branch:string):ReclaimReport|null{
    const existing=(()=>{
      const tree=this.trees().find(tree=>tree.branch===branch);
      if (tree?.hereReplay) throw Error(tree.hereReplay);
      return tree?{pending:{root:tree.path,target:join(tree.path,'target')},counted:this.leases([tree]).length>0}:null;
    })();
    if(existing?.counted)return null;
    return this.capacity.reclaim(this.dir,0,undefined,existing?[existing.pending]:[]);
  }
  /** Trash retains disk bytes until reclamation drains it. Status never deletes. */
  trash():TrashEntry[]{return diskTrash(this.dir,this.capacity.host.wallNow());}

  private find(asked: string): PoolTree {
    const trees = this.trees();
    const tree = trees.find(t => t.name === asked || t.path === resolve(asked) || t.branch === asked);
    if (!tree) throw new Error(`no pool tree is ${asked}: ${trees.map(t => `${t.name} ${t.branch ?? t.state}`).join(", ")}`);
    return tree;
  }

  /** The tree's resource lock, held by this pool operation; `TreeInUse` while a gate run or reclamation holds it. */
  private treeLock(path:string):GateResource{
    assertNoHereRestore(path);
    const lock=GateResource.tryAcquire(path+'.lock');
    if(!lock)throw new TreeInUse(path);
    return lock;
  }
  /** The task branch a presence record names; refuses a tree no task holds, or a record this reader cannot replace. */
  private presenceBranch(tree:PoolTree):string{
    if(!tree.branch||tree.state!=='held'&&tree.state!=='landed')throw Error('worker presence requires a held task branch: '+tree.path);
    assertWorkerPresenceWritable(tree.path);
    return tree.branch;
  }
  private setPresence(tree:PoolTree,state:'attached'|'detached',ownPin?:TreePin):void{
    if(!ownPin)return this.pinned(tree.path,false,pin=>{
      const current=this.trees().find(row=>row.path===tree.path&&row.branch===tree.branch);
      if(!current)throw new TreeInUse(tree.path);
      return this.setPresence(current,state,pin);
    });
    this.presenceBranch(tree);
    if(state==='detached'){this.requestDetach(tree,ownPin);return;}
    // Use the lease owner's predicate, including its fail-closed default.
    // No new promise or publication is needed, even while a builder owns the
    // tree resource.
    if(this.leases([tree]).length>0)return;
    // Pending grants no reclamation. The pin and pool operation owner protect
    // publication against upkeep, so a builder need not finish before resume.
    if(tree.presence?.state==='detach-pending'){this.publishPresence(tree,'existing');return;}
    // Completed detaches and landed holds still wait for the resource.
    const lock=this.treeLock(tree.path);
    try{this.publishPresence(tree,'existing');}finally{lock.close();}
  }
  /** Publish presence under the pool operation owner and tree pin. A
   * fresh Git hold publishes its initial presence with no resume admission. */
  private publishPresence(tree:PoolTree,transition:'existing'|'fresh'):void{
    const branch=this.presenceBranch(tree);
    if(transition!=='fresh')this.admitLease(tree.path,true);
    this.capacity.transactions.run('pool-presence',tree.path,()=>{
      writeWorkerPresence(tree.path,branch,'attached',this.capacity.host.wallNow());
      this.capacity.state.advance();
    });
    // Both resume verbs publish the admitted lease before releasing the
    // operation owner: a landed mark would keep the attached promise uncounted.
    if(tree.state==='landed')this.forget(branch);
  }
  /** A successful detach records its intent before asking whether the old worker
   * has drained. Its identity is provenance, never an expiry condition. */
  private requestDetach(tree:PoolTree,pin:TreePin):void{
    const receipt=new GitReceipt(tree.path,[],'lease');
    if(this.trees().find(row=>row.path===tree.path)?.branch!==tree.branch)throw Error('branch changed without presence publication: '+tree.path);
    const presence=workerPresence(tree.path,tree.branch!);
    if(presence.diagnostic)throw Error(presence.diagnostic);
    if(presence.state==='detached')return;
    let request=presence.detachRequest;
    if(!request){
      const identity=processIdentity(process.pid);
      if(!identity)throw Error('detach requester has no process birth identity');
      request={id:randomUUID(),at:this.capacity.host.wallNow(),pid:process.pid,identity};
      this.capacity.transactions.run('pool-detach-request',tree.path,()=>{
        if(!receipt.valid())throw Error('tree or worker presence changed before detach request: '+tree.path);
        writeWorkerPresence(tree.path,tree.branch!,'detach-pending',request!.at,{request:request!,reason:'awaiting complete ownership observation'});
        this.capacity.state.advance();
      });
    }
    try{this.finishDetach(tree,request,pin);}catch(error){
      // Completion is deferred once the request is durable. A failure to
      // observe or update that result cannot turn acceptance into a refusal.
      const saved=workerPresence(tree.path,tree.branch!);
      if(saved.diagnostic||saved.state!=='detach-pending'||saved.detachRequest?.id!==request.id)throw error;
      console.warn('pool: detach pending for '+tree.branch+'; completion deferred: '+(error instanceof Error?error.message:String(error)));
    }
  }
  /** The operation owner serializes resume and upkeep. Receipts also refuse
   * legacy/manual branch or presence changes during the ownership observation. */
  private finishDetach(tree:PoolTree,request:DetachRequest,pin:TreePin):string|undefined{
    const receipt=new GitReceipt(tree.path,[],'lease');
    const current=this.trees().find(row=>row.path===tree.path),presence=current?.presence;
    if(!current||current.branch!==tree.branch)return 'branch changed without presence publication: '+tree.path;
    if(presence?.diagnostic)return presence.diagnostic;
    if(presence?.state!=='detach-pending'||presence.detachRequest?.id!==request.id)return 'detach request was replaced or cancelled: '+tree.path;
    const lock=GateResource.tryAcquire(tree.path+'.lock');
    let why:string|undefined;
    try{
      if(!lock)why='tree resource lock is held: '+tree.path;
      else{
        try{
          const users=this.users(tree.path,pin);
          if(users.length)why=using(users);
          else this.capacity.assertWorkerAbsent(tree.path,pin);
        }catch(error){why=error instanceof Error?error.message:String(error);}
      }
      return this.capacity.transactions.run('pool-detach-complete',tree.path,()=>{
        if(!receipt.valid())return 'tree or worker presence changed during detach observation: '+tree.path;
        const latest=workerPresence(tree.path,tree.branch!);
        if(latest.diagnostic)return latest.diagnostic;
        if(latest.state!=='detach-pending'||latest.detachRequest?.id!==request.id)return 'detach request was replaced or cancelled: '+tree.path;
        if(why){
          if(latest.pendingReason!==why){
            writeWorkerPresence(tree.path,tree.branch!,'detach-pending',request.at,{request,reason:why});
            this.capacity.state.advance();
          }
        }else{
          writeWorkerPresence(tree.path,tree.branch!,'detached',this.capacity.host.wallNow());
          this.capacity.state.advance();
        }
        return why;
      });
    }finally{lock?.close();}
  }
  attach(branch:string):PoolTree{return this.presence(branch,'attached');}
  detach(branch:string):PoolTree{return this.presence(branch,'detached');}
  private presence(branch:string,state:'attached'|'detached'):PoolTree{
    if(state==='attached')this.prepareAdmission(branch);
    return this.locked(()=>{
      const tree=this.trees().find(tree=>tree.branch===branch);
      if(!tree)throw Error('no pool tree holds branch '+branch);
      this.setPresence(tree,state);
      const current=this.trees().find(row=>row.name===tree.name);
      if(state==='detached'&&(!current||current.branch!==branch||current.presence?.diagnostic))
        throw Error(current?.presence?.diagnostic??'branch changed without presence publication: '+tree.path);
      return current!;
    });
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
      const reset = this.resetTree(tree.path, discard);
      if (reset.users.length) throw new Error(`cannot reset ${tree.path}: ${using(reset.users)} (a shell or editor with its working directory there counts too, the asking session's own included: give it back from outside the tree)`);
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
      if (tree.hereReplay) return { tree, state: 'kept', reason: tree.hereReplay };
      // Committed on past what landed: its task goes on there.
      if (tree.head !== landed) return { tree, state: "kept", reason: `pool tree ${tree.name} has commits past the one that landed, so it stays its task's` };
      const kept = (reason: string) => { this.mark(branch, landed); return { tree: this.trees().find(t => t.name === tree.name)!, state: "kept" as const, reason }; };
      if (tree.changes.length) return kept(`pool tree ${tree.name} has uncommitted changes: ${tree.changes.slice(0, 3).join("; ")}; it stays on its branch, and the next upkeep resets it once they are gone and nothing uses it`);
      let reset: { users: TreeUser[] };
      try { reset = this.resetTree(tree.path, false); }
      catch (error) {
        if (!(error instanceof PoolOwnershipUnavailable)&&!(error instanceof TreeInUse)) throw error;
        return kept(`pool tree ${tree.name} stays on its branch: ${error.message}; the next upkeep resets it once a complete observation finds nothing uses it`);
      }
      if (reset.users.length) return kept(`pool tree ${tree.name} stays on its branch while ${using(reset.users)} (a shell or editor with its working directory there counts too); the next upkeep resets it once nothing does`);
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
    if (tree.hereReplay) return { why: tree.hereReplay };
    if (tree.head !== landed) { this.forget(tree.branch); return null; }
    if (tree.changes.length) return { why: `it has uncommitted changes: ${tree.changes.slice(0, 3).join("; ")}` };
    let reset: { users: TreeUser[] };
    try { reset = this.resetTree(tree.path, false); }
    catch (error) { if (error instanceof PoolOwnershipUnavailable||error instanceof TreeInUse) return { why: `${error.message}; kept until a complete observation finds nothing uses it` }; throw error; }
    if (reset.users.length) return { why: `${using(reset.users)} (a shell or editor with its working directory there counts too)` };
    const outcome = deleteBranch(this.git, tree.branch!, landed, null);
    this.forget(tree.branch);
    return { outcome };
  }

  /**
   * Detach a tree at main -- unless a live process uses it: its users then
   * come back, and nothing changed. This is the one observation a reset
   * reads; its callers (give, release, settle) decide from its answer. They
   * retain the operation intent and tree resource throughout, so no take or
   * attach hands the tree out between the observation and the reset. `PoolOwnershipUnavailable` when no
   * complete observation certifies the tree idle.
   */
  private resetTree(path: string, discard: boolean): { users: TreeUser[] } {
    const resource=this.treeLock(path);
    try{
    return this.pinned(path,false,pin=>{
    const users=this.users(path,pin);
    if(users.length)return {users};
    this.capacity.assertWorkerAbsent(path,pin);
    assertWorkerPresenceWritable(path);
    if (discard) {
      checked(this.git, ["checkout", "-q", "--detach", "--force", "refs/heads/main"], path);
      removeWorkerPresence(path);
      checked(this.git, ["clean", "-fdq", "-e", "third_party", "-e", "node_modules", "-e", "**/node_modules"], path);
    } else {
      checked(this.git, ["switch", "-q", "--detach", "refs/heads/main"], path);
      removeWorkerPresence(path);
    }
    return {users:[]};
    });
    }finally{resource.close();}
  }

  /**
   * The upkeep: first each landed tree is reset once nothing uses it and
   * nothing is left in it (`settle`). Then free trees idle longer than
   * `idleMs` go, cold ones first, then the longest idle, while more than
   * `keep` trees are free. Pending worker detaches complete under the same
   * ownership guards, without changing their held branch or task work.
   * Each operation uses a nonwaiting owner; the shared pool lock never spans
   * a reset, scan or removal.
   */
  prune({ idleMs = IDLE_LIMIT_MS, keep = WARM_MINIMUM, now = Date.now() }: { idleMs?: number; keep?: number; now?: number } = {}): Pruned {
    if(keep<WARM_MINIMUM)throw Error('pool upkeep must keep at least two warm targets');
    const out: Pruned = { released: [], waiting: [], removed: [], kept: [], free: 0,reclamation:null,detached:[],detachWaiting:[] };
    if (!existsSync(this.dir)) return out;
    for (const tree of this.trees()) if (tree.hereReplay) out.kept.push({tree, why: tree.hereReplay});
    for (const name of this.locked(() => this.trees().filter(t => t.state === "landed").map(t => t.name))) {
      this.locked(() => {
        const tree = this.trees().find(t => t.name === name), landed = tree?.branch ? this.landed().get(tree.branch) : undefined;
        if (!tree || landed === undefined) return;
        const settled = this.settle(tree, landed);
        if (settled && "why" in settled) out.waiting.push({ tree, why: settled.why });
        else if (settled) out.released.push({ tree: this.trees().find(t => t.name === name)!, branch: tree.branch!, outcome: settled.outcome });
      });
    }
    // A resumed worker cancels its old request. Re-read it under the operation
    // owner rather than carrying a pending decision across the upkeep scan.
    for(const name of this.trees().filter(tree=>tree.presence?.state==='detach-pending'||tree.presence?.diagnostic).map(tree=>tree.name)){
      this.locked(()=>{
        const tree=this.trees().find(row=>row.name===name);
        if(!tree?.branch||tree.hereReplay)return;
        if(tree.presence?.diagnostic){out.detachWaiting.push({tree,why:tree.presence.diagnostic});return;}
        const request=tree.presence?.detachRequest;
        if(tree.presence?.state!=='detach-pending'||!request)return;
        const why=this.pinned(tree.path,false,pin=>this.finishDetach(tree,request,pin));
        if(why)out.detachWaiting.push({tree,why});
        else out.detached.push(this.trees().find(row=>row.name===name)!);
      });
    }
    // A mark whose branch moved on is its task's again, and one whose branch no
    // tree holds was given back by hand or lost its tree: either marks nothing.
    this.locked(() => {
      const heads = new Map(this.trees().flatMap(t => t.branch ? [[t.branch, t.head] as const] : []));
      for (const [branch, landed] of this.landed()) if (heads.get(branch) !== landed) this.forget(branch);
    });
    const trees=this.trees();
    out.reclamation=this.capacity.reclaim(this.dir,0,{before:now-idleMs,keep});
    this.locked(()=>{
      for(const removal of out.reclamation?.removed??[]){
        const tree=trees.find(row=>row.path===removal.root);
        if(tree&&removal.kind==='unbuilt-checkout')out.removed.push({tree,targetBytes:null});
      }
      out.free=this.trees().filter(tree=>tree.state==='free').length;
    });
    return out;
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

export function describePool(trees: readonly (PoolTree | StatusTree | MeasuredTree | MeasuredTree<StatusTree>)[], now = Date.now()): string {
  if (!trees.length) return "  no pool trees";
  return trees.map(t => {
    const task = t.state === "landed" ? `landed ${t.branch}` : t.branch ? `task ${t.branch}` : t.state;
    const where = t.state === "missing" ? "" : `${t.ahead ? `${t.ahead} ahead of main` : ""}${t.ahead && t.behind ? ", " : ""}${t.behind ? `${t.behind} behind` : ""}`;
    const changes = t.changes.length ? `, ${t.changes.length} uncommitted` : "";
    const landed = !("users" in t) || t.state !== "landed" ? "" : t.ownershipError ? `, ownership observation failed; kept: ${t.ownershipError}`
      : t.users.length ? `, kept while ${using(t.users)}` : t.changes.length ? "" : ", reset at the next upkeep";
    const idle = t.movedAt === null ? "" : `, idle ${idleFor(now - t.movedAt)}`;
    const target = "targetBytes" in t ? `, ${t.targetBytes === null ? "no target" : `target ${gb(t.targetBytes)}`}` : "";
    const presence=t.presence?.diagnostic?`, worker presence unknown: ${t.presence.diagnostic}`:t.presence?.state==='detach-pending'?`, detach pending: ${t.presence.pendingReason}`:'';
    return `  ${t.name.padStart(2)}  ${t.path}  ${task}${where ? ` (${where})` : ""}${changes}${landed}${idle}${target}${presence}${t.hereReplay ? `, ${t.hereReplay}` : ''}`;
  }).join("\n");
}

export function describeRoom(room: Room): string {
  return room.ok ? `room for another tree (${gb(room.freeBytes)} free, ${gb(room.reservedBytes)} promised to ${room.unbuilt} active cold leases; ${gb(room.treeBytes)} for its declared build outputs, ${gb(DISK_MARGIN_BYTES)} floor)`
    : `no room for another tree: ${room.why}`;
}

/** What the pool's status says, for a scheduler (`status --json`). */
export function statusJson(dir: string, trees: readonly MeasuredTree<StatusTree>[], room: Room, now = Date.now(),trash:readonly TrashEntry[]=[]) {
  return {
    version: 2, pool: dir, trash, idle_limit_ms: IDLE_LIMIT_MS, warm_minimum: WARM_MINIMUM,
    room: { ok: room.ok, free_bytes: room.freeBytes, tree_bytes: room.treeBytes, unbuilt: room.unbuilt, reserved_bytes: room.reservedBytes, floor_bytes: room.floorBytes, why: room.why },
    trees: trees.map(t => ({
      name: t.name, path: t.path, state: t.state, task: t.branch, head: t.head, ahead: t.ahead, behind: t.behind, uncommitted: t.changes.length,
      moved_at: t.movedAt === null ? null : new Date(t.movedAt).toISOString(), idle_ms: t.movedAt === null ? null : Math.max(0, now - t.movedAt), target_bytes: t.targetBytes,
      users: t.users.map(user => ({ pid: user.pid, command: user.command, where: user.where })),
      ...(t.hereReplay ? { here_replay: t.hereReplay } : {}),
      ...(t.ownershipError?{ownership_error:t.ownershipError}:{}),
      ...(t.presence?{worker_presence:t.presence.diagnostic?'unknown':t.presence.state,detached_at:t.presence.detachedAt,
        presence_diagnostic:t.presence.diagnostic??null,...(t.presence.detachRequest?{detach_request:t.presence.detachRequest,pending_reason:t.presence.pendingReason}:{})}:{}),
    })),
  };
}

/** Read-only reporting never turns an unknown owner into a reset decision. */
export function reportPoolStatus(pool:Pool,json=false):number{
  const trees=pool.measured(pool.statusTrees()),room=pool.room(trees),trash=pool.trash();
  if(json)console.log(JSON.stringify(statusJson(pool.dir,trees,room,undefined,trash),null,2));
  else console.log(`pool ${pool.dir}: ${trees.length} tree${trees.length===1?"":"s"}, ${describeRoom(room)}\n${describePool(trees)}`);
  if(!json)for(const entry of trash)console.log(`disk trash: ${entry.path}; ${entry.allocatedBytes??'unknown'} allocated bytes; age ${Math.floor(entry.ageMs/1000)}s${entry.ageMs>3_600_000?'; stuck drain':''}${entry.diagnostic?'; '+entry.diagnostic:''}`);
  return 0;
}

/** The upkeep's lines, for the full check's log. */
export function pruneLines(pruned: Pruned): string[] {
  const lines = pruned.released.map(({ tree, branch, outcome }) =>
    `pool: reset tree ${tree.name}, whose task ${branch} landed, now that nothing uses it${outcome.map(b => `; its branch here ${b.state}${b.reason ? ` (${b.reason})` : ""}`).join("")}`);
  for(const tree of pruned.detached)lines.push(`pool: detached tree ${tree.name}, task ${tree.branch}, now that nothing uses it`);
  for(const {tree,why} of pruned.detachWaiting)lines.push(`pool: detach pending or protected for tree ${tree.name}, task ${tree.branch}: ${why}`);
  for (const { tree, why } of pruned.waiting) lines.push(`pool: kept tree ${tree.name} on its landed branch ${tree.branch}: ${why}`);
  for(const row of pruned.reclamation?.removed??[])lines.push(`disk: removed ${row.root}, ${row.kind}, ${row.allocatedBytes} allocated bytes; free-space change ${row.freeBytesChange} bytes; ${row.facts.join('; ')}`);
  for(const row of pruned.reclamation?.kept??[])if(!row.routine)lines.push(`disk: kept ${row.root}: ${row.reason}`);
  for (const { tree, why } of pruned.kept) lines.push(`pool: kept tree ${tree.name}, which could not be removed: ${why}`);
  if (pruned.removed.length) lines.push(`pool: ${pruned.free} free checkout${pruned.free === 1 ? "" : "s"} remain`);
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
      return reportPoolStatus(pool,args.includes("--json"));
    } else if (command === "take" && target) { const t = pool.take(target); console.log(`${t.path}\n  task ${t.branch}, at ${t.head.slice(0, 12)}`); }
    else if((command==='attach'||command==='detach')&&target){const t=pool[command](target);console.log(`pool tree ${t.name}, task ${t.branch}: ${t.presence!.state}`);}
    else if (command === "give" && target) {
      const given = pool.give(target, { discard: args.includes("--discard") });
      console.log(`pool tree ${given.tree.name} is free, at main ${given.tree.head.slice(0, 12)}`);
      for (const b of given.branch) console.log(`  branch ${b.where === "local" ? "here" : `on ${pool.remote}`}: ${b.state}${b.reason ? ` (${b.reason})` : ""}`);
    } else if (command === "init" && target) { pool.init(Number(target)); console.log(describePool(pool.statusTrees())); }
    else if (command === "prune") { const lines = pruneLines(pool.prune()); console.log(lines.length ? lines.join("\n") : "pool: nothing to remove"); }
    else { console.error("usage: pool.ts status [--json] | take <branch> | take --issue <N> [--slug <words>] | attach <branch> | detach <branch> | give <branch|tree> [--discard] | init <n> | prune  [--pool <dir>]"); return 2; }
    return 0;
  } catch (error) {
    console.error(`pool: ${(error as Error).message}`);
    return poolExit(error);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
