import { FIXED_AMBIENT } from "./canonical-environment.ts";
// The CPU time a child process spends itself, sampled from /proc while it
// runs: `utime + stime` of the process (every thread of it), not of the
// children it starts. The native frontend runs in this process, so its CPU
// time is included; external compiler/linker processes are not.
//
// Sampled rather than taken from a wrapper such as /usr/bin/time, which would
// stand between the caller and the process: a signal would arrive as an exit
// status and a timeout's SIGTERM would kill the wrapper and leave the compiler
// running. The last sample is at most one interval before the process ends,
// so a measurement is short by at most that much per busy thread.
import { readFileSync, mkdirSync } from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { COUNTER_SCOPE, counterProblem } from "./compile-counter.ts";

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

// Count from exec: inheritance includes every compiler thread, including threads
// created after launch, and forked descendants. The measured hir commands have
// no descendants (no adjacent nts.config.ts, GIR imports, toolchain or oracle).
// A different command must inventory its children before using this scope.
// Raw hybrid-PMU counts are summed: scaled counts double-count migration.
export const PERF_ARGS = ["stat", "--no-scale", "--no-big-num", "-e", "instructions:u"];
export { COUNTER_SCOPE, counterProblem } from "./compile-counter.ts";

/** Read raw counts from current human output or retained historical CSV. */
export function parsePerf(text) {
  let total = 0;
  let seen = false;
  for (const line of text.split("\n")) {
    const csv = line.split(",");
    const human = /^\s*(\d+|<not counted>)\s+(?:cpu_(?:core|atom)\/instructions\/u|instructions:u)(?:\s|$)/.exec(line);
    const value = csv.length >= 3 && /instructions/.test(csv[2]) ? csv[0].trim() : human?.[1];
    if (value === "<not counted>") { seen = true; continue; }
    if (value === undefined || value === "" || !Number.isFinite(Number(value))) continue;
    seen = true;
    total += Number(value);
  }
  return seen ? total : null;
}

/** perf's waited-command rusage, not PMU enabled/running time or a /proc sample. */
export function parseMeasurement(text) {
  const seconds = (kind) => {
    const match = new RegExp(`^\\s*([0-9]+(?:\\.[0-9]+)?) seconds ${kind}\\s*$`, "m").exec(text);
    const csv = new RegExp(`^\\s*([0-9]+(?:\\.[0-9]+)?),seconds ${kind}(?:,.*)?$`, "m").exec(text);
    return match ? Number(match[1]) : csv ? Number(csv[1]) : null;
  };
  const user_s = seconds("user");
  const sys_s = seconds("sys");
  return { counter_scope: COUNTER_SCOPE, instructions: parsePerf(text), user_s, sys_s,
    cpu_s: user_s === null || sys_s === null ? null : user_s + sys_s };
}

const EXTRA_EVENTS = ["cycles", "branches", "branch-misses", "cache-references", "cache-misses"];

/** Additional counters use explicit user-only events on one pinned CPU.
 * An inactive hybrid PMU is not a zero measurement of an active event. */
export function parseUserEvents(text, events) {
  const lines = text.split("\n").flatMap(line => {
    const c = line.split(",").map(x => x.trim());
    if (c.length >= 5) return [{value:c[0],event:c[2],runtime:c[3],percent:c[4],format:"csv"}];
    const m = /^\s*(\d+|<not counted>|<not supported>)\s+((?:cpu_(?:core|atom)\/[^\s]+\/u)|(?:[\w-]+:u))(?:\s+(.*))?$/.exec(line);
    if (!m) return [];
    const percent = /\((\d+(?:\.\d+)?)%\)\s*$/.exec(m[3] ?? "");
    const annotations = (m[3]?.match(/\([^)]*%/g) ?? []).length;
    if ((annotations && !percent) || annotations > 1) throw Error("malformed counter running percentage");
    // perf's human format omits the percentage when the event ran fully.
    return [{value:m[1],event:m[2],runtime:null,percent:percent?.[1] ?? "100",format:"human"}];
  });
  const result = {};
  for (const event of events) {
    const rows = lines.filter(c => c.event === `${event}:u` || c.event === `cpu_core/${event}/u` || c.event === `cpu_atom/${event}/u`);
    if (!rows.length || new Set(rows.map(c => c.event)).size !== rows.length) throw Error(`missing or duplicate event: ${event}`);
    const active = [], inactive = [];
    for (const c of rows) {
      if (c.value === "<not counted>" && /^cpu_(core|atom)\//.test(c.event)
        && /^0(?:\.0+)?$/.test(c.percent) && (c.format === "human" || /^0(?:\.0+)?$/.test(c.runtime))) {
        inactive.push(c.event); continue;
      }
      if (!/^\d+$/.test(c.value) || !Number.isSafeInteger(Number(c.value))
        || (c.format === "csv" && (!/^\d+(?:\.\d+)?$/.test(c.runtime) || Number(c.runtime) <= 0))
        || !/^\d+(?:\.\d+)?$/.test(c.percent) || Number(c.percent) < 99 || Number(c.percent) > 100)
        throw Error(`invalid, unsupported or multiplexed event: ${event}`);
      active.push({pmu:c.event,value:Number(c.value),running_percent:Number(c.percent),format:c.format});
    }
    if (active.length !== 1) throw Error(`event must run on one pinned PMU: ${event}`);
    if ((event === "instructions" || event === "cycles") && active[0].value <= 0) throw Error(`nonpositive event: ${event}`);
    result[event] = {...active[0], inactive};
  }
  return result;
}

export function countedLaunch(command, args, {timeoutMs = 900_000, events = [], cpu} = {}) {
  if (!Array.isArray(events) || new Set(events).size !== events.length || events.some(e => !EXTRA_EVENTS.includes(e))) throw Error("invalid extra counter events");
  if (cpu !== undefined && (!Number.isSafeInteger(cpu) || cpu < 0 || cpu > 1023)) throw Error("invalid pinned CPU");
  if (events.length && cpu === undefined) throw Error("extra counters require an explicit pinned CPU");
  // CSV mode suppresses perf's waited-command user/sys footer. Retain the
  // human format so extra events share the default counter's exact CPU scope.
  const perf = events.length ? ["stat", "--no-scale", "--no-big-num", "-e", ["instructions", ...events].map(e => e + ":u").join(",")] : PERF_ARGS;
  const argv = ["timeout", "--signal=TERM", "--kill-after=5s", `${timeoutMs / 1000}s`, "perf", ...perf];
  return {command: cpu === undefined ? argv.shift() : "taskset", args: cpu === undefined ? argv : ["-c", String(cpu), ...argv],
    target: [command,...args], events: events.length ? ["instructions",...events] : []};
}

let probed;
/** A bounded launch probe; attachment to an already-running process is forbidden. */
export function instructionsWork() {
  if (probed !== undefined) return probed;
  const r = spawnSync("perf", [...PERF_ARGS, "--", "sh", "-c", "i=0; while [ $i -lt 10000 ]; do i=$((i+1)); done"],
    { encoding: "utf8", env: { ...process.env, ...FIXED_AMBIENT }, timeout: 120_000 });
  const measurement = parseMeasurement(r.stderr ?? "");
  probed = r.error ? `no perf (${r.error.message})` : r.status !== 0 ? `perf exited ${r.status}: ${r.stderr.trim()}` : counterProblem(measurement);
  return probed;
}

/**
 * Launch under perf before exec can create a thread. GNU timeout owns its child
 * process group and forwards termination to the whole run; killing a wrapper
 * alone would leave the compiler running. Its deadline is only a hang guard:
 * every nonzero status (including timeout's 124/137) invalidates the count.
 * The raw file belongs to the caller's run and is never deleted here.
 */
export function spawnCounted(command, args, { counterFile, timeoutMs = 900_000, events = [], cpu, ...options }) {
  if (!counterFile) throw new Error("a retained counterFile is required");
  mkdirSync(dirname(counterFile), { recursive: true });
  const launch = countedLaunch(command,args,{timeoutMs,events,cpu});
  const child = spawn(launch.command, [...launch.args, "-o", counterFile, "--", ...launch.target],
    { ...options, env: { ...(options.env ?? process.env), ...FIXED_AMBIENT } });
  const measurement = new Promise((resolve) => {
    let launchError;
    child.on("error", (error) => { launchError = error.message; });
    child.on("close", (status, signal) => {
      let raw = "";
      try { raw = readFileSync(counterFile, "utf8"); } catch {}
      const row = { ...parseMeasurement(raw), counter_file: counterFile, status, signal };
      let metricError;
      if (launch.events.length) {
        try { row.metrics = parseUserEvents(raw,launch.events); row.counter_cpu = cpu; }
        catch (error) { metricError = error.message; }
      }
      row.counter_error = launchError ?? metricError ?? (signal ? `counter run ended by ${signal}` : status !== 0 ? `counter run exited ${status}` : counterProblem(row));
      resolve(row);
    });
  });
  return { child, measurement };
}
