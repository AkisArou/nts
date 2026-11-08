import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { newToolingSlice } from "../tooling-slice.ts";
import { gateCpus, gateScope, inheritedCpus } from "../affinity.ts";
import { readStepEntry, type StepEntry } from "./step-entry.ts";
import { claimRunOwner, reapRunOwner, type RunOwner } from "./run-owner.ts";

const CGROUP = "/sys/fs/cgroup";
const DRAIN_HANG_MS = 30_000;
export type ScopeDrain = { version: 1; slice: string; unit: string; group: string; device: string; inode: string; populated: 0; observed_at: string };
const checked = (command: string, args: string[]): string => {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: DRAIN_HANG_MS });
  if (result.error || result.signal || result.status !== 0) throw new Error(`${command} ${args[0]}: ${result.stderr || result.error?.message || result.signal || result.status}`);
  return result.stdout.trim();
};
const control = (...args: string[]) => checked("systemctl", ["--user", ...args]);

function startSlice(slice: string, boundTo: string): string {
  let created = false;
  try {
    checked("busctl", ["--user", "call", "org.freedesktop.systemd1", "/org/freedesktop/systemd1", "org.freedesktop.systemd1.Manager",
      "StartTransientUnit", "ssa(sv)a(sa(sv))", slice, "fail", "5", "Description", "s", "nts owned gate step",
      "StopWhenUnneeded", "b", "false", "CollectMode", "s", "inactive-or-failed", "BindsTo", "as", "1", boundTo, "After", "as", "1", boundTo, "0"]);
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

function populated(group: string): 0 | 1 {
  const value = /^populated ([01])$/m.exec(readFileSync(`${CGROUP}${group}/cgroup.events`, "utf8"))?.[1];
  if (value === undefined) throw new Error("step cgroup lacks a populated answer");
  return value === "0" ? 0 : 1;
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

/** The retained step slice contains its execution scope and nested census
 * scopes. Read populated=0 on that complete subtree before stopping the slice;
 * reading only the execution scope would miss its sibling worker scopes. */
export class StepScope {
  readonly unit: string;
  readonly slice: string;
  readonly group: string;
  private readonly device: bigint;
  private readonly inode: bigint;
  private closed = false;
  private launched = false;
  private readonly nonce = randomUUID();
  private readonly entryPath: string;
  constructor(root: GateScopes) {
    this.slice = newToolingSlice(false, { NTS_TOOLING_SLICE: root.slice });
    this.unit = `${this.slice.slice(0, -6)}-step.scope`;
    this.group = startSlice(this.slice, root.slice);
    this.entryPath = join(root.directory, `step-entry-${this.nonce}.json`);
    if (!this.group.startsWith(`${root.group}/`)) throw new Error("step slice escaped its run's subtree");
    const identity = statSync(`${CGROUP}${this.group}`, { bigint: true });
    this.device = identity.dev; this.inode = identity.ino;
  }
  command(command: string, args: string[]): { command: string; args: string[] } {
    if (this.launched) throw new Error("step scope launched twice");
    this.launched = true;
    const cpus = gateCpus(inheritedCpus()), affinity = gateScope(cpus);
    // Apply a delegated ceiling in this scope. A second systemd scope would
    // move the command outside the subtree whose drain we prove.
    return { command: "systemd-run", args: ["--user", "--scope", "--quiet", "--collect", `--unit=${this.unit}`, `--slice=${this.slice}`,
      ...(affinity.kind === "scope" ? [`--property=AllowedCPUs=${cpus}`] : []), "--",
      "sh", "-c", 'ulimit -c 0; "$1" "$2" "$3" "$4" "$5" "$6" || exit $?; shift 6; exec "$@"', "_",
      process.execPath, fileURLToPath(new URL("./step-entry.ts", import.meta.url)), this.entryPath, this.nonce, this.unit, `${this.group}/${this.unit}`,
      "taskset", "-c", cpus, command, ...args] };
  }
  entry(): StepEntry { return readStepEntry(this.entryPath, { nonce: this.nonce, unit: this.unit, group: `${this.group}/${this.unit}` }); }
  kill(): void { if (!this.closed) control("kill", "--kill-whom=all", "--signal=SIGKILL", this.slice); }
  async drain(): Promise<ScopeDrain> {
    if (this.closed) throw new Error("step scope drained twice");
    if (populated(this.group)) this.kill();
    await waitForEmptyCgroup(() => populated(this.group));
    const identity = statSync(`${CGROUP}${this.group}`, { bigint: true });
    if (identity.dev !== this.device || identity.ino !== this.inode) throw new Error("step cgroup identity changed before drain");
    const proof: ScopeDrain = { version: 1, slice: this.slice, unit: this.unit, group: this.group,
      device: String(this.device), inode: String(this.inode), populated: 0, observed_at: new Date().toISOString() };
    control("stop", this.slice);
    this.closed = true;
    return proof;
  }
}

export class GateScopes {
  readonly slice: string;
  readonly group: string;
  readonly directory: string;
  private readonly temporary: boolean;
  private readonly owner: ReturnType<typeof claimRunOwner> | undefined;
  constructor(env: NodeJS.ProcessEnv, ownerFile?: string) {
    for (const name of ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"]) if (!env[name]) throw new Error(`step scopes require host capability ${name}; launch with the canonical host environment`);
    this.temporary = !env.NTS_GATE_RUN_DIR;
    const parent = join(homedir(), ".cache/nts/gate-scope-entries");
    if (this.temporary) mkdirSync(parent, { recursive: true });
    this.directory = env.NTS_GATE_RUN_DIR ?? mkdtempSync(join(parent, "run-"));
    mkdirSync(this.directory, { recursive: true });
    this.slice = newToolingSlice(false, env);
    this.owner = ownerFile ? claimRunOwner(ownerFile, this.slice, reapPreviousRoot) : undefined;
    const owner = readFileSync("/proc/self/cgroup", "utf8").trim().split("/").at(-1)!;
    if (!/^[a-zA-Z0-9_.:@-]+\.(?:scope|service)$/.test(owner)) throw new Error("gate lacks a named systemd owner");
    this.group = startSlice(this.slice, owner);
    const identity = statSync(`${CGROUP}${this.group}`, { bigint: true });
    this.owner?.complete({ group: this.group, device: String(identity.dev), inode: String(identity.ino) });
  }
  step(): StepScope { return new StepScope(this); }
  close(): void {
    if (populated(this.group)) throw new Error("gate still owns populated step scopes");
    control("stop", this.slice);
    this.owner?.close();
    if (this.temporary) rmSync(this.directory, { recursive: true, force: true });
  }
}
