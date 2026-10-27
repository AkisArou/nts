import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaseCosts, distribution, recordAggregatePeak, summarizeCosts, waitingBreakdown, waitCause, type Observation } from "./case-costs.ts";

const epoch = 1_700_000_000;
const step = { name: "examples", started_at: new Date(epoch * 1000).toISOString(), wall: 10 };
const state = (memory = true, slots = 0, fe = 0) => ({ memory_allowed: memory, used: { slots, fe }, slots: 24, frontends: 20, withhold: 0 });
const event = (at: number, kind: string, id?: number, extra = {}): Observation => ({
  epoch: epoch + at, event: kind, step: "examples", request: id, pid: id,
  context: "path:tests/programs/a/tsconfig.json", compiler_sha: "new", ...state(), ...extra,
});
function fixture(t: { after: (fn: () => void) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "nts-case-costs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function checkFile(root: string, id: number, binary = "new", start = 1, duration = 2, partial = false, unknownCpu = false, peak: unknown = undefined) {
  const fields = { project: "tests/programs/a/tsconfig.json", pid: id, step: "examples", binary_sha: binary, cpu_resolution_s: unknownCpu ? null : .01 };
  const phase = (name: string, wall: number, self: number, child: number) => ({ ...fields, event: "end", phase: name, epoch: epoch + start + duration,
    wall_s: wall, self_user_s: unknownCpu ? null : self, self_sys_s: unknownCpu ? null : 0,
    child_user_s: unknownCpu ? null : child, child_sys_s: unknownCpu ? null : 0 });
  const rows = [
    { ...fields, event: "case" },
    { ...fields, event: "begin", phase: "check.total", epoch: epoch + start },
    phase("capture", .2, .1, 0), phase("native.runtime_objects", .3, .01, .2), phase("native.runtime_objects", .4, .01, .3),
    ...(!partial ? [{...phase("check.total", duration, .3, 1), self_peak_rss_kb: peak, child_peak_rss_kb: null}] : []),
  ];
  writeFileSync(join(root, `check-${id}-0.jsonl`), rows.map(r => JSON.stringify(r)).join("\n") + (partial ? '\n{"unfinished":' : "\n"));
}

test("disjoint wall distinguishes token and memory waits without summing overlapping workers", () => {
  const rows = [event(0, "token.request", 1, state(false)), event(2, "token.grant", 1),
    event(3, "token.request", 2), event(5, "token.release", 1, state(true, 24)),
    event(8, "token.grant", 2), event(10, "token.release", 2)];
  const r = waitingBreakdown(rows, step)!;
  assert.equal(r.wall_s.memory_admission, 2);
  assert.equal(r.wall_s.admitted_case, 5);
  assert.equal(r.wall_s.slot_tokens, 3);
  assert.equal(Object.values(r.wall_s).reduce((a,b) => a+b,0), 10);
  assert.equal(Object.values(r.worker_wait_s).reduce((a,b) => a+b,0), 7);
  assert.equal(waitCause(state(true, 10, 20)), "frontend_cap");
  assert.equal(waitCause(state(true, 0, 0)), "priority_or_dispatch");
  assert.equal(waitCause({ ...state(true, 20), withhold:4 }), "reserved_slots");
});

test("the unpooled JVM sweep is work rather than idle time", () => {
  const check = { project: "target/sweep-jvm/tsconfig.json", binary_sha: "new", step: "examples", pid: 99,
    start: epoch, end: epoch + 4, wall_s: 4, complete: true, cpu_resolution_s: .01,
    self_peak_rss_kb: null, child_peak_rss_kb: null, phases: [] };
  const result = waitingBreakdown([], step, [check])!;
  assert.equal(result.wall_s.unpooled_check, 4);
  assert.equal(result.wall_s.script_or_dispatch, 6);
});

test("before/after checks keep their own binary and token intervals; phase distributions are per program", t => {
  const dir = fixture(t);
  checkFile(dir, 10, "old", 1, 2);
  checkFile(dir, 11, "new", 4, 2);
  const label = (binary: string) => `json64:${Buffer.from(JSON.stringify({ project: "tests/programs/a/tsconfig.json", binary })).toString("base64url")}`;
  const rows = [event(0, "token.request", 1, { context: label("old") }), event(.5, "token.grant", 1), event(3.2, "token.release", 1),
    event(3.3, "token.request", 2, { context: label("new") }), event(3.8, "token.grant", 2), event(6.1, "token.release", 2)];
  const result = summarizeCosts(dir, rows, [step]);
  assert.equal(result.status, "complete");
  const data = result.steps.examples as Record<string, any>;
  assert.equal(data.coverage.completed, 2);
  assert.equal(data.cases.find((c: any) => c.binary_sha === "old").token.id, 1);
  assert.equal(data.cases.find((c: any) => c.binary_sha === "new").token.id, 2);
  assert.equal(data.phases["native.runtime_objects"].wall_s.n, 2);
  assert.equal(data.phases["native.runtime_objects"].wall_s.sum, 1.4);
  assert.equal(data.phases["native.runtime_objects"].child_cpu_s.sum, 1);
  assert.equal(data.phases.capture.self_cpu_s.sum, .2);
  assert.equal(data.phases.capture.child_cpu_s.sum, 0);
  assert.equal(data.phases["check.total"].child_cpu_s.sum, 2);
  assert.equal(data.phase_groups.toolchain.wall_s.sum, 1.4);
  const groups = data.cases[0].phase_groups;
  assert.equal(groups.reduce((n: number,p: any)=>n+p.wall_s,0),2);
  assert.equal(groups.reduce((n: number,p: any)=>n+p.self_cpu_s,0),.3);
  assert.equal(groups.reduce((n: number,p: any)=>n+p.child_cpu_s,0),1);
});

test("old binaries or missing files are incomplete telemetry, never a fabricated timing", t => {
  const dir = fixture(t);
  const result = summarizeCosts(dir, [event(0,"token.request",1), event(1,"token.grant",1), event(2,"token.release",1)], [step]);
  assert.equal(result.status, "partial");
  const data = result.steps.examples as Record<string, any>;
  assert.equal(data.coverage.completed, 0);
  assert.deepEqual(data.coverage.missing_program_checks, ["tests/programs/a/tsconfig.json"]);
  assert.equal(data.check_wall_s.n, 0);
});

test("RSS distributions count only measured completed cases and preserve unknown child peaks", t => {
  const dir = fixture(t);
  checkFile(dir, 10, "new", 1, 2, false, false, 1024);
  checkFile(dir, 11, "new", 1, 2, false, false, 4096);
  checkFile(dir, 12); // Old telemetry has no RSS field.
  checkFile(dir, 13, "new", 1, 2, false, false, null);
  checkFile(dir, 14, "new", 1, 2, true, false, 8192);
  for (const [index, value] of ["4096", -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1].entries()) {
    checkFile(dir, 20 + index, "new", 1, 2, false, false, value);
  }
  const data = summarizeCosts(dir, [], [step]).steps.examples as Record<string, any>;
  assert.deepEqual(data.self_peak_rss_kb, {n:2, sum:5120, p50:1024, p95:4096, p99:4096, max:4096});
  assert.deepEqual(data.child_peak_rss_kb, distribution([]));
  assert.equal(data.cases.find((c: any) => c.pid === 12).self_peak_rss_kb, null);
  assert.equal(data.cases.find((c: any) => c.pid === 14).self_peak_rss_kb, null);
  assert.ok(data.cases.every((c: any) => c.child_peak_rss_kb === null));
});

test("a truncated child record and unavailable CPU stay visible", t => {
  const dir = fixture(t);
  checkFile(dir, 10, "new", 1, 2, true);
  checkFile(dir, 11, "new", 4, 2, false, true);
  const result = summarizeCosts(dir, [], [step]);
  assert.equal(result.status, "partial");
  assert.equal(result.error_count, 1);
  const data = result.steps.examples as Record<string, any>;
  assert.equal(data.coverage.incomplete, 1);
  assert.equal(data.check_wall_s.n, 1);
  assert.equal(data.phases.capture.self_cpu_s.n, 0);
  assert.deepEqual(data.cpu_resolution_s, [.01, null]);
});

test("an unwritable metrics directory cannot throw into the runner", t => {
  const dir = fixture(t);
  const file = join(dir,"file"); writeFileSync(file,"not a directory");
  const costs = new CaseCosts(file);
  assert.equal(costs.available, false);
  assert.doesNotThrow(() => costs.record(event(0,"pool.state")));
  assert.equal(costs.summary([step]).status,"partial");
});

test("percentiles retain slow tails and an empty population is explicit", () => {
  assert.deepEqual(distribution([]), { n:0,sum:0,p50:null,p95:null,p99:null,max:null });
  const d = distribution([...Array(99).fill(1), 100]);
  assert.equal(d.p50,1); assert.equal(d.p99,1); assert.equal(d.max,100); assert.equal(d.sum,199);
});

test("aggregate peaks retain each scope and compare bytes with the step reservation", t => {
  const dir = fixture(t);
  const scopes = [
    { cgroup: "/run/a", scope_budget_bytes: 6 * 2 ** 30, peak_bytes: 512 * 2 ** 20 },
    { cgroup: "/run/b", scope_budget_bytes: 6 * 2 ** 30, peak_bytes: 768 * 2 ** 20 },
    { cgroup: "/run/c", scope_budget_bytes: 6 * 2 ** 30, peak_bytes: null },
  ];
  writeFileSync(join(dir, "aggregate-1-0.jsonl"), scopes.map(row => JSON.stringify({ event: "aggregate.peak", step: "examples", ...row })).join("\n") + "\n");
  const result = summarizeCosts(dir, [], [{ ...step, mem_gb: 6 }]);
  const data = result.steps.examples as any;
  assert.equal(data.aggregate_memory.reserved_step_mem_bytes, 6 * 2 ** 30);
  assert.equal(data.aggregate_memory.max_scope_peak_bytes, 768 * 2 ** 20);
  assert.equal(data.aggregate_memory.measured_scopes, 2);
  assert.equal(data.aggregate_memory.unknown_scopes, 1);
  assert.deepEqual(data.aggregate_memory.scopes, scopes);
  assert.equal(result.status, "complete");
});

test("unreadable aggregate peaks stay unknown and a failed observation cannot throw", t => {
  const dir = fixture(t);
  const env = { NTS_GATE_CASE_COSTS_DIR: dir, NTS_GATE_STEP: "examples" };
  recordAggregatePeak("/nonexistent-nts-peak", 1024, env);
  const result = summarizeCosts(dir, [], [step]);
  const data = result.steps.examples as any;
  assert.equal(data.aggregate_memory.max_scope_peak_bytes, null);
  assert.equal(data.aggregate_memory.unknown_scopes, 1);
  assert.doesNotThrow(() => recordAggregatePeak("/nonexistent-nts-peak", 1024, { ...env, NTS_GATE_CASE_COSTS_DIR: join(dir, "absent") }));
});
