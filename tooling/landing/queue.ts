import {assertStateVersion,assertWritableState,FutureStateVersionError} from '../gate/state-version.ts';
import {withStateLock,versionedRecord,withStateWrite} from '../gate/state-file.ts';
// The landing queue: one durable file per change waiting to land, checked one
// at a time against the newest main, each answered by a result file.
//
//   <home>/queue/<key>.json     waiting, in key order; a revert from the full
//                               check sorts first (`first`)
//   <home>/checking.json        the change being checked now
//   <home>/held/<id>.json       a change whose check could not finish for a
//                               reason only a person can clear
//   <home>/results/<id>.json    every answer: landed, refused, withdrawn, held
//   <home>/withdraw/<id>        a withdrawal asked while the change is checked
//   <home>/status.json          what the service is doing
//
// Every write is durable (durable-record.ts): a crash leaves either the old
// file or the new one, never half of one, and the service resumes from them.
//
// `submit` queues a change and makes sure a service drains the queue; the
// full check calls it with `first` to put a revert ahead of every change.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync } from "node:fs";
import {LANDING_HOME} from './layout.ts';
export {LANDING_HOME} from './layout.ts';
import { join } from "node:path";
import { systemdEnvironment } from "../gate/environment.ts";
import { OOM_SCORE } from "../gate/memory-ledger.ts";
import { revParse, sharedCheckout } from "./git.ts";
import { holder } from "./lock.ts";
import type {DiskBuildRefusal} from '../differential/command-entry/instrument.ts';

export type Entry = {
  version: 1; id: string; sha: string;
  /** The task's branch, deleted when the change lands; null when it has none. */
  branch: string | null;
  /** The tree it was submitted from, when it was a tree. */
  tree: string | null;
  first: boolean; submitted_at: string; by: string; note?: string;
};
export type Checking = Entry & { started_at: string; base?: string; tip?: string; run?: string; phase?: "checking" | "landing" };
export type State = "landed" | "refused" | "withdrawn" | "held";
export type Result = {
  version: 1; id: string; sha: string; state: State; message: string; at: string;
  /** Source-owned answer identity; wall time is display data only. */
  answerNonce?:string;
  /** The task's branch the change came from (Entry.branch); absent in answers from before it was kept. */
  task?: string | null;
  /** main before and after; `commits` are base..tip, the change as it landed. */
  base?: string; tip?: string; commits?: string[]; run?: string;
  landing?: string[]; deferred?: string[]; estimate_s?: number; wall_s?: number;
  pending?: string[]; pushed?: boolean; branch?: unknown; pool?: string | null;
  /** Drained work that automatically returns at its original arrival once disk admits. */
  retryDisk?:DiskBuildRefusal[];
};
export type Status = { version: 1; state: "idle" | "checking" | "landing" | "held"; at: string; id?: string; sha?: string; message?: string; run?: string; since?: string };

const now = () => new Date().toISOString();
const readJson = <T>(path: string): T | null => { try { const value:unknown=JSON.parse(readFileSync(path,"utf8"));assertStateVersion(value,1,path);return value as T; } catch(error) {if(error instanceof FutureStateVersionError)throw error;return null;} };
const files = (dir: string) => { try { return readdirSync(dir).filter(name => name.endsWith(".json")).sort(); } catch { return []; } };

export class Queue {
  readonly home: string;
  constructor(home: string) {
    this.home = home;
    for (const dir of ["queue", "held", "results", "withdraw"]) mkdirSync(join(home, dir), { recursive: true });
  }
  private path(...parts: string[]) { return join(this.home, ...parts); }
  private mutate<T>(write:()=>T):T {return withStateLock(this.path("queue-state"),write);}
  private record(path:string,value:unknown):void {versionedRecord(path,1,value,this.path("queue-state"));}
  private remove(path:string):void {if(existsSync(path))withStateWrite(path,1,()=>rmSync(path,{force:true}),this.path("queue-state"));}

  /** Queue `sha` to land. `first` puts it ahead of every change waiting (the full check's reverts). */
  submit(sha: string, options: { branch?: string | null; tree?: string | null; first?: boolean; by?: string; note?: string } = {}): Entry {
    return this.mutate(()=>{
      if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error(`submit wants a full commit id, not ${sha}`);
      const first = options.first === true;
      const entry: Entry = { version: 1, id: `${sha.slice(0, 12)}-${randomUUID().slice(0, 8)}`, sha, branch: options.branch ?? null,
        tree: options.tree ?? null, first, submitted_at: now(), by: options.by ?? "agent", ...(options.note ? { note: options.note } : {}) };
      this.record(this.path("queue", `${this.key(entry)}.json`), entry);
      return entry;
    });
  }
  // `0-` sorts ahead of `1-`; among equals, by time and then id.
  private key(entry: Entry): string {
    return `${entry.first ? 0 : 1}-${String(Date.parse(entry.submitted_at)).padStart(15, "0")}-${entry.id}`;
  }

  /** The changes waiting, in the order they will be checked. */
  waiting(): Entry[] {
    return files(this.path("queue")).map(name => readJson<Entry>(this.path("queue", name))).filter((e): e is Entry => e !== null);
  }
  /** Move the next waiting change to `checking.json`; null when none waits. */
  take(): Checking | null {
    return this.mutate(()=>{
      for (const name of files(this.path("queue"))) {
        const entry = readJson<Entry>(this.path("queue", name));
        if (!entry) { this.remove(this.path("queue", name)); continue; }
        const checking: Checking = { ...entry, started_at: now(), phase: "checking" };
        this.record(this.path("checking.json"), checking);
        this.remove(this.path("queue", name));
        return checking;
      }
      return null;
    });
  }
  checking(): Checking | null { return readJson<Checking>(this.path("checking.json")); }
  update(fields: Partial<Checking>): Checking {
    return this.mutate(()=>{
      const current = this.checking();
      if (!current) throw new Error("no change is being checked");
      const next = { ...current, ...fields };
      this.record(this.path("checking.json"), next);
      return next;
    });
  }
  /** Put the change being checked back at the front: its check starts again. */
  requeue(): Entry | null {
    return this.mutate(()=>{
      const current = this.checking();
      if (!current) return null;
      const { started_at: _s, base: _b, tip: _t, run: _r, phase: _p, ...entry } = current;
      const again: Entry = { ...entry, first: true };
      this.record(this.path("queue", `${this.key(again)}.json`), again);
      this.remove(this.path("checking.json"));
      return again;
    });
  }

  /** Answer `entry`: its result is durable before it leaves `checking.json`. */
  answer(entry: Entry, result: Omit<Result, "version" | "id" | "sha" | "at" | "task" | "answerNonce">,options:{retainChecking?:boolean}={}): Result {
    return this.mutate(()=>{
      if(options.retainChecking&&result.state!=='held')throw Error('only a held cancellation can retain its checking owner');
      // Validate every existing destination before publishing any part of a
      // transition; an incompatible checking/held record cannot leave an answer.
      const checking=this.checking();
      for(const path of [this.path("results",`${entry.id}.json`),this.path("withdraw",entry.id),
        this.path("held",`${entry.id}.json`)])assertWritableState(path,1);
      const full: Result = { version: 1, id: entry.id, sha: entry.sha, at: now(), task: entry.branch, ...result,answerNonce:randomUUID() };
      this.record(this.path("results", `${entry.id}.json`), full);
      if (result.state === "held") this.record(this.path("held", `${entry.id}.json`), entry);
      else this.remove(this.path("held",`${entry.id}.json`));
      if (checking?.id === entry.id&&!options.retainChecking) this.remove(this.path("checking.json"));
      // A held cancellation has not proved its drain. Keep the request so a
      // repeated withdrawal cannot turn live ownership into a terminal answer.
      if(result.state!=="held")this.remove(this.path("withdraw", entry.id));
      return full;
    });
  }
  result(id: string): Result | null { return readJson<Result>(this.path("results", `${id}.json`)); }
  results(): Result[] {
    return files(this.path("results")).map(name => readJson<Result>(this.path("results", name))).filter((r): r is Result => r !== null)
      .sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  }
  held(): Entry[] {
    return files(this.path("held")).map(name => readJson<Entry>(this.path("held", name))).filter((e): e is Entry => e !== null);
  }
  /** Queue a held change again, at the front. */
  retry(id: string): Entry {
    return this.mutate(()=>{
      const entry = readJson<Entry>(this.path("held", `${id}.json`));
      if (!entry) throw new Error(`no held change ${id}`);
      if(this.withdrawRequested(id))throw Error(`withdrawal of ${id} has not drained; its check cannot be retried`);
      const again: Entry = { ...entry, first: true, submitted_at: now() };
      this.record(this.path("queue", `${this.key(again)}.json`), again);
      this.remove(this.path("held", `${id}.json`));
      return again;
    });
  }
  /** A readiness observation cannot resurrect a withdrawal or a newer answer. */
  retryDiskReady(id:string,answerNonce:string):Entry|null{
    return this.mutate(()=>{
      const entry=readJson<Entry>(this.path('held',`${id}.json`)),answer=this.result(id);
      if(!entry||answer?.state!=='held'||!answer.answerNonce||answer.answerNonce!==answerNonce||!answer.retryDisk?.length||this.withdrawRequested(id))return null;
      this.record(this.path('queue',`${this.key(entry)}.json`),entry);
      this.remove(this.path('held',`${id}.json`));
      return entry;
    });
  }

  /** The entry an id or a commit (or its prefix) names, waiting, checked or held. */
  find(asked: string): { entry: Entry; where: "waiting" | "checking" | "held" } | null {
    const match = (e: Entry) => e.id === asked || (asked.length >= 7 && e.sha.startsWith(asked));
    const checking = this.checking();
    if (checking && match(checking)) return { entry: checking, where: "checking" };
    for (const e of this.waiting()) if (match(e)) return { entry: e, where: "waiting" };
    for (const e of this.held()) if (match(e)) return { entry: e, where: "held" };
    return null;
  }
  /**
   * Withdraw a change: one waiting or held is answered at once; the one being
   * checked is cancelled and answered only after its owned work drains.
   * Publication and this request share the same lock: after main advances,
   * a withdrawal is too late rather than a promise that it cannot land.
   */
  withdraw(asked: string): "withdrawn" | "requested" | "too-late" | "unknown" {
    return this.mutate(()=>{
      const found = this.find(asked);
      if (!found) return this.results().some(e=>e.state==='landed'&&(e.id===asked||(asked.length>=7&&e.sha.startsWith(asked))))?'too-late':"unknown";
      if(found.where==='checking'&&this.checking()?.phase==='landing')return 'too-late';
      if(found.where==='held'&&this.result(found.entry.id)?.retryDisk?.length){
        this.answer(found.entry,{state:'withdrawn',message:'withdrawn while waiting for disk: its run already drained'});return 'withdrawn';
      }
      if(found.where==='checking'||found.where==='held'&&this.withdrawRequested(found.entry.id)){
        this.record(this.path('withdraw',found.entry.id),{version:1,at:now(),request:randomUUID()});return 'requested';
      }
      for (const dir of ["queue", "held"]) for (const name of files(this.path(dir))) {
        if (readJson<Entry>(this.path(dir, name))?.id === found.entry.id) this.remove(this.path(dir, name));
      }
      this.answer(found.entry, { state: "withdrawn", message: "withdrawn before it was checked" });
      return "withdrawn";
    });
  }
  withdrawRequested(id: string): boolean { return existsSync(this.path("withdraw", id)); }
  withdrawalMarker(id:string):string|undefined{
    try{return readFileSync(this.path('withdraw',id),'utf8');}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  }

  /** The final withdrawal check and main's compare-and-swap are one queue
   * transition. A failed compare-and-swap restores the cancellable phase. */
  publish<T extends {ok:boolean}>(id:string,advance:()=>T):{withdrawn:true}|{withdrawn:false;result:T}{
    return this.mutate(()=>{
      const current=this.checking();
      if(current?.id!==id||current.phase==='landing')throw Error(`no cancellable landing check ${id}`);
      if(this.withdrawRequested(id))return {withdrawn:true};
      this.update({phase:'landing'});
      const result=advance();
      if(!result.ok)this.update({phase:'checking'});
      return {withdrawn:false,result};
    });
  }

  status(): Status { return readJson<Status>(this.path("status.json")) ?? { version: 1, state: "idle", at: now() }; }
  setStatus(fields: Omit<Status, "version" | "at">): void {
    return this.mutate(()=>{
      const previous = this.status();
      const since = previous.state === fields.state && previous.id === fields.id ? previous.since ?? previous.at : now();
      this.record(this.path("status.json"), { version: 1, at: now(), since, ...fields });
    });
  }
}

// ---------------------------------------------------------------------------
// Joining the queue: what an agent's `check.ts <commit>` and the full check's
// revert call.
// ---------------------------------------------------------------------------

/** The landing check's state on this machine: its queue and answers, its runs (kept three days), its tree and target. */
export const SERVICE_UNIT = "nts-landing-check";

/** Whether a service holds the queue now. */
export function serviceRunning(home = LANDING_HOME): boolean {
  return holder(join(home, "serve.lock")) !== null;
}

/**
 * Start the service unless one is draining: a user unit of its own, run from
 * the shared checkout, so it runs main's code with the host capabilities the
 * steps need, and outlives the process that asked. Without systemd it is a
 * detached process logging to the landing home.
 */
export function ensureService(root: string, home = LANDING_HOME, env: NodeJS.ProcessEnv = process.env): string {
  if (serviceRunning(home)) return "running";
  const script = join(root, "tooling/landing/check.ts");
  if (spawnSync("systemd-run", ["--version"], { stdio: "ignore" }).status === 0) {
    // Its work is the last a machine out of memory kills (OOM_SCORE).
    const r = spawnSync("systemd-run", ["--user", `--unit=${SERVICE_UNIT}`, "--collect", "--quiet", "-p", "LimitCORE=0", "-p", `OOMScoreAdjust=${OOM_SCORE.landing}`,
      `--working-directory=${root}`, ...systemdEnvironment(env), process.execPath, script, "serve"], { encoding: "utf8" });
    // A unit that exists already is one starting or draining: the lock says which soon.
    return r.status === 0 ? `started ${SERVICE_UNIT}` : /already (exists|loaded)/.test(r.stderr ?? "") ? "starting" : `could not start ${SERVICE_UNIT}: ${(r.stderr ?? "").trim()}`;
  }
  mkdirSync(home, { recursive: true });
  const log = openSync(join(home, "serve.log"), "a");
  const child = spawn(process.execPath, [script, "serve"], { cwd: root, env, detached: true, stdio: ["ignore", log, log] });
  child.unref();
  return `started process ${child.pid}`;
}

/**
 * Queue `commit` to land, and make sure a service drains the queue. The full
 * check submits a revert with `first`, ahead of every change waiting.
 */
export function submit(commit: string, options: { first?: boolean; branch?: string | null; tree?: string | null; by?: string; note?: string; root?: string; home?: string } = {}): Entry {
  const root = options.root ?? sharedCheckout(), home = options.home ?? LANDING_HOME;
  const sha = revParse({ root }, commit);
  const entry = new Queue(home).submit(sha, { branch: options.branch ?? null, tree: options.tree ?? null, first: options.first, by: options.by ?? (options.first ? "full-check" : "agent"), note: options.note });
  ensureService(root, home);
  return entry;
}
