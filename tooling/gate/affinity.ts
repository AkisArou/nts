import {toolingSliceArgs} from "./tooling-slice.ts";
// CPUs 4 and 5 are the two threads of the physical P-core reserved for
// measurement. Restrict a gate's inherited set; never broaden an E-core job.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const MEASUREMENT_CPUS = [4, 5];

export function cpuList(list: string): number[] {
  const result = new Set<number>();
  for (const part of list.trim().split(",")) {
    if (!/^\d+(?:-\d+)?$/.test(part)) throw new Error(`invalid CPU list: ${list}`);
    const [lower, upper] = part.split("-");
    if (lower === undefined) throw new Error(`invalid CPU range: ${part}`);
    const first = Number(lower), last = Number(upper ?? lower);
    if (last < first || last > 1048575) throw new Error(`invalid CPU range: ${part}`);
    for (let cpu = first; cpu <= last; cpu++) result.add(cpu);
  }
  return [...result].sort((a, b) => a - b);
}

export function formatCpus(cpus: number[]): string {
  const parts: string[] = [];
  const sorted = [...new Set(cpus)].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    const first = sorted[i];
    if (first === undefined) throw new Error("missing CPU in sorted affinity list");
    let last = first;
    while (sorted[i + 1] === last + 1) { i++; last++; }
    parts.push(first === last ? String(first) : `${first}-${last}`);
  }
  return parts.join(",");
}

export function gateCpus(inherited: string): string {
  const cpus = cpuList(inherited).filter((cpu) => !MEASUREMENT_CPUS.includes(cpu));
  if (cpus.length === 0) throw new Error("gate has no CPUs outside the reserved measurement core (4-5)");
  return formatCpus(cpus);
}

/** A tool's preferred default cannot escape the caller's restriction. */
export function defaultCpus(preferred: string, inherited: string): string {
  const allowed = new Set(cpuList(inherited));
  const cpus = cpuList(preferred).filter((cpu) => allowed.has(cpu));
  if (cpus.length === 0) throw new Error(`default CPUs ${preferred} have no intersection with inherited CPUs ${inherited}`);
  return formatCpus(cpus);
}

export function inheritedCpus(pid: number = process.pid): string {
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  const list = /^Cpus_allowed_list:\s*(.+)$/m.exec(status)?.[1];
  if (!list) throw new Error(`no allowed CPU list for process ${pid}`);
  return list.trim();
}

export function cpuSubset(actual: string, ceiling: string): boolean {
  const allowed = new Set(cpuList(ceiling));
  return cpuList(actual).every((cpu) => allowed.has(cpu));
}

function cgroupPath(pid: number): string {
  const path = /^0::(.*)$/m.exec(readFileSync(`/proc/${pid}/cgroup`, "utf8"))?.[1];
  if (!path?.startsWith("/")) throw new Error("no unified cgroup path");
  return path;
}

export function effectiveCeiling(pid: number = process.pid): string | undefined {
  let directory = "/sys/fs/cgroup" + cgroupPath(pid);
  // The controller may be enabled only at an ancestor. Its ceiling still
  // bounds this process; a sched_setaffinity mask does not.
  while (directory.startsWith("/sys/fs/cgroup")) {
    try {
      const cpus = readFileSync(directory + "/cpuset.cpus.effective", "utf8").trim();
      if (cpus) return cpus;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    directory = dirname(directory);
  }
  return undefined;
}

export function verifyCeiling(expected: string, pid: number = process.pid): boolean {
  const actual = effectiveCeiling(pid);
  return actual !== undefined && cpuSubset(actual, expected);
}

function cpusetDelegated(pid: number): boolean {
  const manager = /^(.*\/user@\d+\.service)(?:\/|$)/.exec(cgroupPath(pid))?.[1];
  if (!manager) return false;
  return readFileSync(`/sys/fs/cgroup${manager}/cgroup.controllers`, "utf8").trim().split(/\s+/).includes("cpuset");
}

function scopeArgs(cpus: string): string[] {
  return ["--user", "--scope", ...toolingSliceArgs(), "--quiet", "--collect", "--no-ask-password", "--expand-environment=no", `--property=AllowedCPUs=${cpus}`, "--"];
}

type Scope = { kind: "scope" | "inherited-cpuset" | "best-effort"; reason: string };

/** Selection happens before work starts. A failed gate is never a probe. */
export function selectScope(cpus: string, ceiling: string | undefined, delegated: boolean, probe: () => { ok: boolean; reason: string }): Scope {
  if (ceiling && cpuSubset(ceiling, cpus)) return { kind: "inherited-cpuset", reason: `effective cpuset ${ceiling}` };
  if (!delegated) return { kind: "best-effort", reason: "cpuset is not delegated to this user manager" };
  const checked = probe();
  return { kind: checked.ok ? "scope" : "best-effort", reason: checked.reason };
}

export function gateScope(cpus: string, pid: number = process.pid): Scope {
  try {
    return selectScope(cpus, effectiveCeiling(pid), cpusetDelegated(pid), () => {
      const online = readFileSync("/sys/devices/system/cpu/online", "utf8").trim();
      // Deliberately widen inside the proposed scope. Only a kernel ceiling
      // can keep this grandchild inside cpus. It runs no gate work.
      const probe = spawnSync("systemd-run", [...scopeArgs(cpus), "taskset", "-c", online, process.execPath, "-e",
        'process.stdout.write(require("node:fs").readFileSync("/proc/self/status","utf8").match(/^Cpus_allowed_list:\\s*(.+)$/m)[1])'],
        { encoding: "utf8", timeout: 10000 });
      const mask = probe.stdout?.trim();
      const ok = probe.status === 0 && !!mask && cpuSubset(mask, cpus);
      const reason = ok ? `widening probe bounded to ${mask}` : `scope probe failed (${probe.error?.message ?? probe.signal ?? probe.status}): ${probe.stderr?.trim() || `allowed ${mask || "unknown"}`}`;
      return { ok, reason: reason.replace(/\s+/g, " ").slice(0, 400) };
    });
  } catch (error) {
    return { kind: "best-effort", reason: `cannot establish cpuset ceiling: ${error instanceof Error ? error.message : error}` };
  }
}

export function gateCommand(command: string, args: string[]): { command: string; args: string[]; cpus: string | null; mechanism: string } {
  if (process.platform !== "linux") return { command, args, cpus: null, mechanism: "host affinity (not Linux)" };
  const cpus = gateCpus(inheritedCpus());
  const scope = gateScope(cpus);
  const pinned = ["-c", cpus, command, ...args];
  return scope.kind === "scope"
    ? { command: "systemd-run", args: [...scopeArgs(cpus), "taskset", ...pinned], cpus, mechanism: `cpuset scope; ${scope.reason}` }
    : { command: "taskset", args: pinned, cpus, mechanism: `${scope.kind}; ${scope.reason}` };
}

// pinned.sh changes its own mask before starting any build, so every child
// inherits the reservation, including a hand-started full run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argument = (index: number): string => {
    const value = process.argv[index];
    if (value === undefined || value === "") throw new Error(`affinity: missing argument ${index - 2}`);
    return value;
  };
  if (process.argv[2] === "--gate-cpus") {
    if (process.platform === "linux") console.log(gateCpus(inheritedCpus(Number(argument(3)))));
  } else if (process.argv[2] === "--default-cpus") {
    const preferred = argument(3);
    console.log(process.platform === "linux" ? defaultCpus(preferred, inheritedCpus(Number(argument(4)))) : preferred);
  } else if (process.argv[2] === "--scope-mechanism") {
    const scope = gateScope(argument(3), Number(argument(4)));
    console.log(`${scope.kind}:${scope.reason}`);
  } else if (process.argv[2] === "--verify-ceiling") {
    if (!verifyCeiling(argument(3), Number(argument(4)))) {
      console.error("gate: requested cpuset ceiling is absent on scope entry");
      process.exitCode = 75;
    }
  } else if (process.argv[2] === "--launch-scope") {
    const cpus = argument(3);
    cpuList(cpus);
    // A train can hold pinned.sh's tree lock across setup and execution.
    // Preserve that open description when entering the cpuset scope.
    const child = spawnSync("systemd-run", [...scopeArgs(cpus), "taskset", "-c", cpus, ...process.argv.slice(4)], {
      stdio: process.env.NTS_GATE_LOCK_FD === "8" ? ["inherit","inherit","inherit",null,null,null,null,null,8] : "inherit",
    });
    // This is the actual command, not a capability probe. Never retry it.
    if (child.error) console.error(`gate: scope launch failed: ${child.error.message}`);
    process.exitCode = child.status ?? 1;
  } else {
    throw new Error("usage: affinity.ts --gate-cpus <pid> | --default-cpus <preferred> <pid> | --scope-mechanism <cpus> <pid> | --verify-ceiling <cpus> <pid> | --launch-scope <cpus> <command...>");
  }
}
