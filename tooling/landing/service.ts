import {gitArguments} from "../gate/git-arguments/main.ts";
import {withStateWrite} from '../gate/state-file.ts';
// The landing service: the queue drained one change at a time, against the
// newest main (docs/workflow.md, "Landing: the landing check").
//
// For each change, in queue order:
//
//   1. rebase it onto main; a conflict refuses it, naming the files; a change
//      from issue N's branch that does not name the issue says "Fixes #N"
//      (tooling/tasks/links.ts), so the issue closes when main reaches it;
//   2. select its landing steps (selection.ts over owed-range.ts's answer);
//   3. run them in the landing tree (run.ts); red refuses it with the failing
//      steps and the run's directory; an unfinished measurement holds it;
//   4. move main to it, by compare-and-swap; if main moved meanwhile, check it
//      again on the new main;
//   5. push main, give the task's pool tree back at the new main, and delete
//      the task's branch here and on the remote. A tree something still uses,
//      or with work left in it, stays on its branch, and the pool's next
//      upkeep resets it once neither holds (pool.ts's release).
//
// One service drains at a time (the owner lock); a crash puts the change it
// was checking back in front, or, when main already moved to it, finishes
// the landing. Runs older than three days are deleted: the logs are the
// evidence, and they are kept that long.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { advanceMain, changedPaths, deleteBranch, hasCommit, isAncestor, namingIssue, pushedMain, pushMain, rebaseOnto, revParse, treeOf, type BranchOutcome, type Git } from "./git.ts";
import { issueOfBranch } from "../tasks/branch.ts";
import { acquire } from "./lock.ts";
import { Pool, POOL_HOME, linkInputs } from "./pool.ts";
import { Queue, type Checking, type Entry, type Result } from "./queue.ts";
import {createWithdrawalWatch,type WithdrawalWatch} from './withdrawal-watch.ts';
import {landingLayout} from './layout.ts';
import { recoverLandingCancellation,removeRun, runLanding, type Ran, type RunOptions } from "./run.ts";
import { landingCeiling } from "../gate/step-bound.ts";
import { landingCpuMeasure, costKey, deferredSteps, landingSteps, machineBudget, readLandingCosts, type ChangeKind, type Selection } from "./selection.ts";
import { durableRecord } from "../gate/durable-record.ts";
import { selectionInfrastructure } from "../gate/owed-range.ts";
import { linkTree } from "../inputs/linker.ts";
import { writeLandingVerdict } from "./verdict.ts";
import {reportRustRecordDecisions} from '../gate/rust-selector-decision.ts';
import {DiskCapacity} from '../gate/disk-capacity.ts';
import {readDiskBuildRefusal,type DiskBuildRefusal} from '../gate/step-result.ts';
import {DiskReadinessWake} from './disk-readiness.ts';
import {isAbsolute,relative,resolve,sep} from 'node:path';

export const KEEP_DAYS = 3;

export type Selected = { selection: Selection; kind: ChangeKind; interop: string | null; doctests: string | null;rustRecords?:import('../gate/rust-selector-decision.ts').RustRecordDecisionAtRevision[] };
export type Config = {
  home: string; root: string; remote: string | null; tree: string; target: string; pool: Pool | null;
  env?: NodeJS.ProcessEnv;
  select: (base: string, tip: string, paths: string[]) => Selected;
  prepare: (tip: string) => void;
  runSteps: (options: RunOptions) => Promise<Ran>;
  watchWithdrawals:typeof createWithdrawalWatch;
  log: (line: string) => void;
  /** Whether the service should stop after this landing, to run its own new code. */
  restartAfter?: (paths: string[]) => boolean;
};

const short = (sha: string) => sha.slice(0, 12);
/** A change to the landing check or the gate it drives: the service restarts to run the new code. */
export const ownCode = (paths: readonly string[]) => paths.some(path => /^tooling\/(landing|gate)\//.test(path));

export type Drained = { state: "drained" | "busy" | "restart" | "held"; answered: Result[] };
export async function drain(config: Config): Promise<Drained> {
  mkdirSync(config.home, { recursive: true });
  const lock = acquire(join(config.home, "serve.lock"));
  if (!lock) return { state: "busy", answered: [] };
  const queue = new Queue(config.home);
  const answered: Result[] = [];
  let withdrawals:WithdrawalWatch|undefined;
  let diskWake:DiskReadinessWake|undefined;
  let currentHold:string|undefined;
  try {
    // A broken watch refuses service startup before any queued entry is taken.
    const reportHold=(reason?:string,error?:Error)=>{
      if(reason!==undefined)currentHold=reason;
      const current=queue.checking();
      const fault=error??withdrawals?.error;
      const message=fault?`service held: withdrawal watcher failed: ${fault.message}; restart nts-landing-check${currentHold?`; current check held: ${currentHold}`:''}`:currentHold!;
      queue.setStatus({state:'held',...(current?{id:current.id,sha:current.sha,...(current.run?{run:current.run}:{})}:{}),message});config.log(message);
    };
    const watcherFailed=(error:Error)=>reportHold(undefined,error);
    try{withdrawals=config.watchWithdrawals(queue,watcherFailed);}
    catch(error){watcherFailed(error as Error);throw error;}
    const recovered = await recover(config, queue,withdrawals,reportHold);
    if (recovered) answered.push(recovered);
    pushIfBehind(config);
    const capacity=config.pool?.capacity??new DiskCapacity({env:config.env,pool:null});
    diskWake=new DiskReadinessWake(config.home,capacity);
    // Display evidence only; each admission decision still takes a fresh snapshot.
    const diskShortages=new Map<string,number>();
    const diskFailed=(error:unknown):Drained=>{
      const message='service held: disk readiness could not be observed: '+String(error)+'; restart nts-landing-check';
      queue.setStatus({state:'held',message});config.log(message);return {state:'held',answered};
    };
    for (;;) {
      if(withdrawals.error){watcherFailed(withdrawals.error);return {state:'held',answered};}
      for(const held of queue.held())if(queue.result(held.id)?.retryDisk?.length&&queue.withdrawRequested(held.id)){
        if(queue.withdraw(held.id)==='withdrawn'){const result=queue.result(held.id)!;answered.push(result);config.log(`WITHDRAWN ${held.id}: ${result.message}`);}
      }
      try{if(diskWake.checkpoint())for(const [id,short] of retryDiskHeld(config,queue,capacity))diskShortages.set(id,short);}catch(error){return diskFailed(error);}
      const entry=queue.take();
      if(!entry){
        const diskHeld=queue.held().filter(held=>queue.result(held.id)?.retryDisk?.length&&!queue.withdrawRequested(held.id));
        if(diskHeld.length){
          const details=diskHeld.map(held=>`${held.id} needs ${diskShortages.get(held.id)??Math.max(...queue.result(held.id)!.retryDisk!.map(row=>row.shortBytes))} more bytes`);
          queue.setStatus({state:'held',id:diskHeld[0]!.id,sha:diskHeld[0]!.sha,message:'waiting for disk: '+details.join('; ')+' (last measured capacity shortfall); automatic retry at original arrival; no run reservation is held'});
          try{await diskWake.wait();}catch(error){return diskFailed(error);}continue;
        }
        break;
      }
      currentHold=undefined;
      const cancellation=withdrawals.entry(entry.id);
      let result: Result;
      try { result = await landOne(config, queue, entry,{...cancellation,hold:reportHold}); }
      catch (error) { result = unfinished(config, queue, error); }
      finally{cancellation.close();currentHold=undefined;}
      answered.push(result);
      config.log(`${result.state.toUpperCase()} ${short(entry.sha)}: ${result.message}`);
      if (result.state === "landed" && result.base && result.tip && config.restartAfter?.(changedPaths(git(config), result.base, result.tip))) {
        queue.setStatus({ state: "idle", message: "restarting to run the code that just landed" });
        return { state: "restart", answered };
      }
    }
    pushIfBehind(config);
    prune(join(config.home, "runs"), KEEP_DAYS);
    queue.setStatus({ state: "idle" });
    return { state: "drained", answered };
  } finally { diskWake?.close();withdrawals?.close();lock.release(); }
}

function checkedDiskRequests(config:Config,requests:readonly unknown[]):DiskBuildRefusal[]{
  return requests.map(value=>{
    const request=readDiskBuildRefusal(value),part=relative(resolve(config.target),request.target);
    if(request.root!==resolve(config.tree)||isAbsolute(part)||part==='..'||part.startsWith('..'+sep))
      throw Error('landing disk retry request escapes its build owner: '+request.target);
    return request;
  });
}
/** No candidate preparation or admission occurs while another entry can pass. */
function retryDiskHeld(config:Config,queue:Queue,capacity:DiskCapacity):Map<string,number>{
  const shortages=new Map<string,number>();
  for(const entry of queue.held()){
    const answer=queue.result(entry.id);if(!answer?.retryDisk?.length||queue.withdrawRequested(entry.id))continue;
    if(typeof answer.answerNonce!=='string'||!answer.answerNonce)throw Error('disk-held answer has no unique identity: '+entry.id);
    const requests=checkedDiskRequests(config,answer.retryDisk);
    const short=Math.max(0,...requests.map(request=>-capacity.buildSnapshot(request).availableBytes));shortages.set(entry.id,short);
    if(short===0){
      if(queue.retryDiskReady(entry.id,answer.answerNonce))config.log(`disk room restored: ${entry.id} returns at its original queue arrival`);
    }
  }
  return shortages;
}

function diskRetry(config:Config,ran:Ran):DiskBuildRefusal[]|undefined{
  const unfinished=ran.steps.filter(row=>row.verdict!=='PASS'&&!(row.verdict==='SKIPPED'&&row.accepted));
  const disk=unfinished.filter(row=>row.verdict==='INSTRUMENT'&&row.instrument?.kind==='disk-capacity');
  if(!disk.length||unfinished.some(row=>!disk.includes(row)&&!(row.verdict==='NOT RUN'&&disk.some(one=>one.name==='build')&&row.reason==='needs build, which is INSTRUMENT')))return;
  return checkedDiskRequests(config,disk.map(row=>row.instrument?.disk));
}

const git = (config: Config): Git => ({ root: config.root, env: config.env });

/** A change the service was checking when it stopped: landed already, or checked again from the front. */
async function recover(config: Config, queue: Queue,withdrawals:WithdrawalWatch,reportHold:(reason:string)=>void): Promise<Result | null> {
  const checking = queue.checking();
  if (!checking) return null;
  const main = revParse(git(config), "refs/heads/main");
  if (checking.phase === "landing" && checking.base && checking.tip && isAncestor(git(config), checking.tip, main)) {
    config.log(`${short(checking.sha)} landed before the service stopped; finishing it`);
    return finishLanding(config, queue, checking, checking.base, checking.tip, null, null, null);
  }
  if(queue.withdrawRequested(checking.id)){
    const cancellation=withdrawals.entry(checking.id);
    try{
      if(checking.run)await recoverLandingCancellation({tree:config.tree,target:config.target,run:checking.run,commit:checking.tip??checking.sha,steps:[],env:config.env,
        drainRetry:cancellation.waitForRetry,cancellationHold:reason=>retainCancellation(config,queue,checking,checking.run!,reason,reportHold)});
      return queue.answer(checking,{state:'withdrawn',message:'withdrawn after restart: its recorded groups and gate root are certified empty',...(checking.run?{run:checking.run}:{})});
    }finally{cancellation.close();}
  }
  config.log(`${short(checking.sha)} was being checked when the service stopped; checking it again`);
  queue.requeue();
  return null;
}

function retainCancellation(config:Config,queue:Queue,entry:Checking,run:string,reason:string,reportHold?:((reason:string)=>void)):void{
  const message=`service held: cancellation of ${entry.id} could not prove its drain: ${reason}; run ${run}; retry certification with node tooling/landing/check.ts withdraw ${entry.id}`;
  queue.answer(queue.checking()??entry,{state:'held',...(entry.base?{base:entry.base}:{}),...(entry.tip?{tip:entry.tip}:{}),run,message},{retainChecking:true});
  if(reportHold)reportHold(message);
  else{queue.setStatus({state:'held',id:entry.id,sha:entry.sha,run,message});config.log(message);}
}

/**
 * A check that threw: the change landed if main already moved to it, and is
 * held for a person otherwise. Only a step seen to fail refuses a change; one
 * change that cannot be checked never stops the queue behind it.
 */
function unfinished(config: Config, queue: Queue, error: unknown): Result {
  const checking = queue.checking()!;
  config.log(`checking ${short(checking.sha)} failed: ${String(error)}`);
  if (checking.phase === "landing" && checking.base && checking.tip && isAncestor(git(config), checking.tip, revParse(git(config), "refs/heads/main"))) {
    return finishLanding(config, queue, checking, checking.base, checking.tip, null, null, null);
  }
  return queue.answer(checking, { state: "held", message: `held: the check could not finish: ${(error as Error)?.message ?? String(error)}`,
    ...(checking.base ? { base: checking.base } : {}), ...(checking.tip ? { tip: checking.tip } : {}), ...(checking.run ? { run: checking.run } : {}) });
}

function pushIfBehind(config: Config): void {
  if (!config.remote || pushedMain(git(config), config.remote)) return;
  const pushed = pushMain(git(config), config.remote);
  config.log(pushed.ok ? `pushed main to ${config.remote}` : `main is not on ${config.remote}: ${pushed.reason}`);
}

export async function landOne(config: Config, queue: Queue, entry: Checking,cancellation?:{signal:AbortSignal;waitForRetry:()=>Promise<void>;hold:(reason:string)=>void}): Promise<Result> {
  const g = git(config);
  if (queue.withdrawRequested(entry.id)) return queue.answer(entry, { state: "withdrawn", message: "withdrawn before its check started" });
  if (!hasCommit(g, entry.sha)) return queue.answer(entry, { state: "refused", message: `${short(entry.sha)} is not a commit in ${config.root}` });
  for (let round = 1; round <= 3; round++) {
    if(queue.withdrawRequested(entry.id))return queue.answer(entry,{state:'withdrawn',message:'withdrawn before another check started'});
    const base = revParse(g, "refs/heads/main");
    queue.setStatus({ state: "checking", id: entry.id, sha: entry.sha, message: `rebasing onto main ${short(base)}` });
    const rebased = rebaseOnto(g, base, entry.sha);
    if ("conflict" in rebased) {
      const message = rebased.reason
        ? `${short(entry.sha)} does not rebase onto main ${short(base)}: ${short(rebased.conflict)} ${rebased.reason}`
        : `${short(entry.sha)} conflicts with main ${short(base)} in ${rebased.files.join(", ") || "files git did not name"} (at ${short(rebased.conflict)}): rebase it onto main and submit it again`;
      return queue.answer(entry, { state: "refused", base, message });
    }
    if (isAncestor(g, rebased.tip, base)) {
      return finishLanding(config, queue, entry, base, base, null, null, `${short(entry.sha)} is on main already`);
    }
    // A task's issue closes when main reaches the change; the commit checked
    // is the one that lands.
    const issue = entry.branch === null ? null : issueOfBranch(entry.branch);
    const tip = issue === null ? rebased.tip : namingIssue(g, base, rebased.tip, issue);
    queue.update({ base, tip, phase: "checking" });
    const paths = changedPaths(g, base, tip);
    let selected: Selected;
    try { selected = config.select(base, tip, paths); }
    catch (error) {
      const message = `the rules could not select ${short(tip)}'s steps: ${(error as Error).message}`;
      return queue.answer(entry, { state: selectionInfrastructure(error) ? "held" : "refused", base, tip, message });
    }
    const steps = landingSteps(selected.selection);
    reportRustRecordDecisions(selected.rustRecords,config.log);
    const run = join(config.home, "runs", `${short(tip)}-${Date.now()}`);
    queue.update({ run });
    queue.setStatus({ state: "checking", id: entry.id, sha: entry.sha, run, message: `${steps.join(" ")} on ${short(tip)}, ~${Math.round(selected.selection.estimate.seconds)} s` });
    config.log(`${short(entry.sha)} as ${short(tip)} on main ${short(base)}: ${steps.join(" ") || "nothing to run"}; deferred ${deferredSteps(selected.selection).join(" ") || "none"}`);
    let ran: Ran;
    if (!steps.length) ran = { state: "green", message: "nothing to run", run, steps: [], pending: [], wall_s: 0 };
    else {
      if(queue.withdrawRequested(entry.id))return queue.answer(entry,{state:'withdrawn',base,tip,run,message:'withdrawn before the landing tree was prepared'});
      try { config.prepare(tip); }
      catch (error) { return queue.answer(entry, { state: "held", base, tip, run, message: `the landing tree could not be prepared at ${short(tip)}: ${(error as Error).message}` }); }
      ran = await config.runSteps({ tree: config.tree, target: config.target, run, commit: tip, steps, interop: selected.interop, doctests: selected.doctests,
        rustRecords:selected.rustRecords,
        ceiling: landingCeiling(selected.selection.estimate.seconds),
        env: config.env,signal:cancellation?.signal,drainRetry:cancellation?.waitForRetry,
        cancellationHold:reason=>retainCancellation(config,queue,{...entry,base,tip},run,reason,cancellation?.hold),
        hold: reason => cancellation?cancellation.hold(reason):queue.setStatus({ state: "held", id: entry.id, sha: entry.sha, run, message: reason }) });
      // What the steps cost is for the next estimate; it never decides this one.
      try { recordCosts(config.home, ran, selected.kind); } catch (error) { config.log(`costs not recorded: ${String(error)}`); }
    }
    const facts = { base, tip, run, landing: steps, deferred: deferredSteps(selected.selection), estimate_s: Math.round(selected.selection.estimate.seconds), wall_s: Math.round(ran.wall_s), pending: ran.pending };
    if(ran.state==='cancelled')return queue.answer(entry,{state:'withdrawn',...facts,message:'withdrawn: its owned commands, scopes and reservation have drained'});
    if (ran.state === "red") return queue.answer(entry, { state: "refused", ...facts, message: `red: ${ran.message}` });
    if (ran.state === "held") {
      const retryDisk=diskRetry(config,ran);
      return queue.answer(entry, { state: "held", ...facts, message: `held: ${ran.message}`,...(retryDisk?{retryDisk}:{}) });
    }
    if (queue.withdrawRequested(entry.id)) return queue.answer(entry, { state: "withdrawn", ...facts, message: "withdrawn while it was checked: green, and not landed" });
    try {
      const receipt = writeLandingVerdict(config.home, {
        commit: tip, tree: treeOf(g, tip), submission: entry.sha, landing: entry.id, base, selected, ran,
      });
      if (!receipt) config.log(`landing verdict ${short(tip)}: no portable contract; the core will execute its requested steps`);
    } catch (error) { config.log(`landing verdict ${short(tip)} could not be recorded: ${String(error)}`); }
    const publication=queue.publish(entry.id,()=>{
      queue.setStatus({ state: "landing", id: entry.id, sha: entry.sha, run, message: `main ${short(base)} -> ${short(tip)}` });
      return advanceMain(g,base,tip);
    });
    if(publication.withdrawn)return queue.answer(entry,{state:'withdrawn',...facts,message:'withdrawn after its check drained, before main advanced'});
    const advanced=publication.result;
    if (!advanced.ok && "moved" in advanced) { config.log(`main moved to ${short(advanced.moved)} during the check; checking ${short(entry.sha)} again on it`); continue; }
    if (!advanced.ok) return queue.answer(entry, { state: "held", ...facts, message: `held: green, but ${advanced.blocked}` });
    return finishLanding(config, queue, entry, base, tip, selected.selection, ran, null);
  }
  return queue.answer(entry, { state: "held", message: "main moved under three checks of it in a row" });
}

/** After main moved to `tip`: push it, give the task's tree back, delete its branch, answer. */
function finishLanding(config: Config, queue: Queue, entry: Entry, base: string, tip: string, selection: Selection | null, ran: Ran | null, note: string | null): Result {
  const g = git(config);
  // Main has moved: what follows tidies up, and its failures are reported, never a reason to un-land.
  const pushed = config.remote ? pushMain(g, config.remote) : { ok: true as const };
  let pool: ReturnType<Pool["release"]> | null = null;
  try { pool = entry.branch && config.pool ? config.pool.release(entry.branch, entry.sha) : null; }
  catch (error) { pool = { tree: null, state: "kept", reason: `the pool tree was not released: ${(error as Error).message}` }; }
  let branch: BranchOutcome[] = [];
  try { branch = entry.branch ? deleteBranch(g, entry.branch, entry.sha, config.remote) : []; }
  catch (error) { branch = [{ where: "local", state: "kept", reason: (error as Error).message }]; }
  const commits = base === tip ? [] : spawnSync("git",gitArguments( ["rev-list", "--reverse", `${base}..${tip}`]), { cwd: config.root, env: config.env ?? process.env, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const kept = branch.filter(b => b.state === "kept").map(b => `${b.where} branch kept: ${b.reason}`);
  if (pool?.state === "kept") kept.push(pool.reason!);
  const parts = [note ?? `LANDED ${short(entry.sha)} as ${short(tip)}: main is ${short(tip)}`,
    config.remote ? (pushed.ok ? `pushed to ${config.remote}` : `NOT pushed: ${"reason" in pushed ? pushed.reason : ""}; the next landing pushes it`) : "",
    ...kept, ran?.pending.length ? `${ran.pending.length} record row(s) pending, written after landing` : ""].filter(Boolean);
  return queue.answer(entry, { state: "landed", message: parts.join("; "), base, tip, commits, pushed: pushed.ok, branch, pool: pool?.tree?.path ?? null,
    ...(ran ? { run: ran.run, wall_s: Math.round(ran.wall_s), pending: ran.pending } : {}),
    ...(selection ? { landing: landingSteps(selection), deferred: deferredSteps(selection), estimate_s: Math.round(selection.estimate.seconds) } : {}) });
}

/** The steps that passed, by what they cost, for the next estimate (selection.ts's costs). */
export function recordCosts(home: string, ran: Ran, kind: ChangeKind): void {
  const file = join(home, "costs.json");
  withStateWrite(file,2,()=>{
    const steps = Object.fromEntries([...readLandingCosts(file)].map(([key,row])=>[key,{...row,cpu_measure:landingCpuMeasure(key)}]));
    for (const step of ran.steps) {
      if (step.verdict !== "PASS" || step.cpu_measure!==landingCpuMeasure(step.name)||!(typeof step.cpu === "number" && Number.isFinite(step.cpu) && step.cpu >= 0)) continue;
      steps[costKey(step.name, kind)] = { cpu: step.cpu,cpu_measure:step.cpu_measure, ...(typeof step.wall === "number" && step.wall > 0 ? { wall: step.wall } : {}) };
    }
    durableRecord(file, { version: 2, steps: Object.fromEntries(Object.entries(steps).sort(([a], [b]) => a < b ? -1 : 1)) });
  });
}

/** Delete run directories older than `days`. */
export function prune(dir: string, days: number, now = Date.now()): string[] {
  const removed: string[] = [];
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return removed; }
  for (const name of names) {
    const path = join(dir, name);
    try { if (now - statSync(path).mtimeMs > days * 86_400_000) { removeRun(path); removed.push(path); } } catch { /* gone */ }
  }
  return removed;
}

/** The landing tree at `tip`, with the inputs no commit carries, linked by the tree's own linker as a gate tree's are. */
export function prepareTree(root: string, tree: string, tip: string, env?: NodeJS.ProcessEnv): void {
  const run = (args: string[], cwd: string) => {
    const r = spawnSync("git",gitArguments( args), { cwd, env: env ?? process.env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${(r.stderr ?? "").trim()}`);
  };
  if (!existsSync(join(tree, ".git"))) run(["worktree", "add", "-q", "--detach", tree, tip], root);
  else {
    // Nobody edits this tree: anything in it that is not the commit is a previous check's.
    run(["checkout", "-q", "--detach", "--force", tip], tree);
    run(["clean", "-fdq", "-e", "third_party", "-e", "node_modules", "-e", "**/node_modules"], tree);
  }
  linkTree(tree, "gate", root, { env: env ?? process.env });
}

/** The service's configuration on this machine: the shared checkout, origin, the landing tree and target, the pool. */
export function machineConfig(root: string, select: Config["select"], log: Config["log"] = line => console.log(`landing: ${line}`)): Config {
  const {home,tree,target}=landingLayout();
  return {
    home, root, remote: "origin", tree, target, pool: existsSync(POOL_HOME) ? new Pool(POOL_HOME, { root }, linkInputs(root)) : null,
    select, prepare: tip => prepareTree(root, tree, tip), runSteps: runLanding,watchWithdrawals:createWithdrawalWatch, log, restartAfter: ownCode,
  };
}

/** The budget the selection fits: ten minutes on this machine's slots. */
export const BUDGET = machineBudget(cpus().length);
