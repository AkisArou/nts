// CPUs 4 and 5 are the two threads of the physical P-core reserved for
// measurement. Restrict a gate's inherited set; never broaden an E-core job.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MEASUREMENT_CPUS = [4, 5];

export function cpuList(list: string): number[] {
  const result = new Set<number>();
  for (const part of list.trim().split(",")) {
    if (!/^\d+(?:-\d+)?$/.test(part)) throw new Error(`invalid CPU list: ${list}`);
    const [first, last = first] = part.split("-").map(Number);
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
    while (sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(first === sorted[i] ? String(first) : `${first}-${sorted[i]}`);
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

export function gateCommand(command: string, args: string[]): { command: string; args: string[]; cpus: string | null } {
  if (process.platform !== "linux") return { command, args, cpus: null };
  const cpus = gateCpus(inheritedCpus());
  return { command: "taskset", args: ["-c", cpus, command, ...args], cpus };
}

// pinned.sh changes its own mask before starting any build, so every child
// inherits the reservation, including a hand-started full run.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "--gate-cpus") {
    if (process.platform === "linux") console.log(gateCpus(inheritedCpus(Number(process.argv[3]))));
  } else if (process.argv[2] === "--default-cpus") {
    const preferred = process.argv[3];
    console.log(process.platform === "linux" ? defaultCpus(preferred, inheritedCpus(Number(process.argv[4]))) : preferred);
  } else {
    throw new Error("usage: affinity.ts --gate-cpus <pid> | --default-cpus <preferred> <pid>");
  }
}
