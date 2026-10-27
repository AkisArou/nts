// Observations only: none of these values participates in admission or verdicts.
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Observation = {
  event: string; epoch: number; step?: string; request?: number; pid?: number; context?: string;
  memory_allowed?: boolean | null; used?: { slots: number; fe: number };
  slots?: number; frontends?: number; withhold?: number; compiler_sha?: string;
  [key: string]: unknown;
};
type Phase = { phase: string; wall_s: number; self_cpu_s: number | null; child_cpu_s: number | null };
export type Check = { project: string; binary_sha: string; pid: number; step: string; start: number; end: number;
  wall_s: number; cpu_resolution_s: number | null; self_peak_rss_kb: number | null;
  child_peak_rss_kb: number | null; phases: Phase[]; complete: boolean };
export type TimedStep = { name: string; started_at?: string; wall?: number; mem_gb?: number };
let aggregateCounter = 0;

export function recordAggregatePeak(group: string, scopeBudgetBytes: number, env: NodeJS.ProcessEnv = process.env): void {
  if (!env.NTS_GATE_CASE_COSTS_DIR || !env.NTS_GATE_STEP) return;
  let peak: number | null = null;
  try {
    const text = readFileSync(join("/sys/fs/cgroup", group, "memory.peak"), "utf8").trim();
    if (/^\d+$/.test(text)) peak = peakRss(Number(text));
  } catch { /* Unsupported or unreadable observations remain unknown. */ }
  try {
    appendFileSync(join(env.NTS_GATE_CASE_COSTS_DIR, `aggregate-${process.pid}-${aggregateCounter++}.jsonl`), JSON.stringify({
      event: "aggregate.peak", epoch: Date.now() / 1000, pid: process.pid, step: env.NTS_GATE_STEP,
      cgroup: group, scope_budget_bytes: scopeBudgetBytes, peak_bytes: peak,
    }) + "\n");
  } catch { /* Telemetry cannot change a worker's result or cleanup. */ }
}
const CHECK_STEPS = new Set(["examples", "llvm", "jvm", "wasm", "rc", "llvm-rc"]);
const GROUPS: Record<string, string[]> = {
  capture:["capture"], lowering:["lower"], preparation:["prepare"],
  emission:["c.emit","llvm.emit","jvm.emit","wasm.emit"],
  toolchain:["llvm.assemble","native.runtime_objects","native.link","jvm.toolchain"],
  program:["program.total"], oracle:["oracle.total"],
};
function grouped(c: Check): Phase[] {
  const groups = Object.entries(GROUPS).map(([phase,names]) => {
    const rows=c.phases.filter(p=>names.includes(p.phase));
    const cpuSum=(field: "self_cpu_s" | "child_cpu_s") => rows.some(p=>p[field]===null)
      ? null : rows.reduce((n,p)=>n+(p[field]??0),0);
    return {phase,wall_s:rows.reduce((n,p)=>n+p.wall_s,0),self_cpu_s:cpuSum("self_cpu_s"),child_cpu_s:cpuSum("child_cpu_s")};
  });
  const total=c.phases.find(p=>p.phase==="check.total");
  const residual=(field: "wall_s" | "self_cpu_s" | "child_cpu_s") => {
    const t=total?.[field];
    if (t===undefined || t===null || groups.some(p=>p[field]===null)) return null;
    const result=t-groups.reduce((n,p)=>n+(p[field]??0),0);
    return Math.abs(result)<1e-9 ? 0 : result;
  };
  groups.push({phase:"drivers_and_other",wall_s:residual("wall_s")??0,
    self_cpu_s:residual("self_cpu_s"),child_cpu_s:residual("child_cpu_s")});
  return groups;
}
function phaseDistributions(completed: Check[], pick: (c: Check)=>Phase[]) {
  const result: Record<string,unknown>={};
  for (const name of new Set(completed.flatMap(c=>pick(c).map(p=>p.phase)))) {
    const rows=completed.flatMap(c=>{
      const parts=pick(c).filter(p=>p.phase===name);
      if (!parts.length) return [];
      const sum=(field: "self_cpu_s" | "child_cpu_s")=>parts.some(p=>p[field]===null)?null:parts.reduce((n,p)=>n+(p[field]??0),0);
      return [{wall_s:parts.reduce((n,p)=>n+p.wall_s,0),self_cpu_s:sum("self_cpu_s"),child_cpu_s:sum("child_cpu_s")}];
    });
    result[name]={wall_s:distribution(rows.map(p=>p.wall_s)),
      self_cpu_s:distribution(rows.flatMap(p=>p.self_cpu_s===null?[]:[p.self_cpu_s])),
      child_cpu_s:distribution(rows.flatMap(p=>p.child_cpu_s===null?[]:[p.child_cpu_s]))};
  }
  return result;
}

type Request = { id: number; step: string; project: string; binary_sha: string; at?: number; grant?: number; release?: number };

export function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (fraction: number) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
  return { n: sorted.length, sum: sorted.reduce((a, b) => a + b, 0), p50: q(.5), p95: q(.95), p99: q(.99), max: q(1) };
}

export function waitCause(state: Partial<Observation>) {
  if (state.memory_allowed === false) return "memory_admission";
  if ((state.used?.fe ?? 0) >= (state.frontends ?? Infinity)) return "frontend_cap";
  if ((state.used?.slots ?? 0) >= (state.slots ?? Infinity)) return "slot_tokens";
  if ((state.used?.slots ?? 0) + (state.withhold ?? 0) >= (state.slots ?? Infinity)) return "reserved_slots";
  return "priority_or_dispatch";
}

function context(text: string, binary: string) {
  try {
    if (text.startsWith("json64:")) {
      const value = JSON.parse(Buffer.from(text.slice(7), "base64url").toString());
      return { project: String(value.project ?? ""), binary_sha: String(value.binary ?? binary) };
    }
    if (text.startsWith("path:")) return { project: decodeURIComponent(text.slice(5)), binary_sha: binary };
  } catch { return { project: "", binary_sha: binary }; }
  return { project: text, binary_sha: binary };
}

function projectKey(path: string) {
  return /(?:^|\/)tests\/programs\/[^/]+\/tsconfig\.json$/.exec(path)?.[0].replace(/^\//, "") ?? path;
}
function key(record: { project: string; binary_sha: string }) { return JSON.stringify([projectKey(record.project), record.binary_sha]); }

function requests(events: Observation[]): Request[] {
  const all = new Map<number, Request>();
  for (const e of events) {
    if (e.request === undefined || !e.step) continue;
    let r = all.get(e.request);
    if (!r) { r = { id: e.request, step: e.step, ...context(e.context ?? "", e.compiler_sha ?? "") }; all.set(e.request, r); }
    if (e.event === "token.request") r.at = e.epoch;
    if (e.event === "token.grant") r.grant = e.epoch;
    if (e.event === "token.release" || e.event === "token.cancel") r.release = e.epoch;
  }
  return [...all.values()];
}

/** Disjoint step wall, plus separate overlapping worker wait-seconds. */
export function waitingBreakdown(events: Observation[], step: TimedStep, unpooled: Check[] = []) {
  const start = Date.parse(step.started_at ?? "") / 1000;
  if (!Number.isFinite(start) || step.wall === undefined) return null;
  const end = start + step.wall;
  const timeline = [...events];
  for (const c of unpooled) {
    timeline.push({ event: "unpooled.begin", epoch: c.start, step: c.step, pid: c.pid });
    timeline.push({ event: "unpooled.end", epoch: c.end, step: c.step, pid: c.pid });
  }
  timeline.push({ event: "finish", epoch: end });
  timeline.sort((a, b) => a.epoch - b.epoch);
  const active = new Set<number>(), waiting = new Set<number>(), outside = new Set<number>();
  const wall: Record<string, number> = {}, workers: Record<string, number> = {};
  let cursor = start, state: Partial<Observation> = {};
  for (const e of timeline) {
    const at = Math.min(end, Math.max(start, e.epoch));
    const dt = Math.max(0, at - cursor);
    const cause = waitCause(state);
    const bucket = active.size ? "admitted_case" : outside.size ? "unpooled_check" : waiting.size ? cause : "script_or_dispatch";
    wall[bucket] = (wall[bucket] ?? 0) + dt;
    workers[cause] = (workers[cause] ?? 0) + dt * waiting.size;
    cursor = at;
    if (e.step === step.name) {
      if (e.request !== undefined) {
        if (e.event === "token.request") waiting.add(e.request);
        if (e.event === "token.grant") { waiting.delete(e.request); active.add(e.request); }
        if (e.event === "token.release" || e.event === "token.cancel") { active.delete(e.request); waiting.delete(e.request); }
      }
      if (e.event === "unpooled.begin" && e.pid !== undefined) outside.add(e.pid);
      if (e.event === "unpooled.end" && e.pid !== undefined) outside.delete(e.pid);
    }
    if (e.used) state = e;
    if (e.epoch >= end) break;
  }
  return { wall_s: wall, worker_wait_s: workers };
}

function cpu(row: Record<string, unknown>, a: string, b: string) {
  return typeof row[a] === "number" && typeof row[b] === "number" ? (row[a] as number) + (row[b] as number) : null;
}

function peakRss(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readChecks(root: string, errors: string[]) {
  const checks: Check[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !/^check-\d+-\d+\.jsonl$/.test(entry.name)) continue;
    try {
      const rows: Record<string, unknown>[] = [];
      for (const line of readFileSync(join(root, entry.name), "utf8").split("\n").filter(Boolean)) {
        try { rows.push(JSON.parse(line)); } catch { errors.push(`partial JSON: ${entry.name}`); }
      }
      const first = rows.find(r => r.event === "case");
      const begin = rows.find(r => r.event === "begin" && r.phase === "check.total");
      const ends = rows.filter(r => r.event === "end");
      const last = ends.find(r => r.phase === "check.total");
      if (!first || !begin || typeof begin.epoch !== "number") { errors.push(`no case start: ${entry.name}`); continue; }
      const phases = ends.filter(r => typeof r.phase === "string" && typeof r.wall_s === "number").map(r => ({
        phase: r.phase as string, wall_s: r.wall_s as number,
        self_cpu_s: cpu(r, "self_user_s", "self_sys_s"), child_cpu_s: cpu(r, "child_user_s", "child_sys_s"),
      }));
      checks.push({ project: String(first.project), binary_sha: String(first.binary_sha ?? ""), pid: Number(first.pid), step: String(first.step),
        start: begin.epoch, end: typeof last?.epoch === "number" ? last.epoch : begin.epoch,
        wall_s: typeof last?.wall_s === "number" ? last.wall_s : 0,
        cpu_resolution_s: typeof first.cpu_resolution_s === "number" ? first.cpu_resolution_s : null,
        self_peak_rss_kb: peakRss(last?.self_peak_rss_kb),
        child_peak_rss_kb: peakRss(last?.child_peak_rss_kb),
        phases, complete: Boolean(last),
      });
    } catch (e) { errors.push(`${entry.name}: ${(e as Error).message}`); }
  }
  return checks;
}

export function summarizeCosts(root: string, events: Observation[], steps: TimedStep[], initialErrors: string[] = []) {
  const errors = [...initialErrors];
  let checks: Check[] = [];
  try { checks = readChecks(root, errors); } catch (e) { errors.push(`reading case costs: ${(e as Error).message}`); }
  const aggregates: Record<string, unknown>[] = [];
  try {
    for (const name of readdirSync(root).filter(n => /^aggregate-\d+-\d+\.jsonl$/.test(n))) {
      for (const line of readFileSync(join(root, name), "utf8").split("\n").filter(Boolean)) {
        try {
          const row = JSON.parse(line);
          if (row.event === "aggregate.peak" && typeof row.step === "string") aggregates.push(row);
          else errors.push(`invalid aggregate observation: ${name}`);
        } catch { errors.push(`partial JSON: ${name}`); }
      }
    }
  } catch (e) { errors.push(`reading aggregate costs: ${(e as Error).message}`); }
  const reqs = requests(events);
  const byStep: Record<string, unknown> = {};
  let missingChecks = 0;
  for (const step of steps) {
    const cases = checks.filter(c => c.step === step.name);
    const completed = cases.filter(c => c.complete);
    const tokens = reqs.filter(r => r.step === step.name);
    const index = new Map<string, Request[]>();
    for (const r of tokens) { const k = key(r); index.set(k, [...(index.get(k) ?? []), r]); }
    const tokenFor = (c: Check) => {
      const matches = (index.get(key(c)) ?? []).filter(r => r.grant !== undefined && r.grant <= c.start + .005 && (r.release ?? Infinity) >= c.end - .005);
      return matches.length === 1 ? matches[0] : null;
    };
    const unpooled = completed.filter(c => !tokenFor(c));
    const phases = phaseDistributions(completed, c=>c.phases);
    const phaseGroups = phaseDistributions(completed, grouped);
    const completedRequests = new Set(completed.flatMap(c => { const t = tokenFor(c); return t ? [t.id] : []; }));
    const missing = tokens.filter(r => CHECK_STEPS.has(step.name) && /tests\/programs\/[^/]+\/tsconfig\.json$/.test(r.project) && r.grant !== undefined && !completedRequests.has(r.id));
    missingChecks += missing.length;
    const completedAt = tokens.flatMap(r => r.grant === undefined || r.release === undefined ? [] : [r.release]).sort((a, b) => a - b);
    const end = Date.parse(step.started_at ?? "") / 1000 + (step.wall ?? 0);
    const scopes = aggregates.filter(row => row.step === step.name).map(row => ({
      cgroup: row.cgroup, scope_budget_bytes: peakRss(row.scope_budget_bytes), peak_bytes: peakRss(row.peak_bytes),
    }));
    const peaks = scopes.flatMap(row => row.peak_bytes === null ? [] : [row.peak_bytes]);
    byStep[step.name] = {
      aggregate_memory: { reserved_step_mem_bytes: step.mem_gb === undefined ? null : Math.floor(step.mem_gb * 2 ** 30),
        scopes, max_scope_peak_bytes: peaks.length ? Math.max(...peaks) : null,
        measured_scopes: peaks.length, unknown_scopes: scopes.length - peaks.length },
      coverage: { started: cases.length, completed: completed.length, incomplete: cases.length - completed.length,
        expected_program_checks: CHECK_STEPS.has(step.name) ? tokens.filter(r => r.grant !== undefined).length : null,
        missing_program_checks: missing.map(r => r.project), unpooled: unpooled.length },
      cpu_resolution_s: [...new Set(cases.map(c => c.cpu_resolution_s))],
      waiting: waitingBreakdown(events, step, unpooled),
      token_wait_s: distribution(tokens.flatMap(r => r.at === undefined || r.grant === undefined ? [] : [r.grant - r.at])),
      token_hold_s: distribution(tokens.flatMap(r => r.release === undefined || r.grant === undefined ? [] : [r.release - r.grant])),
      check_wall_s: distribution(completed.map(c => c.wall_s)), phases, phase_groups: phaseGroups,
      self_peak_rss_kb: distribution(completed.flatMap(c => c.self_peak_rss_kb === null ? [] : [c.self_peak_rss_kb])),
      child_peak_rss_kb: distribution(completed.flatMap(c => c.child_peak_rss_kb === null ? [] : [c.child_peak_rss_kb])),
      last_one_percent_completion_tail_s: completedAt.length && Number.isFinite(end)
        ? Math.max(0, end - completedAt[Math.max(0, Math.ceil(completedAt.length * .99) - 1)]) : null,
      cases: cases.map(c => {
        const token=tokenFor(c);
        return {...c, phase_groups:c.complete?grouped(c):null, token,
          outside_check_wall_s:token?.grant!==undefined && token.release!==undefined ? token.release-token.grant-c.wall_s:null};
      }),
      longest_checks: [...completed].sort((a, b) => b.wall_s - a.wall_s).slice(0, 10).map(c => ({ project: c.project, wall_s: c.wall_s })),
    };
  }
  return { version: 1, raw_directory: root, queue_sample_interval_s: .5,
    status: errors.length || missingChecks || checks.some(c => !c.complete) ? "partial" : "complete",
    errors: errors.slice(0, 20), error_count: errors.length,
    notes: ["Phase/worker seconds overlap; step wall buckets are disjoint.",
      "Nested phase totals must not be added to their enclosing totals.",
      "Wait causes use policy events and 500 ms state samples; transitions between observations are approximate.",
      "CPU is process-wide self and waited children, at the recorded clock-tick resolution; absent CPU is unknown.",
      "Self peak RSS is Linux VmHWM in KiB at standalone check completion: lifetime process peak, excluding children; child peak RSS is currently unknown.",
      "RSS distributions count measured completed checks only; sums of per-check peaks are not simultaneous resident memory.",
      "Aggregate memory.peak is read before removing each real step's resident-worker cgroup; it includes that group's descendants, not its outside orchestrator.",
      "max_scope_peak_bytes is the maximum over observed scopes, not the sum of concurrent scopes; missing scopes and peaks remain unknown.",
      "Complete describes telemetry, never program agreement; missing telemetry never changes a gate verdict."], steps: byStep };
}

export class CaseCosts {
  readonly root: string;
  readonly events: Observation[] = [];
  readonly errors: string[] = [];
  available = true;

  constructor(runDirectory: string) {
    this.root = join(runDirectory, "costs");
    try { mkdirSync(this.root, { recursive: true }); }
    catch (e) { this.available = false; this.errors.push((e as Error).message); }
  }

  record(event: { event: string; epoch?: number; [key: string]: unknown }): void {
    const row = { ...event, epoch: event.epoch ?? Date.now() / 1000 } as Observation;
    this.events.push(row);
    if (!this.available) return;
    try { appendFileSync(join(this.root, "queue.jsonl"), `${JSON.stringify(row)}\n`); }
    catch (e) { this.available = false; this.errors.push((e as Error).message); }
  }

  summary(steps: TimedStep[]) {
    try { return summarizeCosts(this.root, this.events, steps, this.errors); }
    catch (e) { return { version: 1, status: "unavailable", errors: [(e as Error).message] }; }
  }
}
