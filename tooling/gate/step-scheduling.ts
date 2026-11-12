import {assertWritableState,futureStateVersion,type FutureStateVersionError} from './state-version.ts';
import {lockStateFile as lockHistory,STATE_LOCK_WAIT_SECONDS as LOCK_WAIT_SECONDS} from './state-file.ts';
import {STEP_CPU_MEASURE,currentStepCpu} from './step-time.ts';
// Scheduling history is an optimization. Missing or corrupt history uses the
// committed baseline and the machine's shares; it never changes which checks
// run or their verdicts.
//
// **One history of what each step costs, per target**: `steps-v5.json` in
// <target>/gate-costs (NTS_GATE_COSTS_DIR, where a test's code names its own).
// For each step, the CPU seconds its checks took when they last passed, and
// the memory its last few runs held at most; beside the steps, by key, the
// jobs that reserve memory outside any step (memory-ledger.ts's `reserveJob`,
// `admit.ts --key`): an agent's build, a census run by hand. Every canonical
// gate run writes it, every job writes its own, and every run reads it. It is
// per target because a step's costs depend on its tree's build cache: a warm
// build takes seconds and little memory, a cold one forty minutes and
// gigabytes.
//
// **Steps start by their work, not by their last wall time.** A step's work is
// the CPU seconds its checks took; divided by the slots it can use, it is the
// time the step needs once it has them. Wall time is the wrong measure to rank
// by, because it records when a step started and what ran beside it: a step
// started late meets less contention, measures short, and is started late
// again. On 2026-11-06 the three TypeScript steps that replaced
// typescript-cases started 15 to 23 minutes into a 33-minute gate that way,
// where the one step had started at 37 s.
//
// **Memory is reserved by what was measured.** A peak is the most a step's
// slice held, sampled on the memory ledger's own basis (cgroupCharge: what no
// other job can have, without the page cache the kernel gives back first), per
// unit of the step: the whole step for a fixed step, one token for an elastic
// one, one worker for a job. The last KEPT_PEAKS peaks are kept, and a unit
// reserves 1.25 times the largest, so one small run never shrinks a
// reservation. A job without peaks is charged live use and margin by the
// ledger and records its first peak for next time. A step never measured
// in this history reserves the largest
// reservation of its kind here; with none, its share of the machine: of what
// the ledger can ever give (MemTotal less the system's floor), its width over
// the slots, so a run whose every slot is busy fits. An unmeasured step
// reserves at most half of what the ledger can give, the widest step's
// share (`unmeasuredLimit`): a guess is never so large that the machine,
// with a desktop running, never has it free. There is no declared number
// anywhere: the step table names none.
//
// **A case can be its own unit.** An elastic step whose cases differ by
// orders of magnitude keeps a history of its own beside steps-v5.json,
// `cases-v2/<step>.json`: each case's last few peaks, by step, backend and
// path. The runner sizes each lease from those peaks, or live use and margin
// when it has never been measured. The old cases/ namespace is imported only
// before the first v2 publication, so historical candidates cannot overwrite
// a newer history. program-oracles showed why: a median program
// held 139 MiB and three held two gigabytes, so a token sized for every
// program at once asked eighteen times what most of them hold.
//
// **A reservation decides when work starts, never its verdict.** A step's
// slice is held to its grant and grows while it runs (run.mjs, "Memory"); a
// step killed at its hard bound is memory pressure, held, never a FAIL.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nameOrder = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const measured = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const bytes = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
/** A step's name, and a job's key: lower-case words joined by hyphens. */
export const KEY = /^[a-z][a-z0-9-]*$/;
const TOOLING_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** A removed step's checks, moved to the steps that now run them (owed.mjs). */
export type StepSuccessors = Readonly<Record<string, { readonly steps: readonly string[] }>>;

/** What a memory peak was measured over: a fixed step or one token of an elastic step. */
export type MemoryUnit = "step" | "token";
/** A key's last few measured peaks, oldest first, in bytes per unit. */
export type Peaks = { readonly unit: MemoryUnit; readonly peaks: readonly number[] };
export type StepCosts = { readonly cpu?: number; readonly memory?: Peaks };
export type JobBasis = "job" | "worker";
/** Whole-job bytes, with the actual width that produced the sample. */
export type JobSample = {readonly peak:number;readonly width:number};
export type JobPeaks = {readonly basis:JobBasis;readonly observations:readonly JobSample[]};
export type CostHistory = { readonly steps: ReadonlyMap<string, StepCosts>; readonly jobs: ReadonlyMap<string, JobPeaks>;
  readonly unsupportedVersion?:FutureStateVersionError;readonly legacyJobs?:readonly string[];readonly legacyFile?:string };
export const COST_HISTORY_VERSION=5;
export const COST_HISTORY_NAME="steps-v5.json";

/** Peaks kept per key: one small run among them does not shrink a reservation. */
export const KEPT_PEAKS = 5;
const MIB = 2 ** 20;
/** The least a measured unit reserves. */
export const LEAST_RESERVATION_BYTES = 128 * MIB;

const empty = (): CostHistory => ({ steps: new Map(), jobs: new Map() });

function parsePeaks(value: unknown, units: readonly MemoryUnit[]): Peaks | null {
  if (!record(value) || !keys(value, ["unit", "peaks"]) || !units.includes(value.unit as MemoryUnit)) return null;
  const peaks = value.peaks;
  if (!Array.isArray(peaks) || peaks.length === 0 || peaks.length > KEPT_PEAKS || !peaks.every(bytes)) return null;
  return { unit: value.unit as MemoryUnit, peaks };
}

/** A supported view, with old step observations retained. The versioned
 * namespace imports its predecessor only before the first v5 publication;
 * older historical candidates continue writing their own file. */
export function readCostHistory(file: string,report:(line:string)=>void=console.error): CostHistory {
  const input=basename(file)===COST_HISTORY_NAME&&!existsSync(file)?join(dirname(file),"steps.json"):file;
  let value: unknown;
  try { value = JSON.parse(readFileSync(input, "utf8")); } catch { return empty(); }
  const unsupportedVersion=futureStateVersion(value,COST_HISTORY_VERSION,input);
  if(unsupportedVersion){report(unsupportedVersion.message);return {...empty(),unsupportedVersion};}
  if (!record(value)) return empty();
  if (value.version === 2) return empty(); // Legacy wait4 CPU cannot seed cgroup CPU history.
  if ((value.version!==3&&value.version!==4&&value.version!==5) || !keys(value, ["version", "cpu_measure", "steps", "jobs"]) || !record(value.steps) || !record(value.jobs)) return empty();
  const steps = new Map<string, StepCosts>(), jobs = new Map<string, JobPeaks>();
  for (const [name, row] of Object.entries(value.steps)) {
    if (!KEY.test(name) || !record(row) || !keys(row, ["cpu", "memory"])) return empty();
    if (row.cpu !== undefined && !measured(row.cpu)) return empty();
    const memory = row.memory === undefined ? undefined : parsePeaks(row.memory, ["step", "token"]);
    if (memory === null || (row.cpu === undefined && memory === undefined)) return empty();
    const cpu=value.version!==3&&value.cpu_measure===STEP_CPU_MEASURE?row.cpu:undefined;
    if(cpu!==undefined||memory)steps.set(name,{...(cpu!==undefined?{cpu:cpu as number}:{}),...(memory?{memory}:{})});
  }
  if(value.version!==COST_HISTORY_VERSION){
    const legacyJobs=Object.keys(value.jobs).sort();
    if(legacyJobs.length)report(`memory history: ignoring ${legacyJobs.length} ambiguous legacy job key(s) in ${input}; sizing basis and measured width are absent: ${legacyJobs.join(", ")}`);
    return {steps,jobs,legacyJobs,legacyFile:input};
  }
  for (const [key, row] of Object.entries(value.jobs)) {
    if(!KEY.test(key)||!record(row)||!keys(row,["basis","observations"])||(row.basis!=="job"&&row.basis!=="worker")||!Array.isArray(row.observations)||row.observations.length>KEPT_PEAKS)return empty();
    const basis=row.basis,observations:JobSample[]=[];
    for(const sample of row.observations){
      if(!record(sample)||!keys(sample,["peak","width"])||!bytes(sample.peak)||!bytes(sample.width)||(basis==="job"&&sample.width!==1))return empty();
      observations.push({peak:sample.peak as number,width:sample.width as number});
    }
    jobs.set(key,{basis,observations});
  }
  return { steps, jobs };
}

export function assertJobBasis(key:string,basis:JobBasis,previous:JobPeaks|undefined):void{
  if(previous&&previous.basis!==basis)throw new Error(`memory: job key ${key} is bound to ${previous.basis} sizing; ${basis} sizing disagrees (${basis==="worker"?"--workers supplied":"no --workers supplied"})`);
}

/** One key keeps its declared meaning before any admission, including its
 * first unmeasured run. The locked re-read excludes conflicting first users. */
export function bindJobBasis(file:string,key:string,basis:JobBasis,report:(line:string)=>void=console.error):CostHistory{
  if(!KEY.test(key))throw new Error("invalid memory history job key: "+key);
  const view=readCostHistory(file,()=>{});
  if(view.unsupportedVersion)throw view.unsupportedVersion;
  assertJobBasis(key,basis,view.jobs.get(key));
  if(view.jobs.has(key))return view;
  mkdirSync(dirname(file),{recursive:true});
  const unlock=lockHistory(file);if(!unlock)throw new Error(`memory: cannot bind ${key}'s sizing basis; ${file} stayed locked for ${LOCK_WAIT_SECONDS} s`);
  try{
    assertWritableState(file,COST_HISTORY_VERSION);
    const current=readCostHistory(file,()=>{});if(current.unsupportedVersion)throw current.unsupportedVersion;
    assertJobBasis(key,basis,current.jobs.get(key));
    if(current.jobs.has(key))return current;
    const jobs=new Map(current.jobs);jobs.set(key,{basis,observations:[]});
    const next={steps:current.steps,jobs};publishCostHistory(file,next);
    if(current.legacyJobs?.length)report(`memory history: migrated ${current.legacyFile} to ${file}; dropped ${current.legacyJobs.length} ambiguous job key(s), kept every supported step row: ${current.legacyJobs.join(", ")}`);
    return next;
  }finally{unlock();}
}

/** A job's own observations, normalized only by the widths stored with them. */
export function jobReservation(history:CostHistory,key:string,basis:JobBasis):MemorySizing{
  const own=history.jobs.get(key);assertJobBasis(key,basis,own);
  if(!own?.observations.length)return {bytes:0,basis:"live"};
  return {bytes:peakReservation(own.observations.map(row=>Math.ceil(row.peak/row.width))),basis:"measured"};
}

/** The CPU seconds each step's checks took when they last passed. */
export function stepCpu(history: CostHistory): ReadonlyMap<string, number> {
  return new Map([...history.steps].flatMap(([name, row]) => row.cpu === undefined ? [] : [[name, row.cpu] as [string, number]]));
}

/** Bootstrap from the runner's last completed summary when this cache did
 * not yet exist. A later run of a few steps must not erase timings already retained. */
export function readPreviousStepCpu(file: string): ReadonlyMap<string, number> {
  try {
    const row = JSON.parse(readFileSync(file, "utf8")) as {
      schema?: number; environment?: { canonical?: boolean }; steps?: { name: string; verdict: string; cpu?: number;cpu_measure?:string }[];
    };
    if (row.schema !== 1 || row.environment?.canonical !== true || !Array.isArray(row.steps)) return new Map();
    const seen = new Set<string>(), result = new Map<string, number>();
    for (const step of row.steps) {
      if (!step || typeof step.name !== "string" || !KEY.test(step.name) || seen.has(step.name)) return new Map();
      seen.add(step.name);
      if (step.verdict === "PASS" && measured(currentStepCpu(step))) result.set(step.name,step.cpu!);
    }
    return result;
  } catch { return new Map(); }
}

/**
 * A successor's share of its predecessor's measured work, for the successors
 * that have none of their own yet. The predecessor's total is conserved: it is
 * split by the successors' baseline CPU when every one of them has a baseline,
 * and equally otherwise. Giving each successor the whole total would multiply
 * the work a split step is estimated to bring. A retired check (no successors)
 * passes its work to nobody.
 *
 * **A successor named by two measured predecessors inherits nothing.** Two
 * removed steps may be distinct checks merged into one (their work adds) or
 * one check renamed twice (it does not), and the table does not say which; the
 * successor's baseline is the estimate until its own run is measured.
 */
export function inheritedStepWork(history: ReadonlyMap<string, number>, baseline: (name: string) => number | undefined,
  successors: StepSuccessors): ReadonlyMap<string, number> {
  const shares = new Map<string, number>(), ambiguous = new Set<string>();
  for (const [predecessor, { steps }] of Object.entries(successors)) {
    const total = history.get(predecessor);
    if (!measured(total) || steps.length === 0) continue;
    const weights = steps.map(baseline);
    const proportional = weights.every(measured);
    const sum = proportional ? weights.reduce((a, b) => a + (b as number), 0) : steps.length;
    steps.forEach((step, i) => {
      if (measured(history.get(step))) return;
      if (shares.has(step)) ambiguous.add(step);
      shares.set(step, total * (proportional ? (weights[i] as number) : 1) / sum);
    });
  }
  for (const step of ambiguous) shares.delete(step);
  return shares;
}

/** The slots a step can use at once: its own width, the run's slots, and the
 * run's frontends when its workers start frontends. */
export function usableWidth(step: { readonly slots?: number; readonly fe?: boolean }, budget: { readonly slots: number; readonly frontends: number }): number {
  return Math.max(1, Math.min(step.slots ?? 1, budget.slots, step.fe ? budget.frontends : Infinity));
}

/** Start the longest uncontended steps first. Equal and absent estimates use
 * the same name ordering on every Node. */
export function orderStepStarts(names: readonly string[], seconds: (name: string) => number): string[] {
  const estimate = (name: string): number => { const value = seconds(name); return measured(value) ? value : 0; };
  return [...names].sort((a, b) => estimate(b) - estimate(a) || nameOrder(a, b));
}

// ---------------------------------------------------------------------------
// Memory reservations.
// ---------------------------------------------------------------------------

/** What a unit reserves per byte of the largest peak it was measured to hold. */
export const RESERVATION_PER_PEAK = 1.25;
/** One unit's reservation from its measured peaks: RESERVATION_PER_PEAK times the largest, at least LEAST_RESERVATION_BYTES, in whole MiB. */
export function peakReservation(peaks: readonly number[]): number {
  return Math.max(LEAST_RESERVATION_BYTES, Math.ceil(RESERVATION_PER_PEAK * Math.max(...peaks) / MIB) * MIB);
}

/**
 * What an elastic step's held tokens are counted for: each sized one at its
 * size, the rest at the step's unit. Held tokens of its unit alone are
 * exactly `tokens * unit`, as before sizes.
 */
export function elasticHeldBytes(tokens: number, sized: { readonly count: number; readonly bytes: number } | undefined, unit: number): number {
  return (tokens - (sized?.count ?? 0)) * unit + (sized?.bytes ?? 0);
}

/** A share of the machine: `width` of its `slots`, never more than all of it. */
export function machineShare(totalBytes: number, width: number, slots: number): number {
  return Math.floor(totalBytes * Math.min(width, slots) / slots);
}

/**
 * The most a key sized without a measurement of its own reserves, of the
 * `capacityBytes` the ledger can give: half, as wide as the widest step (12
 * of the gate's 24 slots here). A share for a job as wide as the machine,
 * a cargo build of 24 jobs, would be all of it, which no machine running a
 * desktop ever has free; the key is measured on its first run either way.
 */
export function unmeasuredLimit(capacityBytes: number): number {
  return Math.floor(capacityBytes / 2);
}

export type MemorySizing = {
  /** Per unit. */
  bytes: number;
  /** Own peaks; else live accounting for a job, or largest/share estimates for a step. Zero bytes means no job forecast. */
  basis: "measured" | "largest" | "share" | "live";
};

/**
 * What one unit of a step or a job reserves: from its own measured peaks;
 * never measured, a job has no forecast and uses live ledger accounting.
 * A step uses the largest reservation of its unit kind here, else `share`.
 * A step whose peaks were measured over another unit (it was fixed, and is
 * elastic now) has none of its own.
 */
export function unitReservation(history: CostHistory, of: { step: string }, unit: MemoryUnit, share: number): MemorySizing {
  const own = history.steps.get(of.step)?.memory;
  if (own && own.unit === unit) return { bytes: peakReservation(own.peaks), basis: "measured" };
  const rows = [...history.steps.values()].flatMap(row => row.memory?.unit === unit ? [row.memory] : []);
  if (rows.length) return { bytes: Math.max(...rows.map(row => peakReservation(row.peaks))), basis: "largest" };
  return { bytes: share, basis: "share" };
}

// ---------------------------------------------------------------------------
// The file.
// ---------------------------------------------------------------------------

/**
 * The history of the target a tool runs against: NTS_GATE_COSTS_DIR's, as
 * the gate gives each step and a test names its own; else CARGO_TARGET_DIR's,
 * else the tooling tree's `target`.
 */
export function historyFile(env: NodeJS.ProcessEnv = process.env, root: string = TOOLING_ROOT): string {
  const target = env.CARGO_TARGET_DIR ? resolve(env.CARGO_TARGET_DIR) : join(root, "target");
  return join(resolve(env.NTS_GATE_COSTS_DIR ?? join(target, "gate-costs")), COST_HISTORY_NAME);
}

export type StepObservation = {
  name: string; verdict?: string; cpu?: number;cpu_measure?:string;
  /** The most it held, per unit: present only for a step that ran to its own end. */
  memory?: { unit: "step" | "token"; peak: number };
};
export type JobObservation = {key:string;basis:JobBasis;peak:number;width:number};

const appended = (kept: Peaks | undefined, unit: MemoryUnit, peak: number): Peaks =>
  ({ unit, peaks: [...(kept?.unit === unit ? kept.peaks : []), peak].slice(-KEPT_PEAKS) });

/**
 * Adds what a run or a job measured to the history in `file`, under its lock,
 * and publishes the merged history atomically: a passing step's CPU seconds
 * replace its last, a peak joins its key's last few. `initialCpu` seeds CPU
 * seconds the file does not hold yet. The history's directory is made only
 * where its parent exists: a target, or a test's own directory that has not
 * been removed. A failure is observation-only, returned as a warning.
 */
export function writeCostHistory(file: string, observed: { steps?: Iterable<StepObservation>; jobs?: Iterable<JobObservation> },
  initialCpu: ReadonlyMap<string, number> = new Map()): string | undefined {
  let unlock: (() => void) | null = null;
  try {
    try { mkdirSync(dirname(file)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    unlock = lockHistory(file);
    if (unlock === null) return `${file} stayed locked for ${LOCK_WAIT_SECONDS} s`;
    const current = readCostHistory(file,()=>{});
    if(current.unsupportedVersion)return current.unsupportedVersion.message;
    const steps = new Map<string, { cpu?: number; memory?: Peaks }>();
    for (const [name, cpu] of initialCpu) if (KEY.test(name) && measured(cpu)) steps.set(name, { cpu });
    for (const [name, row] of current.steps) steps.set(name, { ...steps.get(name), ...row });
    const jobs = new Map(current.jobs);
    for (const row of observed.steps ?? []) {
      if (!KEY.test(row.name)) continue;
      const was = steps.get(row.name) ?? {};
      const cpu = row.verdict === "PASS" && measured(currentStepCpu(row)) ? row.cpu : was.cpu;
      const memory = row.memory && bytes(row.memory.peak) ? appended(was.memory, row.memory.unit, row.memory.peak) : was.memory;
      if (cpu !== undefined || memory !== undefined) steps.set(row.name, { ...(cpu !== undefined ? { cpu } : {}), ...(memory ? { memory } : {}) });
    }
    for (const row of observed.jobs ?? []) {
      if(!KEY.test(row.key)||!bytes(row.peak)||!bytes(row.width)||(row.basis!=="job"&&row.basis!=="worker")||(row.basis==="job"&&row.width!==1))throw new Error("invalid memory observation for job "+row.key);
      const was=jobs.get(row.key);assertJobBasis(row.key,row.basis,was);
      jobs.set(row.key,{basis:row.basis,observations:[...(was?.observations??[]),{peak:row.peak,width:row.width}].slice(-KEPT_PEAKS)});
    }
    publishCostHistory(file,{steps,jobs});
    if(current.legacyJobs?.length)console.error(`memory history: migrated ${current.legacyFile} to ${file}; dropped ${current.legacyJobs.length} ambiguous job key(s), kept every supported step row: ${current.legacyJobs.join(", ")}`);
    return;
  } catch (error) { return error instanceof Error ? error.message : String(error); }
  finally {
    unlock?.();
  }
}

/** Called only while the history's existing flock is held. */
function publishCostHistory(file:string,history:Pick<CostHistory,"steps"|"jobs">):void{
  assertWritableState(file,COST_HISTORY_VERSION);
  const pending=`${file}.${process.pid}.${randomUUID()}`;
  const sorted=<T>(map:ReadonlyMap<string,T>)=>Object.fromEntries([...map].sort(([a],[b])=>nameOrder(a,b)));
  try{writeFileSync(pending,JSON.stringify({version:COST_HISTORY_VERSION,cpu_measure:STEP_CPU_MEASURE,steps:sorted(history.steps),jobs:sorted(history.jobs)})+"\n",{flag:"wx",mode:0o600});renameSync(pending,file);}
  finally{rmSync(pending,{force:true});}
}

// ---------------------------------------------------------------------------
// Cases.
// ---------------------------------------------------------------------------

/** A case's key: what its tool calls it, a path or a name, printable and bounded. */
const CASE_KEY = /^[^\u0000-\u001f\u007f]{1,512}$/;
export type CaseIdentity={step:string;backend:string;path:string};
/** The version-two history key. Compiler and content identities never enter it. */
export function caseMemoryKey(identity:CaseIdentity):string{return JSON.stringify([identity.step,identity.backend,identity.path]);}
function compositeCaseKey(key:string):boolean{
  try{
    const value:unknown=JSON.parse(key);
    if(!CASE_KEY.test(key)||!Array.isArray(value)||value.length!==3)return false;
    const [step,backend,path]:unknown[]=value;
    return typeof step==='string'&&KEY.test(step)&&typeof backend==='string'&&typeof path==='string'&&path.length>0;
  }
  catch{return false;}
}
/** Each case's last few peaks, oldest first, by its key. */
export type CaseHistory = ReadonlyMap<string, readonly number[]>;
export type CaseObservation = { key: string; peak: number };

/** The case history of `step` beside the target's steps.json (`historyFile`). */
export function caseHistoryFile(step: string, env: NodeJS.ProcessEnv = process.env, root: string = TOOLING_ROOT): string {
  if (!KEY.test(step)) throw new Error(`not a step name: ${step}`);
  return join(dirname(historyFile(env, root)), "cases-v2", `${step}.json`);
}

/** Version one used subject paths for program-oracles. Migrate once at the
 * reader boundary; every writer publishes only composite version-two keys. */
export function readCaseHistory(file: string,report:(warning:string)=>void=console.error): CaseHistory {
  let value: unknown;
  let source: string;
  try { source = readFileSync(file, "utf8"); }
  catch (error) {
    // Old candidates still write cases/. Import it only before the first v2
    // publication; an old writer can never replace a newer history.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || basename(dirname(file)) !== 'cases-v2') return new Map();
    try { source = readFileSync(join(dirname(dirname(file)), 'cases', basename(file)), 'utf8'); }
    catch { return new Map(); }
  }
  try { value = JSON.parse(source); } catch { return new Map(); }
  const newer=futureStateVersion(value,2,file);if(newer){report(newer.message);return new Map();}
  if (!record(value) || (value.version!==1&&value.version!==2) || !keys(value, ["version", "cases"]) || !record(value.cases)) return new Map();
  const cases = new Map<string, readonly number[]>();
  for (const [key, peaks] of Object.entries(value.cases)) {
    if (!CASE_KEY.test(key) || !Array.isArray(peaks) || peaks.length === 0 || peaks.length > KEPT_PEAKS || !peaks.every(bytes)) return new Map();
    const step=basename(file,'.json');
    if(!KEY.test(step))return new Map();
    const migrated=value.version===1&&!compositeCaseKey(key)?caseMemoryKey({step,backend:step==='program-oracles'?'node':'',path:key}):key;
    if(!compositeCaseKey(migrated))return new Map();
    const previous=cases.get(migrated);
    // Mixed v1 histories have no cross-key timestamps. Keep the largest
    // measured peaks when old and composite keys converge, never lose one.
    cases.set(migrated,previous?[...previous,...peaks].sort((a,b)=>a-b).slice(-KEPT_PEAKS):peaks);
  }
  return cases;
}

/** What a case reserves: as a unit does, from its last few peaks; undefined when it was never measured. */
export function caseReservation(history: CaseHistory, key: string): number | undefined {
  const peaks = history.get(key);
  return peaks ? peakReservation(peaks) : undefined;
}

/**
 * Adds each case's peak to the history in `file`, under its lock, and
 * publishes it atomically. Its directory is made only beside an existing
 * target's history directory, or with it when the target exists. A failure
 * is observation-only, returned as a warning.
 */
export function writeCaseHistory(file: string, observed: Iterable<CaseObservation>): string | undefined {
  const pending = `${file}.${process.pid}.${randomUUID()}`;
  let unlock: (() => void) | null = null;
  try {
    for (const dir of [dirname(dirname(file)), dirname(file)]) {
      try { mkdirSync(dir); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    unlock = lockHistory(file);
    if (unlock === null) return `${file} stayed locked for ${LOCK_WAIT_SECONDS} s`;
    assertWritableState(file,2);
    const cases = new Map(readCaseHistory(file));
    for (const row of observed) {
      if (!compositeCaseKey(row.key) || !bytes(row.peak)) continue;
      cases.set(row.key, [...cases.get(row.key) ?? [], row.peak].slice(-KEPT_PEAKS));
    }
    const sorted = Object.fromEntries([...cases].sort(([a], [b]) => nameOrder(a, b)));
    writeFileSync(pending, JSON.stringify({ version: 2, cases: sorted }) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(pending, file);
    return;
  } catch (error) { return error instanceof Error ? error.message : String(error); }
  finally {
    try { rmSync(pending, { force: true }); } catch { /* no verdict depends on this cache */ }
    unlock?.();
  }
}
