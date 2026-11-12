// Resident bounds for compiler processes. Address-space limits remain on
// executed test programs: tsrs reserves 32 GiB of virtual pointer space.
// Scopes are siblings of a calling land service, so every run has its own
// aggregate slice, then one persistent counter-holding slice per worker.
import { spawnSync, type SpawnSyncOptions, type SpawnSyncOptionsWithBufferEncoding, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { PressureError, CaseBudgetError, ToolingInstrumentError } from "../gate/step-result.ts";
import { recordAggregatePeak } from "../gate/case-costs.ts";
import { checkedUnitName, childSlice, toolingSlice, unitComponent } from "../gate/tooling-slice.ts";
import { bindsToProperties, ownUnit, stepWorkersSlice } from "../gate/scopes/bound-slice.ts";
import { activeCommand, CommandNotMeasuredError, COMMAND_STARTUP_BOUND_MS } from "../gate/active-process.ts";
import {caseEnvironment,caseReceipt,ownCaseWorker,retireCaseScope,type CaseReceipt} from '../gate/case-context.ts';
import {readLimits} from '../gate/scopes/memory-limits.ts';
import {ancestorMemoryIncident,memoryAncestors,type AncestorMemory} from '../gate/memory-ancestry.ts';

const CGROUP = "/sys/fs/cgroup";
const STOP_HANG_MS = 5 * 60_000;
/** One census worker's own kernel cap, in KiB, unless NTS_CENSUS_MEMORY_CAP_KB says otherwise. */
const WORKER_CAP_KB = 6_000_000;

/**
 * One census worker's own kernel cap, in bytes: what a case may hold alone.
 * The gate never sizes a step's workers below it (run.mjs's stepBudget), so a
 * case replayed alone meets only this limit.
 */
export function workerCapBytes(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.NTS_CENSUS_MEMORY_CAP_KB ?? WORKER_CAP_KB) * 1024;
}
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const integer = (value: number, what: string) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${what} must be a positive integer, got ${value}`);
  return value;
};
const systemctl = (...args: string[]) => {
  const result = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8", ...(args[0] === "stop" ? {timeout: STOP_HANG_MS} : {}) });
  if (args[0] === "stop" && (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT")
    throw new Error(`resident cap: hung waiting for ${args[1]}'s stop job to finish (${STOP_HANG_MS} ms hang guard)`, {cause: result.error});
  if (args[0] === "stop" && result.status !== 0 && result.stderr.includes(`Unit ${args[1]} not loaded.`)) return "";
  if (result.status !== 0) throw new Error(`resident cap: systemctl ${args.join(" ")} failed: ${result.stderr || result.error?.message}`);
  return result.stdout.trim();
};
/** systemctl joins StopUnit's job; a queued D-Bus reply is not a drain. */
function stopSlice(unit: string, group: string, kind: "run" | "worker"): void {
  systemctl("stop", unit);
  if (!group) return;
  let text: string;
  try { text = readFileSync(join(CGROUP, group, "cgroup.events"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  const populated = /^populated ([01])$/m.exec(text)?.[1];
  if (populated === undefined) throw new Error(`resident ${kind} cgroup has no populated evidence after its stop job: ${group}`);
  throw new Error(`resident ${kind} cgroup was not removed after its stop job finished (populated ${populated}): ${group}`);
}
const validGroup = (unit: string, group: string, parent?: string) => {
  if (!group.startsWith("/") || group === "/" || group.split("/").includes("..") || !group.endsWith(`/${unit}`)
      || (parent !== undefined && (!parent || !group.startsWith(`${parent}/`)))) {
    throw new Error(`resident cap: ${unit} has no valid ControlGroup (${JSON.stringify(group)})`);
  }
  return group;
};
const groupOf = (unit: string, parent?: string) => {
  const deadline = Date.now() + 3000;
  for (;;) {
    const group = systemctl("show", unit, "--property=ControlGroup", "--value");
    if (group || Date.now() >= deadline) return validGroup(unit, group, parent);
    pause(10);
  }
};
const failedSetup = (error: unknown, cleanup: () => void): never => {
  try { cleanup(); }
  catch (cleanupError) {
    throw new AggregateError([error, cleanupError], `resident cap: setup failed: ${String(error)}; cleanup also failed: ${String(cleanupError)}`, { cause: error });
  }
  throw error;
};
const manager = (...args: string[]) => {
  const result = spawnSync("busctl", ["--user", "call", "org.freedesktop.systemd1", "/org/freedesktop/systemd1", "org.freedesktop.systemd1.Manager", ...args], { encoding: "utf8" });
  if (result.status !== 0 && args[0] === "StopUnit" && result.stderr.includes(`Unit ${args[2]} not loaded.`)) return;
  if (result.status !== 0) throw new Error(`resident cap: user manager failed: ${result.stderr || result.error?.message}; a working user bus and XDG_RUNTIME_DIR are required`);
};
const events = (group: string, local = false) => {
  const text = readFileSync(join(CGROUP, group, local ? "memory.events.local" : "memory.events"), "utf8");
  const field = (name: string) => {
    const value = new RegExp(`^${name} (\\d+)$`, "m").exec(text)?.[1];
    if (value === undefined) throw new Error(`resident cap: ${name} absent from ${group}`);
    return Number(value);
  };
  return { oom: field("oom"), kills: field("oom_kill") };
};
// Standalone command owners observe the same kernel counters as workers.
export const memoryEvents = events;

export type MemoryCounters = { oom: number; kills: number;limitBytes?:number;ancestors?:AncestorMemory[] };
export type MemoryCause = "own-limit" | "aggregate-pressure" | "system-pressure";

/** A kill's location is not the limit that caused it. Ancestor OOM events
 * propagate upward only, so the retained worker subtree names its own caps. */
export function memoryCause(before: MemoryCounters, after: MemoryCounters, aggregateBefore: number, aggregateAfter: number): MemoryCause | undefined {
  if (after.oom < before.oom || after.kills < before.kills || aggregateAfter < aggregateBefore) throw new Error("resident cap: memory counters went backwards");
  if (after.oom > before.oom) return "own-limit";
  if (after.kills === before.kills) return undefined;
  // A positively observed local aggregate OOM keeps its existing replay or
  // exclusive-budget policy. Only an external ancestor needs attribution.
  if(aggregateAfter>aggregateBefore)return 'aggregate-pressure';
  const ancestor=ancestorMemoryIncident(before.ancestors??[],after.ancestors??[]);
  if(ancestor)throw new PressureError(`resident ancestor-cap: cgroup ${ancestor.group} at cap ${ancestor.limit} bytes killed a worker whose case cap is ${after.limitBytes} bytes`);
  return aggregateAfter > aggregateBefore ? "aggregate-pressure" : "system-pressure";
}

export type CaseConcurrency = "parallel" | "exclusive";
export function memoryDisposition(cause: MemoryCause | undefined, concurrency: CaseConcurrency): "budget" | "pressure" | undefined {
  if (cause === "own-limit" || (cause === "aggregate-pressure" && concurrency === "exclusive")) return "budget";
  return cause ? "pressure" : undefined;
}
export function caseBudgetMessage(caseName: string, bytes: number, step = process.env.NTS_GATE_STEP ?? "resident"): string {
  const gib = bytes / 2 ** 30;
  const budget = Number.isInteger(gib) ? `${gib} GiB` : `${bytes} byte`;
  return `${caseName} exceeds the ${step} step's ${budget} budget`;
}
function compileMemoryResult(cause: MemoryCause | undefined, exclusive: boolean, command: string, args: readonly string[], bytes: number, workerBytes = bytes) {
  const disposition = memoryDisposition(cause, exclusive ? "exclusive" : "parallel");
  if (disposition === "pressure") throw new PressureError(`resident ${cause}: ${[command, ...args].join(" ")} was killed without exceeding its own case budget`);
  // The aggregate includes the driver as well as its one case. Its ceiling
  // is the step budget, even when the compiler's nominal worker cap is larger.
  if (disposition === "budget" && (cause === "aggregate-pressure" || (exclusive && workerBytes >= bytes))) throw new CaseBudgetError(caseBudgetMessage(`${[command, ...args].join(" ")}`, bytes));
  return disposition === "budget";
}

// The shell execs the actual worker, so the guard costs no resident process.
// All values are argv, never interpolated shell source. A setup failure never
// runs the command and never falls back to an uncapped process.
const ENTRY = [
  "set -eu",
  "scope_ready=$1; scope_boundary=$2; scope_max=$3; shift 3",
  "scope_current=; IFS= read -r scope_current < /proc/self/cgroup",
  'case "$scope_current" in "0::$scope_boundary/"*) ;; *) echo "resident cap: worker outside its scope" >&2; exit 125 ;; esac',
  'scope_path="/sys/fs/cgroup${scope_current#0::}"',
  'if [ -n "${NTS_GATE_CASE_LEASE_ID:-}" ]; then',
  '  lease_address=${NTS_GATE_CASE_LEASE_ADDRESS:?case memory: missing broker address}',
  '  exec {lease_socket}<>"/dev/tcp/${lease_address%:*}/${lease_address##*:}" || { echo "case memory: broker unreachable" >&2; exit 125; }',
  '  printf "attach %s %s %s %s\\n" "$NTS_GATE_CASE_LEASE_ID" "$scope_boundary" "$scope_max" "${scope_current#0::}" >&"$lease_socket"',
  '  IFS= read -r lease_answer <&"$lease_socket" || { echo "case memory: broker ended before bounded entry" >&2; exit 125; }',
  '  [ "$lease_answer" = ready ] || { echo "case memory: $lease_answer" >&2; exit 125; }',
  '  exec {lease_socket}>&-',
  'fi',
  'scope_limit=; IFS= read -r scope_limit < "$scope_path/memory.max"',
  'case "$scope_limit" in max|*[!0-9]*|"") echo "resident cap: worker has no finite MemoryMax" >&2; exit 125 ;; esac',
  '[ "$scope_limit" -le "$scope_max" ] || { echo "resident cap: worker MemoryMax exceeds budget" >&2; exit 125; }',
  'scope_swap=; IFS= read -r scope_swap < "$scope_path/memory.swap.max"',
  '[ "$scope_swap" = 0 ] || { echo "resident cap: worker swap is not disabled" >&2; exit 125; }',
  'scope_oom_group=; IFS= read -r scope_oom_group < "$scope_path/memory.oom.group"',
  '[ "$scope_oom_group" = 1 ] || { echo "resident cap: worker has no OOM group boundary" >&2; exit 125; }',
  'printf "%s\\n" "$scope_current" > "$scope_ready"',
  "ulimit -c 0",
  'exec "$@"',
].join("\n");

export type MemoryScope = { unit: string; ready: string; argv: string[]; env: NodeJS.ProcessEnv };

/**
 * The step's retained worker boundary is a sibling of its supervisor.
 * The kernel must place both beneath the caller's owned accounting root.
 * A worker hitting this boundary cannot make the supervisor an OOM victim.
 */
function cappingSlice(): { slice: string; group: string;case:boolean } | undefined {
  // A nested worker stays within its enclosing case's cap.
  if (inResidentWorker()) {
    const group = process.env.NTS_CENSUS_WORKER_GROUP!;
    return { slice: basename(group), group,case:true };
  }
  const slice = toolingSlice();
  if (!slice) return undefined;
  const own = readFileSync("/proc/self/cgroup", "utf8").trim().replace(/^0::/, "");
  const at = own.split("/").indexOf(slice);
  if (at < 1) return undefined;
  const parent = own.split("/").slice(0, at + 1).join("/");
  const workers = stepWorkersSlice(slice), group = parent + "/" + workers;
  if (!existsSync(join(CGROUP, group))) return undefined;
  const max = Number(readFileSync(join(CGROUP, group, "memory.max"), "utf8"));
  if (!Number.isSafeInteger(max) || max < 1 || readFileSync(join(CGROUP, group, "memory.swap.max"), "utf8").trim() !== "0") {
    throw new Error("resident cap: the step's worker boundary lacks a finite swap-free ceiling");
  }
  // Canonical tooling children may omit resident process markers. Their
  // actual kernel ancestry still keeps a nested owner inside its case cap.
  if (own.startsWith(group + "/")) {
    const parts = own.split("/");
    for (let end = parts.length - 1; end > at; end--) {
      if (!parts[end - 1]?.endsWith(".slice")) continue;
      const candidate = parts.slice(0, end).join("/");
      const limit = Number(readFileSync(join(CGROUP, candidate, "memory.max"), "utf8"));
      if (Number.isSafeInteger(limit) && limit > 0) return { slice: parts[end - 1]!, group: candidate,case:true };
    }
  }
  return { slice: workers, group,case:false };
}

export class MemoryRun {
  readonly prefix: string;
  readonly slice: string;
  readonly group: string = "";
  readonly budgetBytes: number;
  readonly directory: string;
  #workers: MemoryWorker[] = [];
  #closed = false;
  #recordPeak = false;
  /** The step's sibling worker boundary, when it supplies the aggregate's cap. */
  #outer: string | undefined;
  #parentCap: string | undefined;
  #description: string;
  constructor({ budgetBytes, id = basename(process.env.NTS_GATE_RUN_DIR ?? String(Date.now())) }: { budgetBytes?: number; id?: string } = {}) {
    // A budget of its own -- a caller's, as a capture's or a test's -- is its
    // aggregate's own cap wherever it runs; the step's budget (the default)
    // is the step slice's to enforce inside a gate step.
    const stepBudget = budgetBytes === undefined;
    const boundary = cappingSlice();
    const requested=integer(budgetBytes ?? Number(process.env.NTS_GATE_STEP_MEMORY_BYTES ?? 8 * 2 ** 30), "resident run budget");
    this.budgetBytes=boundary?.case?Math.min(requested,readLimits(boundary.group).max):requested;
    this.#recordPeak = Boolean(process.env.NTS_GATE_RUN_DIR) && id === basename(process.env.NTS_GATE_RUN_DIR!);
    this.#parentCap = boundary?.group;
    // Slice names encode their ancestry. Keep labels in the description so
    // nested gates retain room for their worker slices under systemd's limit.
    const suffix = `c${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    this.#description = `nts census resident cap ${id}`;
    this.slice = childSlice(boundary?.slice ?? toolingSlice(), unitComponent("c"));
    this.prefix = this.slice.slice(0, -6);
    this.directory = join(homedir(), ".cache/nts/worker-memory", "nts" + suffix);
    mkdirSync(this.directory, { recursive: true });
    try {
      // The step's worker boundary follows its grant. Its supervisor is
      // outside that cap and can record a worker killed by pressure there.
      // An explicit budget also keeps its aggregate's own case limit.
      this.#outer = stepBudget ? boundary?.group : undefined;
      // Bound to the unit this process runs in, as a gate run's root slice
      // is: a census killed without close() -- its unit stopped, itself
      // SIGKILLed -- takes its slices with that unit instead of leaving
      // them loaded for ever (#633). No named unit, no binding: the count
      // finds what such a run leaves.
      this.group = this.#slice(this.slice, this.#outer ? null : this.budgetBytes, ownUnit());
    } catch (error) {
      failedSetup(error, () => this.close());
    }
  }
  #slice(unit: string, bytes: number | null, boundTo: string | undefined, parent?: string) {
    try {
      const cap = bytes === null ? [] : ["MemoryMax", "t", String(bytes)];
      const binds = bindsToProperties(boundTo);
      manager("StartTransientUnit", "ssa(sv)a(sa(sv))", unit, "fail", String(4 + cap.length / 3 + binds.length / 4), "Description", "s", this.#description, ...cap, "MemorySwapMax", "t", "0", "StopWhenUnneeded", "b", "false", "CollectMode", "s", "inactive-or-failed", ...binds, "0");
      // StartTransientUnit returns a queued job, not an active slice. Join
      // that job before reading ControlGroup or any kernel memory controls.
      systemctl("start", unit);
      const group = groupOf(unit, parent);
      this.#verify(group, bytes);
      return group;
    } catch (error) {
      return failedSetup(error, () => manager("StopUnit", "ss", unit, "replace"));
    }
  }
  #verify(group: string, maximum: number | null) {
    // The kernel rounds byte budgets down to whole pages. Its actual ceiling
    // must remain finite, positive and no greater than the reserved budget;
    // an aggregate inside a gate step has none of its own, and the step's
    // slice above it must.
    const swapless = (at: string) => readFileSync(join(CGROUP, at, "memory.swap.max"), "utf8").trim() === "0";
    if (maximum === null) {
      const outer = this.#outer!, limit = Number(readFileSync(join(CGROUP, outer, "memory.max"), "utf8"));
      if (!group || !group.startsWith(`${outer}/`) || readFileSync(join(CGROUP, group, "memory.max"), "utf8").trim() !== "max" || !swapless(group)
          || !Number.isSafeInteger(limit) || limit < 1 || !swapless(outer)) {
        throw new Error(`resident cap: the step slice ${outer} does not hold ${group} to a finite ceiling with swap zero`);
      }
      return;
    }
    const limit = group ? Number(readFileSync(join(CGROUP, group, "memory.max"), "utf8")) : NaN;
    if (!group || !Number.isSafeInteger(limit) || limit < 1 || limit > maximum || !swapless(group)) {
      throw new Error(`resident cap: kernel did not enforce ${maximum} bytes/swap zero for ${group}`);
    }
  }
  worker(index: string | number, bytes: number) {
    if (this.#closed) throw new Error("resident run is closed");
    const limit = bytes === 0 ? this.budgetBytes : Math.min(integer(bytes, "resident worker budget"), this.budgetBytes);
    if (!/^[a-zA-Z0-9]+$/.test(String(index))) throw new Error("invalid resident worker index");
    const slice = childSlice(this.slice, `w${this.#workers.length.toString(36)}`);
    // A worker slice binds to its run's aggregate, as a step slice binds
    // to its run's root: stopping the aggregate stops every worker.
    const bootstrap=Math.min(limit,this.effectiveBudgetBytes());
    const group = this.#slice(slice, bootstrap, this.slice, this.group);
    const worker = new MemoryWorker(this, slice, group, limit);
    this.#workers.push(worker);
    return worker;
  }
  aggregateOoms() { return events(this.group, true).oom; }
  effectiveBudgetBytes() {
    // The step's worker boundary follows its live grant independently of
    // the supervisor's sibling runaway bound.
    if (this.#outer) {
      const outer = Number(readFileSync(join(CGROUP, this.#outer, "memory.max"), "utf8"));
      if (!Number.isSafeInteger(outer) || outer < 1) throw new Error("resident cap: the step slice's ceiling is not finite");
      return outer;
    }
    const bytes = Number(readFileSync(join(CGROUP, this.group, "memory.max"), "utf8"));
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > this.budgetBytes) throw new Error("resident cap: aggregate ceiling changed outside its reservation");
    if (this.#parentCap) {
      const parent = Number(readFileSync(join(CGROUP, this.#parentCap, "memory.max"), "utf8"));
      if (!Number.isSafeInteger(parent) || parent < 1) throw new Error("resident cap: enclosing worker ceiling changed");
      return Math.min(bytes, parent);
    }
    return bytes;
  }
  /** Whether its round has ended: a closed run holds no slice and starts no worker. */
  get closed() { return this.#closed; }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    let failure: unknown;
    for (const worker of this.#workers) {
      try { worker.close(); } catch (error) { failure ??= error; }
    }
    if (this.group && this.#recordPeak) recordAggregatePeak(this.group, this.budgetBytes);
    try { stopSlice(this.slice, this.group, "run"); } catch (error) { failure ??= error; }
    rmSync(this.directory, { recursive: true, force: true });
    if (failure) throw failure;
  }
}

export class MemoryWorker {
  readonly run: MemoryRun;
  readonly slice: string;
  readonly group: string;
  readonly bytes: number;
  #closed = false;
  #scopes = new Set<MemoryScope>();
  #receipt:CaseReceipt|undefined;
  constructor(run: MemoryRun, slice: string, group: string, bytes: number) {
    this.run = run; this.slice = slice; this.group = validGroup(slice, group, run.group); this.bytes = bytes;
  }
  kills() { return events(this.group).kills; }
  counters(): MemoryCounters {
    return {...events(this.group),limitBytes:readLimits(this.group).max,
      ancestors:memoryAncestors(this.group,group=>({max:readLimits(group).max,oom:events(group,true).oom}))};
  }
  scope(command: string, args: readonly string[], environment: NodeJS.ProcessEnv = process.env): MemoryScope {
    if (this.#closed) throw new Error("resident worker is closed");
    // Scope names do not encode ancestry. The explicit --slice owns it.
    const unit = checkedUnitName(`nts-${unitComponent("c")}.scope`);
    const ready = join(this.run.directory, `${unit}.ready`);
    const childEnvironment=caseEnvironment(environment);
    this.#receipt=caseReceipt(childEnvironment);
    const bootstrap=Math.min(this.bytes,this.run.effectiveBudgetBytes());
    const scope = {
      unit, ready,
      argv: ["--user", "--scope", "--collect", "--quiet", `--unit=${unit}`, `--slice=${this.slice}`, "-p", `MemoryMax=${bootstrap}`, "-p", "MemorySwapMax=0", "-p", "OOMPolicy=kill", "bash", "-c", ENTRY, "nts-resident-worker", ready, this.group, String(this.bytes), command, ...args],
      env: { ...childEnvironment, NTS_CENSUS_WORKER_GROUP: this.group, NTS_CENSUS_WORKER_MAX_BYTES: String(this.bytes), NTS_CENSUS_RUN_GROUP: this.run.group, NTS_CENSUS_RUN_MAX_BYTES: String(this.run.budgetBytes) },
    };
    this.#scopes.add(scope);
    return scope;
  }
  ready(scope: MemoryScope) { return existsSync(scope.ready); }
  stop(scope: MemoryScope) {
    if (!this.#scopes.delete(scope)) return;
    // A successfully exited --collect scope has already disappeared.
    manager("StopUnit", "ss", scope.unit, "replace");
    rmSync(scope.ready, { force: true });
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    retireCaseScope(this.#receipt,this.group);
    for (const scope of [...this.#scopes]) this.stop(scope);
    stopSlice(this.slice, this.group, "worker");
  }
}

// The persistent worker is already kernel-bounded. Validate that fact instead
// of trusting an env flag to turn off a bound on a standalone invocation.
export function inResidentWorker(): boolean {
  const boundary = process.env.NTS_CENSUS_WORKER_GROUP;
  if (!boundary) return false;
  const aggregate = process.env.NTS_CENSUS_RUN_GROUP;
  if (!aggregate?.startsWith("/") || aggregate === "/" || aggregate.split("/").includes("..") || !boundary.startsWith(`${aggregate}/`)) {
    throw new Error("resident cap: worker has no valid aggregate group; refusing to infer its boundary");
  }
  const current = readFileSync("/proc/self/cgroup", "utf8").trim().replace(/^0::/, "");
  const limit = Number(readFileSync(join(CGROUP, current, "memory.max"), "utf8"));
  if (!current.startsWith(`${boundary}/`) || !Number.isFinite(limit) || limit < 1 || limit > Number(process.env.NTS_CENSUS_WORKER_MAX_BYTES) || readFileSync(join(CGROUP, current, "memory.swap.max"), "utf8").trim() !== "0") {
    throw new Error("resident cap: worker scope is absent or not bounded; refusing to compile uncapped");
  }
  return true;
}

/**
 * The process's own run, for the compiles it starts itself (compileSync,
 * compileActive), and their lanes: a worker slice per compile in flight, at
 * that compile's cap, kept idle for the next compile of that cap once it ends.
 * A process that compiles one thing at a time reuses one lane; one that runs
 * several at once gives each a lane of its own, so no compile shares
 * another's cap.
 */
let direct: { run: MemoryRun; idle: Map<string, MemoryWorker[]>; lanes: number } | undefined;
let closesOnExit = false;
/** Drain an existing serial/controller owner without creating another run. */
export function closeMemoryRun(): void { direct?.run.close(); }
/**
 * The process's run, made on first use. Its aggregate's kernel cap is
 * `budgetBytes` when given -- a caller that runs several compiles at once
 * makes it hold all their caps -- else the step's (NTS_GATE_STEP_MEMORY_BYTES).
 */
export function memoryRun(budgetBytes?: number): MemoryRun {
  // A round closes its run as it ends; a later round of the same process (a
  // writer's repeat) gets one of its own. The handlers below close whichever
  // run is current.
  if (direct?.run.closed) direct = undefined;
  if (direct && budgetBytes !== undefined && direct.run.budgetBytes !== budgetBytes) {
    throw new Error(`resident cap: this process's run holds ${direct.run.budgetBytes} bytes, not the ${budgetBytes} asked for`);
  }
  direct ??= { run: new MemoryRun(budgetBytes === undefined ? {} : { budgetBytes }), idle: new Map(), lanes: 0 };
  if (!closesOnExit) {
    closesOnExit = true;
    process.on("exit", () => direct?.run.close());
    for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
      process.once(signal, () => { direct?.run.close(); process.exit(code); });
    }
  }
  return direct.run;
}

/** Re-enter a serial runner once inside one persistent scope for the whole run. */
type CompilerTools = { memoryCapKb?: number };
type MemoryResult<T> = T & { memoryKilled: boolean; residentLimitBytes: number; residentRunBytes: number };
export function serialRun(tools: CompilerTools): void {
  if (inResidentWorker()) return;
  const run = memoryRun();
  const worker = run.worker("serial", Number(tools.memoryCapKb ?? WORKER_CAP_KB) * 1024);
  const scope = worker.scope(process.execPath, [...process.execArgv, ...process.argv.slice(1)]);
  scope.env.NTS_CENSUS_CASE_CONCURRENCY = "exclusive";
  const activeCase = join(run.directory, "serial-case.txt");
  scope.env.NTS_CENSUS_ACTIVE_CASE = activeCase;
  const before = worker.counters(), aggregateBefore = run.aggregateOoms();
  let result;
  try {
    result = spawnSync("systemd-run", scope.argv, { stdio: "inherit", env: scope.env });
    if (!worker.ready(scope)) throw new Error("resident cap: serial runner failed before bounded entry");
    const ooms = run.aggregateOoms();
    if (ooms) console.error(`resident aggregate cap fired ${ooms} time(s)`);
    const cause = memoryCause(before, worker.counters(), aggregateBefore, ooms);
    if (cause === "aggregate-pressure" || cause === "system-pressure" || (cause === "own-limit" && result.status !== 0)) {
      const caseName = existsSync(activeCase) ? readFileSync(activeCase, "utf8") : process.argv.slice(1).join(" ");
      compileMemoryResult(cause, true, caseName, [], run.budgetBytes, worker.bytes);
    }
  } finally {
    worker.stop(scope);
    run.close();
  }
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

/** The owned worker subtree available to a supervisor outside its cap. */
export function supervisorWorkerBoundary() {
  const boundary = cappingSlice();
  if (!boundary) return;
  const current = readFileSync("/proc/self/cgroup", "utf8").trim().replace(/^0::/, "");
  return current.startsWith(boundary.group + "/") ? undefined : boundary;
}

let commandOrdinal = 0;

type EntryResult = { error?: Error; hung?: string; runaway?: string; timeout?: string;
  stderr?: string | Buffer; status?: number | null; signal?: NodeJS.Signals | null };
function entryFailure(label: string, result: EntryResult): never {
  const reason = result.error?.message || result.hung || result.runaway || result.timeout ||
    String(result.stderr ?? "").trim() || (result.signal ? `signal ${result.signal}` : `exit ${result.status ?? "unknown"}`);
  throw new ToolingInstrumentError("tooling-setup", `${label} failed before bounded entry: ${reason}`);
}

/** Plain commands launched by a step supervisor use the same worker boundary
 * as resident pools. An explicit resident launch already owns its scope. */
export function commandWorker(command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env) {
  const boundary = supervisorWorkerBoundary();
  if (!boundary) return;
  const resident = env.NTS_CENSUS_WORKER_GROUP;
  if (command === "systemd-run" && resident?.startsWith(boundary.group + "/") &&
      args.includes("--slice=" + basename(resident))) {
    const limit = Number(readFileSync(join(CGROUP, resident, "memory.max"), "utf8"));
    if (!Number.isSafeInteger(limit) || limit < 1 ||
        readFileSync(join(CGROUP, resident, "memory.swap.max"), "utf8").trim() !== "0") {
      throw new Error("resident launch lacks its bounded worker slice");
    }
    return;
  }
  const memory = memoryRun();
  const worker = memory.worker("command" + commandOrdinal++, Math.min(memory.budgetBytes,workerCapBytes(env)));
  const before = worker.counters(), aggregateBefore = memory.aggregateOoms();
  const scope = worker.scope(command, [...args], env);
  return {
    scope,
    ready() { return worker.ready(scope); },
    observation(result: EntryResult) {
      if (!worker.ready(scope)) entryFailure("worker command", result);
      const cause = memoryCause(before, worker.counters(), aggregateBefore, memory.aggregateOoms());
      return cause ? { cause, limitBytes: worker.bytes } : undefined;
    },
    close() { worker.close(); },
  };
}

// Both execution APIs share the same cgroup observations and attribution.
function compilerInvocation<TOptions extends {env?: NodeJS.ProcessEnv}>(tools: CompilerTools, command: string, args: readonly string[], options: TOptions) {
  const noAddressLimit = ["-c", 'ulimit -c 0; exec "$0" "$@"', command, ...args];
  if (inResidentWorker()) {
    const boundary = process.env.NTS_CENSUS_WORKER_GROUP!;
    const aggregate = process.env.NTS_CENSUS_RUN_GROUP!;
    const before = events(boundary);
    const aggregateBefore = events(aggregate, true).oom;
    if (process.env.NTS_CENSUS_ACTIVE_CASE) writeFileSync(process.env.NTS_CENSUS_ACTIVE_CASE, `${[command, ...args].join(" ")}`);
    return {command:"sh",args:noAddressLimit,options,entryReady:undefined,close:()=>{},finish:<T extends {stderr?: string | Buffer; error?: Error}>(result:T)=>{
      const cause = memoryCause(before, events(boundary), aggregateBefore, events(aggregate, true).oom);
      const memoryKilled = compileMemoryResult(cause, process.env.NTS_CENSUS_CASE_CONCURRENCY === "exclusive", command, args, Number(process.env.NTS_CENSUS_RUN_MAX_BYTES), Number(process.env.NTS_CENSUS_WORKER_MAX_BYTES));
      return { ...result, memoryKilled, residentLimitBytes: Number(process.env.NTS_CENSUS_WORKER_MAX_BYTES), residentRunBytes: Number(process.env.NTS_CENSUS_RUN_MAX_BYTES) };
    }};
  }
  // Standalone callers are bounded too. Serial runners and parallel census
  // workers enter a scope once, then compile without a per-case bus round trip.
  const run = memoryRun(), lanes = direct!;
  const bytes = Number(tools.memoryCapKb ?? WORKER_CAP_KB) * 1024;
  const receipt=caseReceipt(options.env),laneKey=String(bytes)+':'+(receipt?.id??'');
  const idle = lanes.idle.get(laneKey) ?? [];
  lanes.idle.set(laneKey, idle);
  let worker=idle.pop();
  if(!worker){worker=run.worker(`direct${lanes.lanes++}`,bytes);const owned=worker;ownCaseWorker(receipt,()=>{owned.close();lanes.idle.delete(laneKey);});}
  const scope = worker.scope("sh", noAddressLimit, options.env);
  const before = worker.counters();
  const aggregateBefore = worker.run.aggregateOoms();
  let closed=false;
  // The lane is idle again once its scope is stopped, for the next compile of its cap.
  const close=()=>{if(!closed){closed=true;worker.stop(scope);idle.push(worker);}};
  return {command:"systemd-run",args:scope.argv,options:{...options,env:scope.env},entryReady:()=>worker.ready(scope),close,finish:<T extends {stderr?: string | Buffer; error?: Error}>(result:T)=>{
    try{
      if (!worker.ready(scope)) entryFailure("compiler scope", result);
    }finally{close();}
    const cause = memoryCause(before, worker.counters(), aggregateBefore, worker.run.aggregateOoms());
    const memoryKilled = compileMemoryResult(cause, true, command, args, worker.run.budgetBytes, worker.bytes);
    return { ...result, memoryKilled, residentLimitBytes: worker.bytes, residentRunBytes: worker.run.budgetBytes };
  }};
}

export function compileSync(tools: CompilerTools, command: string, args: readonly string[], options: SpawnSyncOptionsWithStringEncoding): MemoryResult<SpawnSyncReturns<string>>;
export function compileSync(tools: CompilerTools, command: string, args: readonly string[], options: SpawnSyncOptionsWithBufferEncoding): MemoryResult<SpawnSyncReturns<Buffer>>;
export function compileSync(tools: CompilerTools, command: string, args: readonly string[], options: SpawnSyncOptions): MemoryResult<SpawnSyncReturns<string | Buffer>>;
export function compileSync(tools: CompilerTools, command: string, args: readonly string[], options: SpawnSyncOptions): MemoryResult<SpawnSyncReturns<string | Buffer>> {
  const invocation=compilerInvocation(tools,command,args,options);
  try{return invocation.finish(spawnSync(invocation.command,invocation.args,invocation.options));}
  finally{invocation.close();}
}

/** Activity and CPU bounds replace wall deadlines without changing OOM policy. */
export async function compileActive(tools: CompilerTools, command: string, args: readonly string[], options: Partial<Parameters<typeof activeCommand>[2]> = {}) {
  if("timeout" in options)throw new Error("compileActive does not accept wall-clock verdict deadlines");
  const invocation=compilerInvocation(tools,command,args,options);
  try{
    const result=await activeCommand(invocation.command,invocation.args,{...options,cwd:options.cwd??process.cwd(),env:invocation.options.env??process.env,
      ...(invocation.entryReady?{boundedEntry:{startupMs:options.boundedEntry?.startupMs??COMMAND_STARTUP_BOUND_MS,ready:invocation.entryReady}}:{})});
    const measured=invocation.finish(result);
    if(!measured.memoryKilled&&(result.hung||result.runaway))throw new CommandNotMeasuredError(result);
    return measured;
  }finally{invocation.close();}
}
