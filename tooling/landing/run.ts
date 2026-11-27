import {GNU_CPU_MEASURE,type GnuTime} from '../gate/step-time.ts';
import type {StepDiagnostics} from '../gate/step-result.ts';
// Run a change's landing steps in a tree: the gate's own steps, through its own
// runner, in the landing check's profile.
//
// **The compiler builds first, in the incremental `nts-dev` profile**, as
// pinned.sh builds before the gate: the steps drive it (NTS_BIN), and a warm
// tree rebuilds only the crates a change reaches. `tests` and `doctests`
// build in the same profile (NTS_TEST_PROFILE), so their crates are the ones
// the compiler was built from. Then every other landing step runs in one
// `sh tooling/gate/all.sh` under the canonical environment
// (canonical-environment.ts), with the run's slots, memory reservation and
// summary.json the runner keeps.
//
// **Memory is the machine's memory ledger's to give** (tooling/gate/
// memory-ledger.ts), at the priority the caller names (NTS_MEMORY_PRIORITY):
// the service's runs at the landing priority, ahead of agents' work and the
// full check, and an agent's own `--here` pre-check at the agent priority, so
// a queued landing takes the memory a pre-check reserved but does not use
// instead of waiting at one priority for the pre-check to finish (#672). The
// build waits its turn for what this tree's landing builds held, in a
// reservation this process holds; the runner's first request takes it over,
// and the runner holds the steps'.
//
// **Memory pressure is a wait, never a verdict.** A step the runner reports as
// an instrument failure of kind memory-pressure runs again, alone, in a run
// whose reservation waits until memory allows, keeping every result that
// completed. Any other unfinished measurement holds the change for a person;
// only a step that ran and failed refuses it.
//
// Lines a check prints for a case its record has no row for yet, or for a
// recorded case that got better (tooling/records/pending.ts), are listed as
// information: the full check writes those rows.
import { removable } from "../gate/run-temporary.ts";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join,relative } from "node:path";
import { gateCommand } from "../gate/affinity.ts";
import {ENVIRONMENT_EXPERIMENT} from '../gate/canonical-environment.ts';
import {ENVIRONMENT_CONTEXT} from '../differential/oracle-seal/main.ts';
import { gateEnvironmentError } from "../gate/environment.ts";
import { instrumentPolicy,readStepInstrument,DiskBuildAdmissionError,type DiskBuildRefusal } from "../gate/step-result.ts";
import { TEST_PROFILE } from "../gate/test-profile.ts";
import {DiskCapacity,DISK_BUILD_ADMISSION,type BuildAdmission} from '../gate/disk-capacity.ts';
import {hostObservations} from '../gate/host-observations.ts';
import { STANDING_GATE_POLICY } from "../gate/verdict-policy.ts";
import { cpus } from "node:os";
import { machineBudget } from "./selection.ts";
import { closeSelection } from "./selection-memory.ts";
import { nodePin } from "../bootstrap/node.ts";
import { nodeToolchain } from "../gate/toolchain.ts";
import { candidateCommandAsync,certifyCandidateGroups } from "./candidate-environment.ts";
import { STEPS } from "../gate/step-table.mjs";
import { isListedLine, isRefreshLine } from "../records/pending.ts";
import { reserveJob, type Priority, type Reservation } from "../gate/memory-ledger.ts";
import { validContract, type VerdictContract } from "../gate/verdict-contract.ts";
import {readRustRecordDecisions,type RustRecordDecisionAtRevision} from '../gate/rust-selector-decision.ts';
import {registerCommandCloser} from '../differential/command-entry/main.ts';
import {fileURLToPath} from 'node:url';
import {WithdrawalRequested} from './withdrawal-watch.ts';

const BUILD_OWNER=new URL('../gate/build.ts',import.meta.url);
const SOURCE_ROOT=new URL('../../',import.meta.url);

export const PROFILE = TEST_PROFILE;
type BinaryIdentities = Record<string, string | null>;
export type StepResult = {
  name: string; verdict: "PASS" | "FAIL" | "INSTRUMENT" | "SKIPPED" | "NOT RUN"; reason?: string;
  /** A NOT RUN row's cause: the preparation step whose verdict stopped it. */
  needs?: string;
  cpu?: number;cpu_measure?:string;gnu_time?:GnuTime;wall?: number; log?: string; accepted?: boolean; attempt?: number;
  instrument?: { kind?: string; verdict?: string; completedFailures?: number;disk?:DiskBuildRefusal };
  binaries?: BinaryIdentities;
  diagnostics?:StepDiagnostics;
  preparation?:Pick<StepResult,'verdict'|'cpu'|'cpu_measure'|'wall'|'log'|'attempt'>;
};
export type Ran = { state: "green" | "red" | "held" | "cancelled"; message: string; run: string; steps: StepResult[]; pending: string[]; refresh: string[]; wall_s: number;
  rustRecords?:RustRecordDecisionAtRevision[];
  contract?: VerdictContract; binaries?: BinaryIdentities };
export type RunOptions = {
  tree: string; target: string; run: string; commit: string;
  rustRecords?:readonly RustRecordDecisionAtRevision[];
  /** The landing steps, as all.sh names them; `build` is the compiler's build. */
  steps: readonly string[];
  interop?: string | null; doctests?: string | null;
  /** The launcher's environment: only its host capabilities reach a step. */
  env?: NodeJS.ProcessEnv;
  /** The priority this run reserves memory at: the service's landings by default; `check.ts --here` names an agent's. */
  priority?: Priority;
  /**
   * The caller's selection reservation (selection-memory.ts), handed on with
   * no admission gap: the build's reservation takes it over, or, with nothing
   * to prepare, the gate run's first request does. The caller still closes it
   * when the run returns; a reservation already taken over closes at once.
   */
  handover?: Reservation;
  /** Told when memory pressure sends steps back to run again. */
  hold?: (reason: string) => void;
  /** The command that builds the compiler; cargo in `nts-dev` by default. */
  build?: readonly string[];
  /** Variables the caller's code owns beyond the run's (a test's controls). */
  owned?: Readonly<Record<string, string>>;
  /** How many times memory pressure may send a step back before a person is asked. */
  attempts?: number;
  /** Installed toolchains; private fixtures supply their own installation root. */
  nodeInstallations?: string;
  /** The most any step may run, in seconds: the landing check's ceiling (step-bound.ts's landingCeiling). */
  ceiling?: number;
  /** A submission's durable withdrawal watch, never an environment policy. */
  signal?:AbortSignal;
  /** An in-place --here checkout's resource lock, lent to its candidate children. */
  treeLock?: number;
  /** Report retained ownership while cancellation has not proved its drain. */
  cancellationHold?:(reason:string)=>void;
  /** A repeated durable withdrawal wakes certification after a failed drain. */
  drainRetry?:()=>Promise<void>;
};

/** The run is a resource too: process shutdown waits for its actual drain
 * before reaching the older reservation closer. Move it after acquiring the
 * hold so reverse-acquisition shutdown preserves that order. */
class RunLifetime{
  private readonly abort=new AbortController();
  readonly signal:AbortSignal;
  private readonly closed:Promise<void>;
  private resolve!:()=>void;
  private unregister:(()=>void)|undefined;
  constructor(signal:AbortSignal|undefined){
    this.signal=signal?AbortSignal.any([signal,this.abort.signal]):this.abort.signal;
    this.closed=new Promise<void>(resolve=>{this.resolve=resolve;});this.move();
  }
  move():void{
    this.unregister?.();
    this.unregister=registerCommandCloser('landing run drain',{cancel:reason=>this.abort.abort(reason),close:()=>this.closed});
  }
  complete():void{this.resolve();this.unregister?.();}
}

async function certifyDrain(options:RunOptions,check:()=>void|Promise<void>):Promise<void>{
  for(;;){
    try{await check();return;}
    catch(error){
      options.cancellationHold?.(String(error));
      if(options.drainRetry){
        try{await options.drainRetry();continue;}
        catch(retry){options.cancellationHold?.(`drain retry watch failed: ${String(retry)}`);}
      }
      // This is retained ownership, not a rejected promise pretending that
      // children disappeared. The command lifetime's existing guard remains.
      await new Promise<void>(()=>{});
    }
  }
}

async function runCandidate(options:RunOptions,node:string,request:Parameters<typeof candidateCommandAsync>[1],launcher:NodeJS.ProcessEnv,gate=false,log?:string){
  options.signal?.throwIfAborted();
  const result=await candidateCommandAsync(node,request,launcher,{signal:options.signal,treeLock:options.treeLock,retainDrain:true,groupDirectory:join(options.run,'candidate-groups'),cancelled:()=>options.cancellationHold?.('waiting for the owned candidate command and its children to close')});
  await certifyDrain(options,()=>result.certifyDrain?.());
  if(result.cancelled){
    if(log)appendFileSync(log,`${result.stdout??''}${result.stderr??''}`);
    if(gate)await certifyGateDrain(options,node,launcher,request.run,request.owned);
    options.signal?.throwIfAborted();
  }
  return result;
}

async function certifyGateDrain(options:RunOptions,node:string,launcher:NodeJS.ProcessEnv,run:string,owned:Record<string,string>):Promise<void>{
  await certifyDrain(options,async()=>{
    const owner=join(options.tree,'target/gate-scope-owner.json');
    // GateScopes claims its receipt before any scope can run and removes it
    // only after its root drains. Unlike existsSync, a broken alias is not an
    // absence fact. A remaining receipt needs the dead-owner reaper.
    try{if(!lstatSync(owner).isFile())throw Error('gate scope owner receipt is not a regular file');}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
    const cleanup=await candidateCommandAsync(node,{
      tree:options.tree,run:join(run,'drain'),owned,
      command:[node,fileURLToPath(new URL('./gate-drain.ts',import.meta.url)),owner],
    },launcher,{retainDrain:true,groupDirectory:join(options.run,'candidate-groups')});
    cleanup.certifyDrain?.();
    if(cleanup.error||cleanup.signal||cleanup.status!==0)throw Error(`gate scope drain could not be certified: ${cleanup.error?.message??cleanup.signal??cleanup.stderr??cleanup.status}`);
  });
}

/** A restart never replays a held cancellation into its still-owned tree.
 * Stored spawn facts grant only absence checks; the existing gate root owner
 * alone can reap its dead runner's scopes. No signal is reconstructed here. */
export async function recoverLandingCancellation(options:RunOptions):Promise<void>{
  const lifetime=new RunLifetime(undefined);
  try{
    await certifyDrain(options,()=>certifyCandidateGroups(join(options.run,'candidate-groups')));
    await certifyGateDrain(options,process.execPath,launcherEnvironment(options.env),options.run,options.owned??{});
  }finally{lifetime.complete();}
}

/** The workers a landing build is sized by: the gate's build step's, its row's slots. */
const BUILD_WIDTH = STEPS.find(row => row.name === "build")!.slots;

/**
 * The environment a landing run starts from: the launcher's host
 * capabilities, never another run's context. A landing check started inside
 * a gate step -- this file's own tests, in the tooling step -- would otherwise
 * be read as that gate re-entering itself and inherit its owned policy:
 * that gate's NTS_GATE_FAIL_FAST stops the other steps after one fails.
 */
export function launcherEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const own = { ...env };
  delete own[ENVIRONMENT_CONTEXT];
  delete own[ENVIRONMENT_EXPERIMENT];
  // A build admission is handed only by the owner that admitted it.
  delete own[DISK_BUILD_ADMISSION];
  return own;
}

/** The run's rank, for memory and CPU alike (gate/ranks.ts): the service's landings', or the caller's (`check.ts --here` names an agent's). */
const runRank = (options: Pick<RunOptions, "priority">): Priority => options.priority ?? "landing";

export async function runLanding(options: RunOptions): Promise<Ran> {
  const lifetime=new RunLifetime(options.signal);
  try{return await runLandingOwned({...options,signal:lifetime.signal},lifetime);}
  finally{lifetime.complete();}
}
async function runLandingOwned(options:RunOptions,lifetime:RunLifetime):Promise<Ran>{
  const clock=hostObservations({...options.env??process.env,...options.owned});
  const started = clock.wallNow();
  const { tree, target, run } = options;
  const rustRecords=options.rustRecords===undefined?undefined:readRustRecordDecisions(options.rustRecords);
  mkdirSync(run, { recursive: true });
  const results: StepResult[] = [];
  let contract: VerdictContract | undefined;
  let probeContract: (() => Promise<VerdictContract | undefined>) | undefined;
  const finish = (state: Ran["state"], message: string): Ran => {
    const ran: Ran = { state, message, run, steps: results, ...recordLines(run), wall_s: (clock.wallNow() - started) / 1000,
      ...(rustRecords?{rustRecords}:{}),
      };
    return ran;
  };
  const execute=async():Promise<Ran>=>{
    options.signal?.throwIfAborted();
    let selected: ReturnType<typeof nodeToolchain>;
    try { selected=nodeToolchain(nodePin(tree),launcherEnvironment(options.env),options.nodeInstallations); }
    catch(error) { return finish("held", String(error)); }
    const launcher=selected.env;
    const owned = {
      NTS_GATE_RUN_DIR: run, CARGO_TARGET_DIR: target, CARGO_INCREMENTAL: "1", NTS_TEST_PROFILE: PROFILE,
      NTS_BIN: join(target, PROFILE, "nts"), NTS_SUITE_BIN: join(target, PROFILE, "nts-suite"), NTS_CHECKERS: "1",
      ...(options.steps.includes('doctests')?{NTS_BUILD_DOCTESTS:'1',NTS_DOCTEST_PREPARATION:join(run,'doctest-build.json')}:{}),
      ...STANDING_GATE_POLICY,
      NTS_MEMORY_PRIORITY: runRank(options),
      // The scopes the rules narrowed a step to: the touched crates' doc tests, the interop projects a change reaches.
      ...(options.doctests && options.steps.includes("doctests") ? { NTS_DOCTEST_CRATES: options.doctests } : {}),
      ...(options.interop && options.steps.includes("interop") ? { NTS_INTEROP_PROJECTS: options.interop } : {}),
      // A stuck step holds the queue for minutes, not the hour the full check allows.
      ...(options.ceiling !== undefined ? { NTS_GATE_STEP_CEILING_S: String(options.ceiling) } : {}),
      ...options.owned,
    };
    probeContract = async () => {
      const helper = join(tree, "tooling/gate/verdict-contract.ts");
      if (!existsSync(helper)) return undefined;
      const file = join(run, "verdict-contract.json");
      try {
        const result = await runCandidate(options,selected.node, {
          tree, run: join(run, "contract"), owned, discardTemporary: true,
          command: [selected.node, helper, file],
        }, launcher);
        if (result.error || result.signal || result.status !== 0) throw Error(result.error?.message ?? result.signal ?? result.stderr ?? 'candidate left no result');
        const value: unknown = JSON.parse(readFileSync(file, "utf8"));
        if (!validContract(value)) throw Error("candidate wrote an invalid verdict contract");
        return value;
      } catch (error) {
        options.signal?.throwIfAborted();
        appendFileSync(join(run, "verdict-contract.log"), String(error) + "\n");
        return undefined;
      }
    };
    contract = await probeContract();
    const rest = options.steps.filter(step => step !== "build");
    let environment: string | null;
    try { environment = rest.length ? gateEnvironmentError(tree, rest, options.interop ?? null, launcher) : null; }
    catch (error) { return finish("held", `the tree's gate could not say what its steps need: ${(error as Error).message}`); }
    if (environment) return finish("held", `environment: ${environment}`);

    // **The landing holds one reservation from its build to its gate run's
    // admission.** It reserves landing-build in this process, so the build runs
    // inside it, and hands it to the gate run (NTS_MEMORY_HANDOVER): the
    // decision that admits the run's first request ends it, under the ledger's
    // lock, so nothing is admitted between the two. A job admitted in the
    // seconds between a build and its gate run held that run's growth for the
    // rest of the run (#615). The selection that chose the steps hands its own
    // reservation on the same way: the build's takes it over, or, with nothing
    // to prepare, the gate run's.
    const handover=options.handover&&!options.handover.inherited?options.handover:undefined;
    let hold: Reservation | undefined,drain:Promise<void>|undefined,primary:{error:unknown}|undefined;
    const preparationName=options.steps.includes('build')?'build':'doctests';
    let doctestPreparation:StepResult['preparation'];
    const closeBuildHold=()=>drain??=(async()=>{
      const errors:unknown[]=[];
      try{hold?.release();}catch(error){errors.push(error);}
      try{await hold?.closed;}catch(error){errors.push(error);}
      if(errors.length===1)throw errors[0];
      if(errors.length)throw new AggregateError(errors,'landing build reservation failed to drain');
    })();
    try {
      if (options.steps.includes("build")||options.steps.includes('doctests')) {
        const log = preparationLog(options,1);
        try {
          hold = await reserveJob({ key: "landing-build", units: BUILD_WIDTH, what: `landing build of ${options.commit.slice(0, 12)}`,
            ...(handover ? { replaces: handover.id } : {}) },
            { env: { ...launcher, ...owned },signal:options.signal, report: line => appendFileSync(log, `${line}\n`) });
          lifetime.move();
        } catch (error) {
          options.signal?.throwIfAborted();
          appendFileSync(log, `${String(error)}\n`);
          const reason = `its memory was not reserved: ${(error as Error).message}`;
          results.push({ name: preparationName, verdict: "INSTRUMENT", reason, log });
          for (const step of rest.filter(step=>step!==preparationName)) results.push({ name: step, verdict: "NOT RUN", needs: preparationName, reason: `needs ${preparationName} preparation, which is INSTRUMENT` });
          return finish("held", `${preparationName}: ${reason}`);
        }
        // Taken over: the selection's peak goes to its history before the build starts.
        await closeSelection(handover);
        for (let attempt = 1; ; attempt++) {
          options.signal?.throwIfAborted();
          const built = await buildCompiler(options, selected.node, launcher, { ...owned, ...hold.env }, attempt);
          if (built.verdict === "INSTRUMENT" && (!built.instrument||instrumentPolicy(built.instrument.kind)?.disposition==='retry') && attempt < (options.attempts ?? 3)) continue;
          if(built.verdict==='PASS'&&preparationName==='doctests'){
            const {name:_name,binaries:_binaries,...evidence}=built;doctestPreparation=evidence;
          }else results.push(built);
          if (built.verdict === "PASS") break;
          for (const step of rest.filter(step=>step!==preparationName)) results.push({ name: step, verdict: "NOT RUN", needs: preparationName, reason: `needs ${preparationName} preparation, which is ${built.verdict}` });
          return built.verdict === "FAIL" ? finish("red", `${preparationName} FAIL; log ${built.log}`) : finish("held", `${preparationName}: ${built.reason}`);
        }
      } else hold = handover;
      if (!rest.length) return finish("green", "green");
      const ran=await finishSteps(options, selected.node, launcher, owned, rest, results, finish, hold,closeBuildHold);
      const doctests=results.find(row=>row.name==='doctests');
      if(doctests&&doctestPreparation)doctests.preparation=doctestPreparation;
      return ran;
    } catch(error){primary={error};throw error;}
    finally {
      try{await closeBuildHold();}
      catch(error){if(primary!==undefined&&primary.error!==error)throw new AggregateError([primary.error,error],'landing failed and its build reservation failed to drain');throw error;}
    }
  };
  let ran:Ran;
  try{ran=await execute();}
  catch(error){
    if(!options.signal?.aborted)throw error;
    ran=finish(options.signal.reason instanceof WithdrawalRequested?'cancelled':'held',`cancelled and drained: ${String(options.signal.reason)}`);
  }
  let completed:VerdictContract|undefined;
  try{
    options.signal?.throwIfAborted();
    completed=ran.state==='green'&&contract?await probeContract?.():undefined;
  }catch(error){
    if(!options.signal?.aborted)throw error;
    ran=finish(options.signal.reason instanceof WithdrawalRequested?'cancelled':'held',`cancelled and drained: ${String(options.signal.reason)}`);
  }
  if(ran.state==='green'&&contract&&completed?.identity!==contract.identity){
    appendFileSync(join(run,'verdict-contract.log'),'landing verdict contract changed or became unavailable during the check\n');
    contract=undefined;
  }
  if(ran.state==='green'&&contract){ran.contract=contract;ran.binaries=results.find(row=>row.name==='build')?.binaries??results.find(row=>row.binaries)?.binaries??{};}
  const lines=recordLines(run);ran.pending=lines.pending;ran.refresh=lines.refresh;ran.wall_s=(clock.wallNow()-started)/1000;
  writeFileSync(join(run,'landing.json'),JSON.stringify(ran,null,2)+'\n');
  return ran;
}

/**
 * The steps after the build, run again, alone, while memory pressure kept
 * some from measuring. The first run takes over `hold`, the build's
 * reservation (or, with nothing to build, the selection's); a run that did
 * not take it over never needs it again.
 */
async function finishSteps(options: RunOptions, node: string, launcher: NodeJS.ProcessEnv, owned: Record<string, string>, rest: readonly string[],
  results: StepResult[], finish: (state: Ran["state"], message: string) => Ran, hold: Reservation | undefined,closeBuildHold:()=>Promise<void>): Promise<Ran> {
  const rows = new Map<string, StepResult>();
  let pending = [...rest];
  for (let attempt = 1; pending.length; attempt++) {
    options.signal?.throwIfAborted();
    const dir = attempt === 1 ? options.run : join(options.run, `attempt-${attempt}`);
    const handover: Record<string, string> = attempt === 1 && hold && !hold.inherited ? { NTS_MEMORY_HANDOVER: hold.id } : {};
    const measured = await runSteps(options, node, launcher, { ...owned, NTS_GATE_RUN_DIR: dir, NTS_GATE_STEPS: pending.join(" "), ...handover }, dir, pending);
    if (attempt === 1) await closeBuildHold();
    if ("held" in measured) { for (const step of pending) rows.set(step, { name: step, verdict: "NOT RUN", reason: measured.held }); results.push(...rest.map(step => rows.get(step)!)); return finish("held", measured.held); }
    for (const row of measured.rows) rows.set(row.name, { ...row, ...(attempt > 1 ? { attempt } : {}) });
    const retry = measured.rows.filter(row => row.verdict === "INSTRUMENT" && instrumentPolicy(row.instrument?.kind, row.instrument?.completedFailures)?.disposition === "retry");
    if (retry.length && attempt >= (options.attempts ?? 3)) break;
    if (retry.length) options.hold?.(`memory pressure kept ${retry.map(r => r.name).join(" ")} from measuring: they run again once memory allows`);
    pending = retry.map(row => row.name);
  }
  results.push(...rest.map(step => rows.get(step) ?? { name: step, verdict: "NOT RUN" as const, reason: "the runner did not report it" }));
  const failed = results.filter(r => r.verdict === "FAIL" || (r.verdict === "SKIPPED" && !r.accepted));
  if (failed.length) return finish("red", `${failed.map(r => `${r.name} ${r.verdict}`).join(", ")}; logs ${options.run}`);
  const unfinished = results.filter(r => r.verdict !== "PASS" && !(r.verdict === "SKIPPED" && r.accepted));
  if (unfinished.length) return finish("held", unfinished.map(r => `${r.name} ${r.verdict}: ${r.reason ?? "did not finish"}`).join("; "));
  return finish("green", "green");
}

/**
 * One build of the compiler, inside the landing's reservation, which `owned`
 * names. That reservation is what this tree's earlier landing builds held, in
 * its target's history, and the build's peak joins them as it is released.
 * Never measured, it sizes as the gate's build step does, at the build row's
 * width: not one share per cargo job, which for 24 jobs would be the whole
 * machine. The first build's log follows what the reservation said while it
 * waited.
 */
async function buildCompiler(options: RunOptions, node: string, launcher: NodeJS.ProcessEnv, owned: Record<string, string>, attempt: number): Promise<StepResult> {
  let admission:BuildAdmission|undefined;
  try{
    // The build's one admission: the build owner it starts runs inside it, never admitting the same build again (#951).
    admission=new DiskCapacity({env:{...launcher,...owned}}).beginBuild({root:options.tree,target:options.target,outputs:['nts-dev']});
    return await buildCompilerAdmitted(options,node,launcher,{...owned,...admission.env},attempt);
  }catch(error){options.signal?.throwIfAborted();return {name:options.steps.includes('build')?'build':'doctests',verdict:'INSTRUMENT',reason:String(error),log:preparationLog(options,attempt),
    ...(error instanceof DiskBuildAdmissionError?{instrument:{kind:error.kind,verdict:'INSTRUMENT',disk:error.disk}}:{})};}
  finally{admission?.();}
}
function preparationLog(options:RunOptions,attempt:number):string{
  const name=options.steps.includes('build')?'build':'doctest-preparation';
  return join(options.run,`${name}${attempt===1?'':'-'+attempt}.log`);
}
async function buildCompilerAdmitted(options: RunOptions, node: string, launcher: NodeJS.ProcessEnv, owned: Record<string, string>, attempt: number): Promise<StepResult> {
  const compilerSelected=options.steps.includes('build'),name=compilerSelected?'build':'doctests';
  const log = preparationLog(options,attempt), time = `${log}.time`, instrumentFile = `${log}.instrument.json`;
  // The run's slots, as the gate sizes itself: the steps after it get the same.
  const slots = machineBudget(cpus().length).slots;
  const command = options.build ?? [node, join(options.tree,relative(fileURLToPath(SOURCE_ROOT),fileURLToPath(BUILD_OWNER))), "--profile", PROFILE,
    ...(options.steps.includes('build')?[]:['--no-compiler'])];
  const timed = existsSync("/usr/bin/time") ? ["/usr/bin/time", "-f", "%e %U %S %M", "-o", time, ...command] : [...command];
  const launch = gateCommand(timed[0]!, timed.slice(1), { rank: runRank(options), env: launcher });
  // The gate runner's step-result protocol (run.mjs): the build owner publishes
  // a typed instrument failure (a disk refusal, a setup fault) there, and it
  // is the build's verdict whatever the exit status says. The owner classifies
  // its own Cargo's end as the gate's build step reads it: a compile error
  // publishes nothing and stays FAIL; a Cargo killed by a signal is
  // tooling-setup, held for a person, since a signal alone is no measured
  // memory pressure. Only the owner's own death by a signal is retried below.
  rmSync(instrumentFile,{force:true});
  const step={NTS_GATE_STEP:name,NTS_GATE_STEP_ATTEMPT:String(attempt),NTS_GATE_STEP_RESULT:instrumentFile};
  const r = await runCandidate(options,node, { tree: options.tree, run: options.run, owned:{...owned,CARGO_BUILD_JOBS:String(slots),...step}, command: [launch.command, ...launch.args] }, launcher,false,log);
  appendFileSync(log, `${r.stdout ?? ""}${r.stderr ?? ""}`);
  let cpu: number | undefined, wall: number | undefined;
  try {
    const [e, u, s] = readFileSync(time, "utf8").trim().split("\n").pop()!.split(" ").map(Number);
    if ([e, u, s].every(Number.isFinite)) { wall = e; cpu = u! + s!; }
  } catch { /* unmeasured */ }
  const measured = { ...(cpu !== undefined ? { cpu,cpu_measure:GNU_CPU_MEASURE } : {}), ...(wall !== undefined ? { wall } : {}), log };
  let instrument:ReturnType<typeof readStepInstrument>;
  try{instrument=readStepInstrument(instrumentFile,step.NTS_GATE_STEP,step.NTS_GATE_STEP_ATTEMPT);}
  catch(error){return {name,verdict:'INSTRUMENT',reason:`the build's instrument result was unreadable: ${String(error)}`,...measured};}
  if(instrument)return {name,verdict:instrument.verdict,reason:instrument.reason,...measured,
    instrument:{kind:instrument.kind,verdict:instrument.verdict,...(instrument.disk?{disk:instrument.disk}:{})}};
  // Killed rather than failed: the machine's doing (an OOM kill), not the change's.
  if (r.error || r.signal) return { name, verdict: "INSTRUMENT", reason: `the build was ${r.signal ? `killed by ${r.signal}` : `not started: ${r.error?.message}`}`, ...measured };
  if (r.status !== 0) return { name, verdict: "FAIL", reason: `exit ${r.status}`, ...measured };
  const binaries = compilerSelected?Object.fromEntries(["nts", "nts-suite"].map(name => {
    let hash: string | null = null;
    try { hash = createHash("sha256").update(readFileSync(join(options.target, PROFILE, name))).digest("hex"); }
    catch { /* A fixture's build may provide only one executable. */ }
    return [name, hash];
  })):undefined;
  return { name, verdict: "PASS", ...measured, ...(binaries?{binaries}:{}) };
}

type Summary = { identities?: { commit?: string | null; nts?: { sha256?: string | null }; nts_suite?: { sha256?: string | null } };
  interrupted?: unknown; environment?: { canonical?: boolean }; steps?: StepResult[];scope_cleanup?:{state:string};diagnostics?:{state:string} };
async function runSteps(options: RunOptions, node: string, launcher: NodeJS.ProcessEnv, owned: Record<string, string>, dir: string, steps: readonly string[]): Promise<{ rows: StepResult[] } | { held: string }> {
  mkdirSync(dir, { recursive: true });
  const launch = gateCommand("sh", [join(options.tree, "tooling/gate/all.sh")], { rank: runRank(options), env: launcher });
  const r = await runCandidate(options,node, { tree: options.tree, run: dir, owned, command: [launch.command, ...launch.args] }, launcher,true,join(dir,'gate.log'));
  writeFileSync(join(dir, "gate.log"), `${r.stdout ?? ""}${r.stderr ?? ""}`);
  let summary: Summary;
  try { summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8")) as Summary; }
  catch (error) { return { held: `the runner left no readable summary (${r.signal ?? `exit ${r.status}`}): ${String(error)}; see ${join(dir, "gate.log")}` }; }
  if (!Array.isArray(summary.steps)) return { held: `the summary lists no steps; see ${dir}` };
  if (summary.identities?.commit !== options.commit) return { held: `the summary names ${summary.identities?.commit ?? "no commit"}, not ${options.commit.slice(0, 12)}` };
  if (summary.interrupted != null) return { held: `the run was interrupted: ${String(summary.interrupted)}` };
  if (summary.environment?.canonical !== true) return { held: "the run's environment was not canonical" };
  const rows = summary.steps.filter(row => steps.includes(row.name));
  for (const step of steps) if (!rows.some(row => row.name === step)) rows.push({ name: step, verdict: "NOT RUN", reason: "the runner did not report it" });
  const binaries = options.steps.includes('build')&&summary.identities?.nts ? {
    nts: summary.identities.nts.sha256 ?? null, "nts-suite": summary.identities.nts_suite?.sha256 ?? null,
  } : undefined;
  return { rows: rows.map(row => ({ ...row, ...(row.log ? {} : { log: join(dir, `${row.name}.log`) }), ...(binaries ? { binaries } : {}) })) };
}

/**
 * The lines a run's step logs print for the records, each once, as
 * tooling/records/pending.ts names them. `pending` holds each missing row and
 * accepted change: the rows written after landing. `refresh` holds each native
 * refresh request, which the full check answers after landing and which is no
 * pending row; a landing counts the two apart.
 */
export function recordLines(run: string): { pending: string[]; refresh: string[] } {
  const pending = new Set<string>(), refresh = new Set<string>();
  const visit = (dir: string, depth: number) => {
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names.sort()) {
      if (depth < 1 && /^attempt-\d+$/.test(name)) visit(join(dir, name), depth + 1);
      else if (name.endsWith(".log")) {
        try {
          for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
            if (isRefreshLine(line)) refresh.add(line.trim());
            else if (isListedLine(line)) pending.add(line.trim());
          }
        } catch { /* unreadable log */ }
      }
    }
  };
  visit(run, 0);
  return { pending: [...pending], refresh: [...refresh] };
}

/**
 * Remove a run's directory. A red run keeps its temporary directory, which
 * can hold read-only captured inputs (a sealed dependency tree): the run's own
 * directories get their write permission back first, never through a link,
 * and a directory another user owns is refused.
 */
export function removeRun(path: string): void {
  try { removable(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  rmSync(path, { recursive: true, force: true });
}
