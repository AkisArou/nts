// Resident bounds for compiler processes. Address-space limits remain on
// executed test programs: tsrs reserves 32 GiB of virtual pointer space.
// Scopes are siblings of a calling land service, so every run has its own
// aggregate slice, then one persistent counter-holding slice per worker.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { recordAggregatePeak } from "../gate/case-costs.ts";

const CGROUP = "/sys/fs/cgroup";
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const integer = (value: number, what: string) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${what} must be a positive integer, got ${value}`);
  return value;
};
const systemctl = (...args: string[]) => {
  const result = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`resident cap: systemctl ${args.join(" ")} failed: ${result.stderr || result.error?.message}`);
  return result.stdout.trim();
};
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

export type MemoryCounters = { oom: number; kills: number };
export type MemoryCause = "own-limit" | "aggregate-pressure" | "system-pressure";

/** A kill's location is not the limit that caused it. Ancestor OOM events
 * propagate upward only, so the retained worker subtree names its own caps. */
export function memoryCause(before: MemoryCounters, after: MemoryCounters, aggregateBefore: number, aggregateAfter: number): MemoryCause | undefined {
  if (after.oom < before.oom || after.kills < before.kills || aggregateAfter < aggregateBefore) throw new Error("resident cap: memory counters went backwards");
  if (after.oom > before.oom) return "own-limit";
  if (after.kills === before.kills) return undefined;
  return aggregateAfter > aggregateBefore ? "aggregate-pressure" : "system-pressure";
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
  'scope_limit=; IFS= read -r scope_limit < "$scope_path/memory.max"',
  'case "$scope_limit" in max|*[!0-9]*|"") echo "resident cap: worker has no finite MemoryMax" >&2; exit 125 ;; esac',
  '[ "$scope_limit" -le "$scope_max" ] || { echo "resident cap: worker MemoryMax exceeds budget" >&2; exit 125; }',
  'scope_swap=; IFS= read -r scope_swap < "$scope_path/memory.swap.max"',
  '[ "$scope_swap" = 0 ] || { echo "resident cap: worker swap is not disabled" >&2; exit 125; }',
  'printf "%s\\n" "$scope_current" > "$scope_ready"',
  "ulimit -c 0",
  'exec "$@"',
].join("\n");

export type MemoryScope = { unit: string; ready: string; argv: string[]; env: NodeJS.ProcessEnv };

export class MemoryRun {
  readonly prefix: string;
  readonly slice: string;
  readonly group: string = "";
  readonly budgetBytes: number;
  readonly directory: string;
  #workers: MemoryWorker[] = [];
  #closed = false;
  #recordPeak = false;
  constructor({ budgetBytes = Number(process.env.NTS_GATE_STEP_MEMORY_BYTES ?? 8 * 2 ** 30), id = basename(process.env.NTS_GATE_RUN_DIR ?? String(Date.now())) } = {}) {
    this.budgetBytes = integer(budgetBytes, "resident run budget");
    this.#recordPeak = Boolean(process.env.NTS_GATE_RUN_DIR) && id === basename(process.env.NTS_GATE_RUN_DIR!);
    this.prefix = `ntscensus${id.replace(/[^a-zA-Z0-9]/g, "").slice(-32)}p${process.pid}x${randomUUID().slice(0, 8)}`;
    this.slice = `${this.prefix}.slice`;
    this.directory = join(homedir(), ".cache/nts/worker-memory", this.prefix);
    mkdirSync(this.directory, { recursive: true });
    try {
      this.group = this.#slice(this.slice, this.budgetBytes);
    } catch (error) {
      failedSetup(error, () => this.close());
    }
  }
  #slice(unit: string, bytes: number, parent?: string) {
    try {
      manager("StartTransientUnit", "ssa(sv)a(sa(sv))", unit, "fail", "5", "Description", "s", `nts census resident cap ${this.prefix}`, "MemoryMax", "t", String(bytes), "MemorySwapMax", "t", "0", "StopWhenUnneeded", "b", "false", "CollectMode", "s", "inactive-or-failed", "0");
      // StartTransientUnit returns a queued job, not an active slice. Join
      // that job before reading ControlGroup or any kernel memory controls.
      systemctl("start", unit);
      const group = groupOf(unit, parent);
      this.#verify(group, bytes);
      return group;
    } catch (error) {
      failedSetup(error, () => manager("StopUnit", "ss", unit, "replace"));
    }
  }
  #verify(group: string, maximum: number) {
    // The kernel rounds byte budgets down to whole pages. Its actual ceiling
    // must remain finite, positive and no greater than the reserved budget.
    const limit = group ? Number(readFileSync(join(CGROUP, group, "memory.max"), "utf8")) : NaN;
    if (!group || !Number.isSafeInteger(limit) || limit < 1 || limit > maximum || readFileSync(join(CGROUP, group, "memory.swap.max"), "utf8").trim() !== "0") {
      throw new Error(`resident cap: kernel did not enforce ${maximum} bytes/swap zero for ${group}`);
    }
  }
  worker(index: string | number, bytes: number) {
    if (this.#closed) throw new Error("resident run is closed");
    const limit = bytes === 0 ? this.budgetBytes : Math.min(integer(bytes, "resident worker budget"), this.budgetBytes);
    const slice = `${this.prefix}-w${index}.slice`;
    if (!/^[a-zA-Z0-9]+$/.test(String(index))) throw new Error("invalid resident worker index");
    const group = this.#slice(slice, limit, this.group);
    const worker = new MemoryWorker(this, slice, group, limit);
    this.#workers.push(worker);
    return worker;
  }
  aggregateOoms() { return events(this.group, true).oom; }
  effectiveBudgetBytes() {
    const bytes = Number(readFileSync(join(CGROUP, this.group, "memory.max"), "utf8"));
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > this.budgetBytes) throw new Error("resident cap: aggregate ceiling changed outside its reservation");
    return bytes;
  }
  close() {
    if (this.#closed) return;
    this.#closed = true;
    let failure: unknown;
    for (const worker of this.#workers) {
      try { worker.close(); } catch (error) { failure ??= error; }
    }
    if (this.group && this.#recordPeak) recordAggregatePeak(this.group, this.budgetBytes);
    try { manager("StopUnit", "ss", this.slice, "replace"); } catch (error) { failure ??= error; }
    if (this.group) {
      const deadline = Date.now() + 3000;
      while (existsSync(join(CGROUP, this.group)) && Date.now() < deadline) pause(10);
      if (existsSync(join(CGROUP, this.group))) failure ??= new Error(`resident run cgroup was not removed: ${this.group}`);
    }
    rmSync(this.directory, { recursive: true, force: true });
    if (failure) throw failure;
  }
}

export class MemoryWorker {
  readonly run: MemoryRun;
  readonly slice: string;
  readonly group: string;
  readonly bytes: number;
  #generation = 0;
  #closed = false;
  #scopes = new Set<MemoryScope>();
  constructor(run: MemoryRun, slice: string, group: string, bytes: number) {
    this.run = run; this.slice = slice; this.group = validGroup(slice, group, run.group); this.bytes = bytes;
  }
  kills() { return events(this.group).kills; }
  counters(): MemoryCounters { return events(this.group); }
  scope(command: string, args: readonly string[]): MemoryScope {
    if (this.#closed) throw new Error("resident worker is closed");
    const unit = `${this.slice.slice(0, -6)}-g${this.#generation++}.scope`;
    const ready = join(this.run.directory, `${unit}.ready`);
    const scope = {
      unit, ready,
      argv: ["--user", "--scope", "--collect", "--quiet", `--unit=${unit}`, `--slice=${this.slice}`, "-p", `MemoryMax=${this.bytes}`, "-p", "MemorySwapMax=0", "-p", "OOMPolicy=continue", "sh", "-c", ENTRY, "nts-resident-worker", ready, this.group, String(this.bytes), command, ...args],
      env: { ...process.env, NTS_CENSUS_WORKER_GROUP: this.group, NTS_CENSUS_WORKER_MAX_BYTES: String(this.bytes), NTS_CENSUS_RUN_GROUP: this.run.group, NTS_CENSUS_RUN_MAX_BYTES: String(this.run.budgetBytes) },
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
    for (const scope of [...this.#scopes]) this.stop(scope);
    manager("StopUnit", "ss", this.slice, "replace");
    const deadline = Date.now() + 3000;
    while (existsSync(join(CGROUP, this.group)) && Date.now() < deadline) pause(10);
    if (existsSync(join(CGROUP, this.group))) throw new Error(`resident worker cgroup was not removed: ${this.group}`);
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

let direct: { run: MemoryRun; workers: Map<number, MemoryWorker> } | undefined;
export function memoryRun(): MemoryRun {
  if (!direct) {
    direct = { run: new MemoryRun(), workers: new Map() };
    process.on("exit", () => direct?.run.close());
    for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
      process.once(signal, () => { direct?.run.close(); process.exit(code); });
    }
  }
  return direct.run;
}

/** Re-enter a serial runner once inside one persistent scope for the whole run. */
export function serialRun(tools): void {
  if (inResidentWorker()) return;
  const run = memoryRun();
  const worker = run.worker("serial", Number(tools.memoryCapKb ?? 6_000_000) * 1024);
  const scope = worker.scope(process.execPath, [...process.execArgv, ...process.argv.slice(1)]);
  let result;
  try {
    result = spawnSync("systemd-run", scope.argv, { stdio: "inherit", env: scope.env });
    if (!worker.ready(scope)) throw new Error("resident cap: serial runner failed before bounded entry");
    const ooms = run.aggregateOoms();
    if (ooms) console.error(`resident aggregate cap fired ${ooms} time(s)`);
  } finally {
    worker.stop(scope);
    run.close();
  }
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

export function compileSync(tools, command: string, args: readonly string[], options) {
  const noAddressLimit = ["-c", 'ulimit -c 0; exec "$0" "$@"', command, ...args];
  if (inResidentWorker()) {
    const boundary = process.env.NTS_CENSUS_WORKER_GROUP!;
    const aggregate = process.env.NTS_CENSUS_RUN_GROUP!;
    const before = events(boundary);
    const aggregateBefore = events(aggregate, true).oom;
    const result = spawnSync("sh", noAddressLimit, options);
    const cause = memoryCause(before, events(boundary), aggregateBefore, events(aggregate, true).oom);
    if (cause === "aggregate-pressure" || cause === "system-pressure") throw new Error(`resident ${cause}: compiler OOM kill is not a case verdict`);
    return { ...result, memoryKilled: cause === "own-limit", residentLimitBytes: Number(process.env.NTS_CENSUS_WORKER_MAX_BYTES), residentRunBytes: Number(process.env.NTS_CENSUS_RUN_MAX_BYTES) };
  }
  // Standalone callers are bounded too. Serial runners and parallel census
  // workers enter a scope once, then compile without a per-case bus round trip.
  memoryRun();
  const bytes = Number(tools.memoryCapKb ?? 6_000_000) * 1024;
  let worker = direct!.workers.get(bytes);
  if (!worker) {
    worker = direct!.run.worker(`direct${direct.workers.size}`, bytes);
    direct!.workers.set(bytes, worker);
  }
  const scope = worker.scope("sh", noAddressLimit);
  const before = worker.counters();
  const aggregateBefore = worker.run.aggregateOoms();
  let result;
  try {
    result = spawnSync("systemd-run", scope.argv, { ...options, env: { ...scope.env, ...options.env } });
    if (!worker.ready(scope)) throw new Error(`resident cap: compiler scope failed before entry: ${result.stderr ?? result.error?.message ?? "no diagnostic"}`);
  } finally {
    worker.stop(scope);
  }
  const cause = memoryCause(before, worker.counters(), aggregateBefore, worker.run.aggregateOoms());
  if (cause === "aggregate-pressure" || cause === "system-pressure") throw new Error(`resident ${cause}: compiler OOM kill is not a case verdict`);
  return { ...result, memoryKilled: cause === "own-limit", residentLimitBytes: worker.bytes, residentRunBytes: worker.run.budgetBytes };
}
