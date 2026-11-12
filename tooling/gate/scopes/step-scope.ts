import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { checkedUnitName, childSlice, newToolingSlice, unitComponent } from "../tooling-slice.ts";
import { gateCpus, gateScope, inheritedCpus } from "../affinity.ts";
import { readStepEntry, type StepEntry } from "./step-entry.ts";
import { bindsToProperties, ownUnit, stepWorkersSlice } from "./bound-slice.ts";
import { claimRunOwner, reapRunOwner, type RunOwner } from "./run-owner.ts";

import {hostObservations,type HostObservations,type CgroupCpu} from '../host-observations.ts';
import {STEP_CPU_MEASURE} from '../step-time.ts';
import {readLimits} from './memory-limits.ts';

const CGROUP = "/sys/fs/cgroup";
const DRAIN_HANG_MS = 30_000;
export type ScopeDrain = { version: 1; slice: string; unit: string; group: string; device: string; inode: string; populated: 0; observed_at: string; cpu_measure:typeof STEP_CPU_MEASURE; cpu:CgroupCpu };
const checked = (command: string, args: string[]): string => {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: DRAIN_HANG_MS });
  if (result.error || result.signal || result.status !== 0) throw new Error(`${command} ${args[0]}: ${result.stderr || result.error?.message || result.signal || result.status}`);
  return result.stdout.trim();
};
const control = (...args: string[]) => checked("systemctl", ["--user", ...args]);

/**
 * A step slice's memory limit: `max`, the runaway bound past which the kernel
 * kills. Nothing throttles a step below it (no MemoryHigh), and swap is never
 * used.
 */
export type StepLimits = { max: number };

function startSlice(slice: string, boundTo: string, limits?: StepLimits): string {
  let created = false;
  const memory = limits ? ["MemoryMax", "t", String(limits.max), "MemorySwapMax", "t", "0"] : [];
  const binds = bindsToProperties(boundTo);
  try {
    checked("busctl", ["--user", "call", "org.freedesktop.systemd1", "/org/freedesktop/systemd1", "org.freedesktop.systemd1.Manager",
      "StartTransientUnit", "ssa(sv)a(sa(sv))", slice, "fail", String(3 + memory.length / 3 + binds.length / 4), "Description", "s", "nts owned gate step",
      "StopWhenUnneeded", "b", "false", "CollectMode", "s", "inactive-or-failed", ...binds, ...memory, "0"]);
    created = true;
    control("start", slice); // Join StartTransientUnit's queued job.
    const group = control("show", slice, "--property=ControlGroup", "--value");
    if (!group.startsWith("/") || !group.endsWith(`/${slice}`) || group.split("/").includes("..")) throw new Error("step slice has no exact cgroup identity");
    return group;
  } catch (error) {
    if (created) {
      try { control("stop", slice); }
      catch (cleanup) { throw new AggregateError([error, cleanup], `step slice setup and cleanup failed: ${slice}`); }
    }
    throw error;
  }
}

export function populated(group: string): 0 | 1 {
  const value = /^populated ([01])$/m.exec(readFileSync(`${CGROUP}${group}/cgroup.events`, "utf8"))?.[1];
  if (value === undefined) throw new Error("step cgroup lacks a populated answer");
  return value === "0" ? 0 : 1;
}

/** Whether the kernel holds `group` to `limits`: its max finite, no more than asked and less than a page under it, no throttle below it, and no swap. */
function enforced(group: string, limits: StepLimits): boolean {
  const now = readLimits(group), page = 4096;
  return Number.isSafeInteger(now.max) && now.max <= limits.max && now.max > limits.max - page && now.high === Infinity && now.swap === 0;
}

/**
 * A cgroup's memory events, counted over it and everything under it: `max`,
 * times it reached memory.max; `oom_kill`, processes the kernel killed for
 * memory -- and `own_oom`, from memory.events.local, times its own memory.max
 * was the limit that ran out, so its kills were its own bound's, not a
 * worker's.
 */
export type MemoryEvents = { max: number; oom: number; oom_kill: number; own_oom: number };
export function memoryEvents(group: string): MemoryEvents {
  const read = (file: string) => {
    const text = readFileSync(`${CGROUP}${group}/${file}`, "utf8");
    return (name: string) => Number(new RegExp(`^${name} (\\d+)$`, "m").exec(text)?.[1] ?? NaN);
  };
  const all = read("memory.events"), local = read("memory.events.local");
  const events = { max: all("max"), oom: all("oom"), oom_kill: all("oom_kill"), own_oom: local("oom") };
  if (!Object.values(events).every(Number.isSafeInteger)) throw new Error(`${group}/memory.events lacks a memory event count`);
  return events;
}

/** The most the cgroup and everything under it has held, or null where the kernel does not say. */
function memoryPeak(group: string): number | null {
  try {
    const text = readFileSync(`${CGROUP}${group}/memory.peak`, "utf8").trim();
    return /^\d+$/.test(text) ? Number(text) : null;
  } catch { return null; }
}

function reapPreviousRoot(previous: RunOwner): void {
  const group = control("show", previous.slice, "--property=ControlGroup", "--value");
  if (!group) return;
  if (!group.startsWith("/") || !group.endsWith(`/${previous.slice}`) || group.split("/").includes("..")) throw new Error("prior gate root has a foreign cgroup");
  const identity = statSync(`${CGROUP}${group}`, { bigint: true });
  if (previous.scope) {
    if (group !== previous.scope.group || String(identity.dev) !== previous.scope.device || String(identity.ino) !== previous.scope.inode) throw new Error("prior gate root identity changed");
  } else if (populated(group)) throw new Error("an unproved prior setup root acquired processes");
  if (populated(group)) control("kill", "--kill-whom=all", "--signal=SIGKILL", previous.slice);
  const deadline = performance.now() + DRAIN_HANG_MS, sleeper = new Int32Array(new SharedArrayBuffer(4));
  while (populated(group)) {
    if (performance.now() > deadline) throw new Error("prior gate root drain timed out");
    Atomics.wait(sleeper, 0, 0, 10);
  }
  const drained = statSync(`${CGROUP}${group}`, { bigint: true });
  if (drained.dev !== identity.dev || drained.ino !== identity.ino) throw new Error("prior gate root changed while draining");
  control("stop", previous.slice);
}

/** The runner owns the warm-tree lock here, before checkout or cache cleanup. */
export function reapGateRoot(ownerFile: string): void { reapRunOwner(ownerFile, reapPreviousRoot); }

/** The timeout is a failed cleanup instrument, never evidence of emptiness. */
export async function waitForEmptyCgroup(read: () => 0 | 1, effects = { now: () => performance.now(), wait: () => pause(10) }): Promise<void> {
  const began = effects.now();
  while (read()) {
    if (effects.now() - began > DRAIN_HANG_MS) throw new Error("step cgroup drain timed out");
    await effects.wait();
  }
}

/** An accounting root retains separately bounded supervisor and worker
 * subtrees. Pressure inside a worker boundary cannot kill its supervisor.
 * Drain and memory accounting cover the complete retained root. */
export class StepScope {
  readonly unit: string;
  readonly slice: string;
  readonly group: string;
  readonly supervisorSlice: string;
  readonly supervisorGroup: string;
  readonly workerSlice: string;
  readonly workerGroup: string;
  private readonly device: bigint;
  private readonly inode: bigint;
  private closed = false;
  private launched = false;
  private readonly nonce = randomUUID();
  private readonly entryPath: string;
  private peak: number | null = null;
  private cpu: CgroupCpu | null = null;
  private readonly host: HostObservations;
  private events: MemoryEvents | null = null;
  private limiting: Promise<void> | null = null;
  private wanted: StepLimits;
  private held: StepLimits;
  private caseFloor=0;
  private workerMax:number;
  constructor(root: GateScopes, limits: StepLimits) {
    this.workerMax=limits.max;
    this.host=root.host;
    this.slice = newToolingSlice(false, { NTS_TOOLING_SLICE: root.slice });
    this.unit = checkedUnitName(`nts-${unitComponent("s")}.scope`);
    this.supervisorSlice = childSlice(this.slice, "s");
    this.workerSlice = stepWorkersSlice(this.slice);
    this.group = startSlice(this.slice, root.slice);
    this.entryPath = join(root.directory, `step-entry-${this.nonce}.json`);
    try {
      this.supervisorGroup = startSlice(this.supervisorSlice, this.slice, limits);
      this.workerGroup = startSlice(this.workerSlice, this.slice, limits);
      if (!this.group.startsWith(`${root.group}/`) ||
          !this.supervisorGroup.startsWith(`${this.group}/`) || !this.workerGroup.startsWith(`${this.group}/`)) {
        throw new Error("step boundaries escaped their accounting subtree");
      }
      if (!enforced(this.supervisorGroup, limits) || !enforced(this.workerGroup, limits)) {
        throw new Error(`the kernel does not hold the step's sibling boundaries to MemoryMax=${limits.max} alone and no swap`);
      }
    } catch (error) {
      control("stop", this.slice);
      throw error;
    }
    this.wanted = this.held = limits;
    const identity = statSync(`${CGROUP}${this.group}`, { bigint: true });
    this.device = identity.dev; this.inode = identity.ino;
  }
  /** The limits the kernel holds the slice to: the last ones it was seen to take. */
  get limits(): StepLimits { return this.held; }
  get workerLimit():number{return this.workerMax;}
  /** Only worker caps contribute here. A supervisor keeps its own runaway
   * bound, and forecasts never lower an admitted case's hard budget. */
  caseLimit(bytes:number):Promise<void>{
    if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('invalid admitted case cap total');
    this.caseFloor=bytes;
    return this.limit(this.wanted);
  }
  /**
   * Moves the slice's runaway bound to `limits`, through the user manager,
   * without waiting the caller: one change at a time, the latest asked for
   * last. Read back from the kernel before it counts as held.
   */
  limit(limits: StepLimits): Promise<void> {
    this.wanted = limits;
    this.limiting ??= this.apply().finally(() => { this.limiting = null; });
    return this.limiting;
  }
  private async apply(): Promise<void> {
    while (!this.closed && (this.wanted.max !== this.held.max||Math.max(this.wanted.max,this.caseFloor)!==this.workerMax)) {
      const want = this.wanted;
      const workerMax=Math.max(want.max,this.caseFloor);
      for (const [slice,max] of [[this.supervisorSlice,want.max],[this.workerSlice,workerMax]] as const) {
        await new Promise<void>((resolve, reject) => {
          const child = spawn("systemctl", ["--user", "set-property", "--runtime", slice, `MemoryMax=${max}`], { stdio: ["ignore", "ignore", "pipe"] });
          let err = "";
          child.stderr.setEncoding("utf8").on("data", (data: string) => { err += data; });
          child.on("error", reject);
          child.on("close", code => code === 0 ? resolve() : reject(new Error(`systemctl set-property ${slice}: ${err.trim() || `exit ${code}`}`)));
        });
      }
      if (this.closed) return;
      if (!enforced(this.supervisorGroup, want) || !enforced(this.workerGroup, {max:workerMax})) {
        throw new Error(`the kernel does not hold the step's sibling boundaries to MemoryMax=${want.max}`);
      }
      this.held = want;
      this.workerMax=workerMax;
    }
  }
  /** The slice's memory events so far: read live while it runs, and once more as `drain` empties it. */
  private boundaryEvents(): MemoryEvents {
    const all = memoryEvents(this.group);
    return { ...all, own_oom: memoryEvents(this.supervisorGroup).own_oom + memoryEvents(this.workerGroup).own_oom };
  }
  memoryEvents(): MemoryEvents { return this.events ?? this.boundaryEvents(); }
  command(command: string, args: string[]): { command: string; args: string[] } {
    if (this.launched) throw new Error("step scope launched twice");
    this.launched = true;
    const cpus = gateCpus(inheritedCpus()), affinity = gateScope(cpus);
    // Apply a delegated ceiling in this scope. A second systemd scope would
    // move the command outside the subtree whose drain we prove.
    return { command: "systemd-run", args: ["--user", "--scope", "--quiet", "--collect", `--unit=${this.unit}`, `--slice=${this.supervisorSlice}`,
      ...(affinity.kind === "scope" ? [`--property=AllowedCPUs=${cpus}`] : []), "--",
      "sh", "-c", 'ulimit -c 0; "$1" "$2" "$3" "$4" "$5" "$6" || exit $?; shift 6; exec "$@"', "_",
      process.execPath, fileURLToPath(new URL("./step-entry.ts", import.meta.url)), this.entryPath, this.nonce, this.unit, `${this.supervisorGroup}/${this.unit}`,
      "taskset", "-c", cpus, command, ...args] };
  }
  entry(): StepEntry { return readStepEntry(this.entryPath, { nonce: this.nonce, unit: this.unit, group: `${this.supervisorGroup}/${this.unit}` }); }
  kill(): void { if (!this.closed) control("kill", "--kill-whom=all", "--signal=SIGKILL", this.slice); }
  /** The step's measured peak: the slice's memory.peak, which `drain` reads once its last process has exited; null before, or unread. */
  get memoryPeakBytes(): number | null { return this.peak; }
  /** Live counters for explicit kernel controls, final counters after drain. */
  cpuCounters():CgroupCpu { return this.cpu??this.host.cgroupCpu(this.group); }
  async drain(): Promise<ScopeDrain> {
    if (this.closed) throw new Error("step scope drained twice");
    if (populated(this.group)) this.kill();
    await waitForEmptyCgroup(() => populated(this.group));
    const identity = statSync(`${CGROUP}${this.group}`, { bigint: true });
    if (identity.dev !== this.device || identity.ino !== this.inode) throw new Error("step cgroup identity changed before drain");
    this.cpu=this.host.cgroupCpu(this.group);
    const proof: ScopeDrain = { version: 1, slice: this.slice, unit: this.unit, group: this.group,
      device: String(this.device), inode: String(this.inode), populated: 0, observed_at: new Date().toISOString(),cpu_measure:STEP_CPU_MEASURE,cpu:this.cpu };
    // Nothing of the step runs any more, and stopping the slice removes its cgroup.
    this.peak = memoryPeak(this.group);
    this.events = this.boundaryEvents();
    control("stop", this.slice);
    this.closed = true;
    return proof;
  }
}

export class GateScopes {
  readonly host:HostObservations;
  readonly slice: string;
  readonly group: string;
  readonly directory: string;
  private readonly temporary: boolean;
  private readonly owner: ReturnType<typeof claimRunOwner> | undefined;
  constructor(env: NodeJS.ProcessEnv, ownerFile?: string) {
    this.host=hostObservations(env);
    for (const name of ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"]) if (!env[name]) throw new Error(`step scopes require host capability ${name}; launch with the canonical host environment`);
    this.temporary = !env.NTS_GATE_RUN_DIR;
    const parent = join(homedir(), ".cache/nts/gate-scope-entries");
    if (this.temporary) mkdirSync(parent, { recursive: true });
    this.directory = env.NTS_GATE_RUN_DIR ?? mkdtempSync(join(parent, "run-"));
    mkdirSync(this.directory, { recursive: true });
    this.slice = newToolingSlice(false, env);
    this.owner = ownerFile ? claimRunOwner(ownerFile, this.slice, reapPreviousRoot) : undefined;
    const owner = ownUnit();
    if (!owner) throw new Error("gate lacks a named systemd owner");
    this.group = startSlice(this.slice, owner);
    const identity = statSync(`${CGROUP}${this.group}`, { bigint: true });
    this.owner?.complete({ group: this.group, device: String(identity.dev), inode: String(identity.ino) });
  }
  step(limits: StepLimits): StepScope { return new StepScope(this, limits); }
  close(): void {
    if (populated(this.group)) throw new Error("gate still owns populated step scopes");
    control("stop", this.slice);
    this.owner?.close();
    if (this.temporary) rmSync(this.directory, { recursive: true, force: true });
  }
}
