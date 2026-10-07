// The CPU time a child process spends itself, sampled from /proc while it
// runs: `utime + stime` of the process (every thread of it), not of the
// children it starts -- the frontend (tsgo) is one, and how much of its work a
// snapshot saves differs between runs; the lowering is what this measures.
//
// Sampled rather than taken from a wrapper such as /usr/bin/time, which would
// stand between the caller and the process: a signal would arrive as an exit
// status and a timeout's SIGTERM would kill the wrapper and leave the compiler
// running. The last sample is at most one interval before the process ends,
// so a measurement is short by at most that much per busy thread.
import { readFileSync, rmSync } from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let TICK = 100;
try { TICK = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim()) || 100; } catch {}
export const SAMPLE_MS = 200;

/** Seconds of CPU `pid` has used so far, or null when /proc cannot say. */
export function cpuOf(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    // After the name: state(0) ... utime is field 14 overall, index 11 here.
    return (Number(f[11]) + Number(f[12])) / TICK;
  } catch {
    return null;
  }
}

/**
 * Follow `child` (a ChildProcess) until it exits; resolves to its CPU seconds,
 * or null if not one sample could be read (no /proc).
 */
export function followCpu(child) {
  let seen = null;
  const sample = () => {
    const c = cpuOf(child.pid);
    if (c !== null) seen = Math.max(seen ?? 0, c);
  };
  sample();
  const timer = setInterval(sample, SAMPLE_MS);
  return new Promise((resolve) => {
    child.on("exit", () => { clearInterval(timer); resolve(seen); });
    child.on("error", () => { clearInterval(timer); resolve(seen); });
  });
}

// ---------------------------------------------------------------------------
// Instructions retired in user space, counted by `perf stat -p` attached to
// the running process: the measure compile-time.mjs judges by.
//
// **Why not CPU seconds**: this box's cores are of two kinds (cpu_core and
// cpu_atom), and a process the scheduler leaves on the slow kind uses about
// twice the CPU time for the same work. Under a gate's load one module's
// lowering read 2.2x its recorded CPU time with nothing changed (2026-10-07),
// which a 2x tripwire cannot live with. Its instruction count across three
// runs, on whatever cores they landed: 275.0, 275.5 and 274.5 G.
//
// Attached, not wrapped, for the reason above: the caller keeps its own
// process, signals and timeout. perf exits when the process does. A process
// that ends before perf has attached (well under a second of work) reads as
// null, which the caller tells apart from a perf that cannot count at all by
// `instructionsWork()`.
// ---------------------------------------------------------------------------

/** Sum of each core kind's raw count (perf scales by the share of time the counter ran). */
export function parsePerf(text) {
  let total = 0;
  let seen = false;
  for (const line of text.split("\n")) {
    const f = line.split(",");
    if (f.length < 5 || !/instructions/.test(f[2] ?? "")) continue;
    seen = true;
    const value = Number(f[0]);
    const pct = Number(f[4]);
    if (!Number.isFinite(value)) continue; // <not counted>: never ran on that kind
    total += Number.isFinite(pct) && pct > 0 ? (value * pct) / 100 : value;
  }
  return seen ? total : null;
}

let probed;
/** Whether `perf stat -p` can count a process of ours here; the reason when not. */
export function instructionsWork() {
  if (probed !== undefined) return probed;
  const r = spawnSync("sh", ["-c", 'sleep 0.5 & p=$!; perf stat -x, -e instructions:u -p "$p" 2>&1 >/dev/null; wait'], { encoding: "utf8" });
  probed = r.error ? `no perf (${r.error.message})` : parsePerf(r.stdout + r.stderr) === null ? `perf stat -p counted nothing: ${(r.stdout + r.stderr).trim().split("\n").pop()}` : null;
  return probed;
}

/** Follow `child` until it exits; resolves to its user-space instructions, or null. */
export function followInstructions(child) {
  const out = join(tmpdir(), `nts-instructions-${process.pid}-${child.pid}.txt`);
  const perf = spawn("perf", ["stat", "-x,", "-e", "instructions:u", "-p", String(child.pid), "-o", out], { stdio: "ignore" });
  let stopper;
  child.on("exit", () => { stopper = setTimeout(() => perf.kill("SIGINT"), 5000); });
  return new Promise((resolve) => {
    const end = () => {
      clearTimeout(stopper);
      let text = "";
      try { text = readFileSync(out, "utf8"); } catch {}
      rmSync(out, { force: true });
      resolve(parsePerf(text));
    };
    perf.on("error", end);
    perf.on("close", end);
  });
}
