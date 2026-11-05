import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface LaunchProcess {
  pid: number;
  commandLine: string;
  type: string;
  status: Record<string, string>;
  cgroup: string;
  tids: string[];
}

// Only records obtained from this launch's scope reach this policy. Keep
// the renderer/zygote birth mask; move its other processes off measurement
// CPUs and prove every surviving thread's mask before measuring.
export async function pinLaunchProcesses(members: LaunchProcess[], cpu: number): Promise<{ rendererPid: number; affinities: string[] }> {
  assert(Number.isSafeInteger(cpu) && cpu >= 0);
  assert(members.every(record => Number.isSafeInteger(record.pid) && record.pid > 1), "never pin PID 1");
  const renderers = members.filter(record => record.type === "renderer");
  assert.equal(renderers.length, 1, "Require one measured renderer");
  const affinities: string[] = [];
  for (const { pid, type, tids, status } of members) {
    affinities.push(`process type=${type} pid=${pid} ppid=${status.PPid} nspid=${status.NSpid}`);
    if (type !== "zygote" && type !== "renderer")
      for (const tid of tids) { try { execFileSync("taskset", ["-pc", "0-3,6-31", tid], { stdio: "pipe" }); } catch { /* exited thread */ } }
    for (const tid of tids) {
      const text = await readFile(`/proc/${pid}/task/${tid}/status`, "utf8").catch(error => { if (disappeared(error)) return ""; throw error; });
      if (!text) continue;
      const allowed = text.match(/^Cpus_allowed_list:\s+(.+)$/m)?.[1];
      affinities.push(`affinity process=${type} pid=${pid} tid=${tid} comm=${text.match(/^Name:\s+(.+)$/m)?.[1] ?? "?"} allowed=${allowed ?? "?"}`);
      assert.equal(allowed, type === "zygote" || type === "renderer" ? String(cpu) : "0-3,6-31", `Unexpected affinity for ${type} thread ${tid}`);
    }
  }
  return { rendererPid: renderers[0].pid, affinities };
}

// Chromium rewrites argv into one process-title string on Linux. Normalize
// both that form and ordinary NUL-separated argv before reading its type.
export function processType(cmdline: string, executable: string): string {
  const command = cmdline.replaceAll("\0", " ").trim();
  if (command !== executable && !command.startsWith(`${executable} `)) return "launcher";
  return command.match(/(?:^|\s)--type=([^\s]+)/)?.[1] ?? "browser";
}

function disappeared(error: unknown): boolean {
  return error instanceof Error && "code" in error && ["ENOENT", "ESRCH"].includes(String(error.code));
}

// The caller supplies the cgroup of the transient scope it created for this
// launch. Membership survives reparenting; no global /proc scan or ancestry
// inference can admit another browser running the same executable.
export async function scopeProcesses(group: string, executable: string, proc = "/proc", cgroupRoot = "/sys/fs/cgroup"): Promise<LaunchProcess[]> {
  assert(group.startsWith("/") && !group.split("/").includes(".."), `Invalid launch cgroup: ${group}`);
  const members = (await readFile(join(cgroupRoot, group, "cgroup.procs"), "utf8")).trim().split(/\s+/).filter(Boolean);
  const pids = [...new Set(members.map(value => {
    const pid = Number(value);
    assert(/^\d+$/.test(value) && Number.isSafeInteger(pid) && pid > 1, `Invalid launch PID ${value}; never admit PID 1`);
    return pid;
  }))];
  const result: LaunchProcess[] = [];
  for (const pid of pids) {
    try {
      const command = await readFile(join(proc, String(pid), "cmdline"), "utf8");
      if (!command) continue;
      const cgroup = (await readFile(join(proc, String(pid), "cgroup"), "utf8")).match(/^0::(.+)$/m)?.[1];
      assert.equal(cgroup, group, `Launch process ${pid} moved out of ${group}: ${cgroup ?? "no unified cgroup"}`);
      const status = Object.fromEntries((await readFile(join(proc, String(pid), "status"), "utf8")).trim().split("\n").map(line => {
        const colon = line.indexOf(":");
        return [line.slice(0, colon), line.slice(colon + 1).trim()];
      }));
      const tids = (await readdir(join(proc, String(pid), "task"))).filter(name => /^\d+$/.test(name));
      result.push({ pid, commandLine: command.replaceAll("\0", " ").trim(), type: processType(command, executable), status, cgroup, tids });
    } catch (error) { if (!disappeared(error)) throw error; }
  }
  return result;
}
