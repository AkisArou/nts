import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaseCosts, distribution, recordAggregatePeak, summarizeCosts, waitingBreakdown, waitCause, type Observation } from "./case-costs.ts";
import {CgroupObservations,HostObservationError,CgroupDeparted,hostObservations,type CgroupFiles} from './host-observations.ts';
import {gzipSync} from 'node:zlib';
import {ownMemory} from './test-memory.ts';
import {fileInput} from './reader-inputs/main.ts';

const RECORDED_CHECK=fileInput(new URL('./case-costs-recorded.jsonl',import.meta.url));

const epoch = 1_700_000_000;
const step = { name: "examples", started_at: new Date(epoch * 1000).toISOString(), wall: 10 };
// A token waits for memory while its share does not fit in the run's reservation.
const memory = (fits: boolean) => ({ reserved_bytes: 2 ** 33, used_bytes: 2 ** 33, withheld_bytes: 0, wanted_bytes: 0, token_short_bytes: fits ? 0 : 2 ** 30, growing_bytes: 0 });
const state = (fits = true, slots = 0, fe = 0) => ({ memory: memory(fits), used: { slots, fe }, slots: 24, frontends: 20, withhold: 0 });
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
  const phase = (name: string, wall: number, self: number, child: number) => ({ event: "end", phase: name, epoch: epoch + start + duration,
    wall_s: wall, self_user_s: unknownCpu ? null : self, self_sys_s: unknownCpu ? null : 0,
    child_user_s: unknownCpu ? null : child, child_sys_s: unknownCpu ? null : 0 });
  const rows = [
    { ...fields, event: "case" },
    { event: "begin", phase: "check.total", epoch: epoch + start },
    phase("capture", .2, .1, 0), phase("native.runtime_objects", .3, .01, .2), phase("native.runtime_objects", .4, .01, .3),
    ...(!partial ? [{...phase("check.total", duration, .3, 1), self_peak_rss_kb: peak, child_peak_rss_kb: null}] : []),
  ];
  writeFileSync(join(root, `check-${id}-0.jsonl`), rows.map(r => JSON.stringify(r)).join("\n") + (partial ? '\n{"unfinished":' : "\n"));
}

test('pool snapshots publish only structural changes, while every token event remains recorded',async t=>{
  const costs=new CaseCosts(fixture(t)),snapshot={event:'pool.state',...state(),held:{},waiting:[],running:[]};
  for(let n=0;n<100;n++)costs.record({...snapshot,epoch:epoch+n,runner_cpu:{userCPUTime:n}});
  assert.equal(costs.events.length,1,'an idle pool writes one snapshot, independent of clock and rusage');
  costs.record({...snapshot,...state(false),epoch:epoch+100});
  costs.record({...snapshot,...state(false),epoch:epoch+101});
  costs.record({...snapshot,epoch:epoch+102});
  assert.equal(costs.events.length,3,'a changed state and a return to the original state each publish once');
  const token=event(103,'token.request',1);
  costs.record(token);costs.record(token);
  const rows=readFileSync(join(costs.root,'queue.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(rows,costs.events);
  assert.equal(rows.filter(row=>row.event==='pool.state').length,3);
  assert.equal(rows.filter(row=>row.event==='token.request').length,2);
  const summary=(await costs.summary([step]));
  assert.ok('pool_state_poll_interval_s' in summary);
  assert.equal(summary.pool_state_poll_interval_s,.5);
  assert.ok(!('queue_sample_interval_s' in summary),'poll cadence is not a promise of recorded samples');
});

test('a restoring snapshot preserves wait causes after intervening token observations',async t=>{
  const costs=new CaseCosts(fixture(t)),full=state(true,24),short=state(false,24);
  const snapshot=(at:number)=>({event:'pool.state',epoch:epoch+at,...full});
  const rows=[snapshot(0),event(0,'token.request',1,full),snapshot(.5),
    event(1,'token.request',2,short),event(1.2,'token.cancel',2,short),snapshot(1.5),snapshot(2)];
  const minute={...step,wall:60},legacy=(await summarizeCosts(costs.root,rows,[minute]));
  for(const row of rows)costs.record(row);
  const recorded=readFileSync(join(costs.root,'queue.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line) as Observation);
  assert.deepEqual(waitingBreakdown(recorded,minute),waitingBreakdown(rows,minute));
  assert.deepEqual((await costs.summary([minute])),legacy);
  const waiting=waitingBreakdown(recorded,minute)!;
  assert.equal(waiting.wall_s.memory_admission,.5);
  assert.equal(waiting.wall_s.slot_tokens,59.5);
});

test('every state-bearing event invalidates snapshot dedupe, independently of its event name',async t=>{
  for(const kind of ['token.request','token.grant','token.release','token.cancel','pool.change','another.observation']){
    const costs=new CaseCosts(fixture(t)),snapshot={event:'pool.state',...state(true,24)};
    costs.record({...snapshot,epoch});
    costs.record(event(1,kind,2,state(false,24)));
    costs.record({...snapshot,epoch:epoch+1.5});
    costs.record({event:'diagnostic',epoch:epoch+1.7});
    costs.record({...snapshot,epoch:epoch+2});
    const snapshots=costs.events.filter(row=>row.event==='pool.state');
    assert.deepEqual(snapshots.map(row=>row.epoch),[epoch,epoch+1.5],kind);
  }
});

test('interleaved process sessions retain the exact legacy summary of a recorded compiler trace',async t=>{
  const costs=new CaseCosts(fixture(t));
  // One completed check from the measured green core 1dccb9d1090c. Reuse its
  // actual floating-point phase/rusage observations, including unknown peaks.
  const recorded=readFileSync(RECORDED_CHECK,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const header=recorded[0];
  const sessions=[0,1,2,10].map(id=>({id,rows:recorded.map(row=>row.event==='case'?{...row,pid:42,project:header.project+'/'+id}:row)}));
  for(const {id,rows} of sessions)writeFileSync(join(costs.root,`check-42-${id}.jsonl`),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
  const observedStep={name:header.step,started_at:new Date(recorded[1].epoch*1000).toISOString(),wall:10};
  const polling=Array.from({length:20},(_,n)=>({event:'pool.state',epoch:Math.floor(recorded[1].epoch)+n/2,
    ...state(n>=10),runner_cpu:{userCPUTime:n}}));
  costs.events.push(...polling); // The old writer retained every clock sample.
  const legacy=(await costs.summary([observedStep]));
  costs.events.length=0;
  for(const file of readdirSync(costs.root))rmSync(join(costs.root,file));
  // All headers arrive before any phase; nested and concurrent sessions can
  // interleave in the worker's stream. The session key owns attribution.
  const compact=recorded.flatMap((_,index)=>sessions.map(({id,rows})=>({...rows[index],session:id})));
  writeFileSync(join(costs.root,'check-42.jsonl'),compact.map(row=>JSON.stringify(row)).join('\n')+'\n');
  for(const row of polling)costs.record(row);
  assert.equal(costs.events.length,2,'only the initial state and changed memory state survive');
  assert.deepEqual((await costs.summary([observedStep])),legacy);
  assert.ok('steps' in legacy);assert.equal((legacy.steps[header.step] as any).coverage.completed,4);
});

test('a truncated process stream retains completed and unfinished sessions separately',async t=>{
  const dir=fixture(t);checkFile(dir,42);checkFile(dir,43,'new',4,2,true);
  const rows=[42,43].flatMap(id=>readFileSync(join(dir,`check-${id}-0.jsonl`),'utf8').split('\n').filter(line=>line&& !line.startsWith('{"unfinished":')).map(line=>({...JSON.parse(line),session:id})));
  for(const id of [42,43])rmSync(join(dir,`check-${id}-0.jsonl`));
  writeFileSync(join(dir,'check-42.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n{"session":43,');
  const result=(await summarizeCosts(dir,[],[step])),data=result.steps.examples as any;
  assert.equal(result.status,'partial');assert.equal(result.error_count,1);
  assert.deepEqual([data.coverage.started,data.coverage.completed,data.coverage.incomplete],[2,1,1]);
});

test('all four check forms preserve the recorded summary and every double bit',async t=>{
  const root=fixture(t),recorded=readFileSync(RECORDED_CHECK,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const population=[42,7].flatMap(pid=>[0,1,2,10].map(session=>({pid,session,rows:recorded.map(row=>row.event==='case'
    ?{...row,pid,project:row.project+'/'+pid+'/'+session}:row)})));
  const observed={name:recorded[0].step,started_at:new Date(recorded[1].epoch*1000).toISOString(),wall:10};
  let expected:unknown;
  const numberBits=(value:unknown):unknown=>{
    if(typeof value==='number'){const bytes=Buffer.alloc(8);bytes.writeDoubleLE(value);return bytes.toString('hex');}
    if(Array.isArray(value))return value.map(numberBits);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,part])=>[key,numberBits(part)]));
    return value;
  };
  for(const form of ['legacy','process','worker','gzip']){
    for(const file of readdirSync(root))rmSync(join(root,file));
    if(form==='legacy')for(const {pid,session,rows} of population)writeFileSync(join(root,`check-${pid}-${session}.jsonl`),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
    else{
      // Reverse arrival/completion order, with all sessions interleaved.
      const rows=recorded.flatMap((_,index)=>[...population].reverse().map(value=>({pid:value.pid,producer:value.pid,record:{...value.rows[index],session:value.session}})));
      if(form==='process')for(const pid of [42,7])writeFileSync(join(root,`check-${pid}.jsonl`),rows.filter(row=>row.pid===pid).map(row=>JSON.stringify(row.record)).join('\n')+'\n');
      else{
        const bytes=rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
        writeFileSync(join(root,'check-worker-0.jsonl'+(form==='gzip'?'.gz':'')),form==='gzip'?gzipSync(bytes):bytes);
      }
    }
    const summary=await summarizeCosts(root,[],[observed]);
    assert.equal(summary.error_count,0,form);
    if(expected===undefined)expected=summary;
    assert.deepEqual(summary,expected,form);assert.deepEqual(numberBits(summary),numberBits(expected),form+' double bits');
  }
});

test('unidentified compact rows never attach to another session',async t=>{
  const dir=fixture(t);writeFileSync(join(dir,'check-42.jsonl'),JSON.stringify({event:'case',project:'unowned'})+'\n');
  const result=(await summarizeCosts(dir,[],[step]));
  assert.equal(result.status,'partial');assert.match(result.errors[0]!,/invalid case session/);
  assert.equal((result.steps.examples as any).coverage.started,0);
});

test('barrier traces retain overlapping policy lifetimes separately from admitted work',async t=>{
  const rows=[event(0,'token.request',1),event(0,'token.grant',1),
    event(1,'token.barrier.begin',2),event(2,'token.barrier.begin',3),
    event(5,'token.barrier.end',2,{reason:'grant'}),event(7,'token.barrier.end',3,{reason:'withdraw'}),event(10,'token.release',1)];
  const costs=new CaseCosts(fixture(t));
  for(const row of rows)costs.record(row);
  const persisted=readFileSync(join(costs.root,'queue.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(persisted.filter(row=>row.event.startsWith('token.barrier.')),rows.filter(row=>row.event.startsWith('token.barrier.')));
  const result=waitingBreakdown(costs.events,step)!;
  assert.deepEqual(result.backfill_barrier,{wall_s:6,request_s:9,unfinished:[]});
  assert.equal(result.wall_s.admitted_case,10,'barrier time overlaps existing work, rather than adding to wall time');
  const summary=(await costs.summary([step]));assert.ok('steps' in summary);
  assert.deepEqual((summary.steps.examples as Record<string,any>).waiting.backfill_barrier,result.backfill_barrier);
});

test('an unfinished barrier remains visible through the end of an incomplete trace',()=>{
  const result=waitingBreakdown([event(3,'token.barrier.begin',7)],step)!;
  assert.deepEqual(result.backfill_barrier,{wall_s:7,request_s:7,unfinished:[7]});
});

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

test("before/after checks keep their own binary and token intervals; phase distributions are per program", async t => {
  const dir = fixture(t);
  checkFile(dir, 10, "old", 1, 2);
  checkFile(dir, 11, "new", 4, 2);
  const label = (binary: string) => `json64:${Buffer.from(JSON.stringify({ project: "tests/programs/a/tsconfig.json", binary })).toString("base64url")}`;
  const rows = [event(0, "token.request", 1, { context: label("old") }), event(.5, "token.grant", 1), event(3.2, "token.release", 1),
    event(3.3, "token.request", 2, { context: label("new") }), event(3.8, "token.grant", 2), event(6.1, "token.release", 2)];
  const result = (await summarizeCosts(dir, rows, [step]));
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

test("old binaries or missing files are incomplete telemetry, never a fabricated timing", async t => {
  const dir = fixture(t);
  const result = (await summarizeCosts(dir, [event(0,"token.request",1), event(1,"token.grant",1), event(2,"token.release",1)], [step]));
  assert.equal(result.status, "partial");
  const data = result.steps.examples as Record<string, any>;
  assert.equal(data.coverage.completed, 0);
  assert.deepEqual(data.coverage.missing_program_checks, ["tests/programs/a/tsconfig.json"]);
  assert.equal(data.check_wall_s.n, 0);
});

test("RSS distributions count only measured completed cases and preserve unknown child peaks", async t => {
  const dir = fixture(t);
  checkFile(dir, 10, "new", 1, 2, false, false, 1024);
  checkFile(dir, 11, "new", 1, 2, false, false, 4096);
  checkFile(dir, 12); // Old telemetry has no RSS field.
  checkFile(dir, 13, "new", 1, 2, false, false, null);
  checkFile(dir, 14, "new", 1, 2, true, false, 8192);
  for (const [index, value] of ["4096", -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1].entries()) {
    checkFile(dir, 20 + index, "new", 1, 2, false, false, value);
  }
  const data = (await summarizeCosts(dir, [], [step])).steps.examples as Record<string, any>;
  assert.deepEqual(data.self_peak_rss_kb, {n:2, sum:5120, p50:1024, p95:4096, p99:4096, max:4096});
  assert.deepEqual(data.child_peak_rss_kb, distribution([]));
  assert.equal(data.cases.find((c: any) => c.pid === 12).self_peak_rss_kb, null);
  assert.equal(data.cases.find((c: any) => c.pid === 14).self_peak_rss_kb, null);
  assert.ok(data.cases.every((c: any) => c.child_peak_rss_kb === null));
});

test("a truncated child record and unavailable CPU stay visible", async t => {
  const dir = fixture(t);
  checkFile(dir, 10, "new", 1, 2, true);
  checkFile(dir, 11, "new", 4, 2, false, true);
  const result = (await summarizeCosts(dir, [], [step]));
  assert.equal(result.status, "partial");
  assert.equal(result.error_count, 1);
  const data = result.steps.examples as Record<string, any>;
  assert.equal(data.coverage.incomplete, 1);
  assert.equal(data.check_wall_s.n, 1);
  assert.equal(data.phases.capture.self_cpu_s.n, 0);
  assert.deepEqual(data.cpu_resolution_s, [.01, null]);
});

test("an unwritable metrics directory cannot throw into the runner", async t => {
  const dir = fixture(t);
  const file = join(dir,"file"); writeFileSync(file,"not a directory");
  const costs = new CaseCosts(file);
  assert.equal(costs.available, false);
  assert.doesNotThrow(() => costs.record(event(0,"pool.state")));
  assert.equal((await costs.summary([step])).status,"partial");
});

test("percentiles retain slow tails and an empty population is explicit", () => {
  assert.deepEqual(distribution([]), { n:0,sum:0,p50:null,p95:null,p99:null,max:null });
  const d = distribution([...Array(99).fill(1), 100]);
  assert.equal(d.p50,1); assert.equal(d.p99,1); assert.equal(d.max,100); assert.equal(d.sum,199);
});

test("aggregate peaks retain each scope beside the step's reservation", async t => {
  const dir = fixture(t);
  const scopes = [
    { cgroup: "/run/a", scope_budget_bytes: 6 * 2 ** 30, peak_bytes: 512 * 2 ** 20 },
    { cgroup: "/run/b", scope_budget_bytes: 6 * 2 ** 30, peak_bytes: 768 * 2 ** 20 },
    { cgroup: "/run/c", scope_budget_bytes: 6 * 2 ** 30, peak_bytes: null },
  ];
  writeFileSync(join(dir, "aggregate-1-0.jsonl"), scopes.map(row => JSON.stringify({ event: "aggregate.peak", step: "examples", ...row })).join("\n") + "\n");
  const result = (await summarizeCosts(dir, [], [{ ...step, memory: { reserved_bytes: 6 * 2 ** 30 } }]));
  const data = result.steps.examples as any;
  assert.equal(data.aggregate_memory.reserved_step_bytes, 6 * 2 ** 30);
  assert.equal(data.aggregate_memory.max_scope_peak_bytes, 768 * 2 ** 20);
  assert.equal(data.aggregate_memory.measured_scopes, 2);
  assert.equal(data.aggregate_memory.unknown_scopes, 1);
  assert.deepEqual(data.aggregate_memory.scopes, scopes);
  assert.equal(((await summarizeCosts(dir, [], [step])).steps.examples as any).aggregate_memory.reserved_step_bytes, null, "a step the run did not size has no reservation");
  assert.equal(result.status, "complete");
});

test("aggregate peaks use supplied observations and retained scopes retire on departure", async t => {
  const dir = fixture(t);
  const owned=ownMemory(join(dir,'observations'),{scopePeak:{kind:'fixed',bytes:4096,resettable:true}});
  const env = {...owned, NTS_GATE_CASE_COSTS_DIR: dir, NTS_GATE_STEP: "examples" };
  recordAggregatePeak({path:"/supplied-peak",inode:"retained"}, 1024, env);
  const result = (await summarizeCosts(dir, [], [step]));
  const data = result.steps.examples as any;
  assert.equal(data.aggregate_memory.max_scope_peak_bytes, 4096);
  assert.equal(data.aggregate_memory.unknown_scopes, 0);
  assert.doesNotThrow(() => recordAggregatePeak({path:"/supplied-peak",inode:"retained"}, 1024, { ...env, NTS_GATE_CASE_COSTS_DIR: join(dir, "absent") }));
  ownMemory(join(dir,'observations'),{scopePeak:{kind:'live'}});
  recordAggregatePeak({path:'/nonexistent-nts-peak',inode:'acquired-before-departure'},1024,env);
  assert.equal(((await summarizeCosts(dir,[],[step])).steps.examples as any).aggregate_memory.unknown_scopes,1);
});

test("artifact shadow counts distinguish cross-run matches, mismatches, misses and unavailable keys", async t => {
  const dir = fixture(t);
  const rows = [
    { status: "miss", run: "run-a" },
    { status: "hit-match", run: "run-b", baseline_run: "run-a" },
    { status: "hit-match", run: "run-b", baseline_run: "run-b" },
    { status: "hit-mismatch", run: "run-b", baseline_run: "run-a" },
    { status: "unavailable", run: "run-b" },
  ];
  writeFileSync(join(dir, "shadow-1-0.jsonl"), rows.map(row => JSON.stringify({ event: "artifact.shadow", kind: "assemble", step: "examples", ...row })).join("\n") + "\n");
  const result = (await summarizeCosts(dir, [], [step]));
  assert.deepEqual((result.steps.examples as any).artifact_shadow, {
    observations: 5, skipped_runs: 0, eligible_for_skipping: false, mismatch_evidence: [], kinds: { assemble: {
      observations: 5, misses: 1, matching_hits: 2, mismatching_hits: 1, unavailable: 1, cross_run_hits: 2,
    } },
  });
});

test("reuse summary counts actual skips and matching tool-only CPU without inventing unknown costs", async t => {
  const dir = fixture(t);
  const rows = [
    { status: "fresh", enabled: false, tool_cpu_s: .5, matching_hit_cpu_s: .5 },
    { status: "fresh", enabled: false, tool_cpu_s: .7, matching_hit_cpu_s: null },
    { status: "fresh", enabled: false, tool_cpu_s: null, matching_hit_cpu_s: null },
    { status: "reused", enabled: true, tool_cpu_s: null, matching_hit_cpu_s: null },
  ];
  writeFileSync(join(dir, "reuse-1-0.jsonl"), rows.map(row => JSON.stringify({ event: "artifact.reuse", kind: "jvm-verifies", step: "examples", ...row })).join("\n") + "\n");
  const result = (await summarizeCosts(dir, [], [step])).steps.examples as any;
  assert.equal(result.artifact_reuse.skipped_runs, 1);
  assert.equal(result.artifact_reuse.fresh_runs, 3);
  assert.equal(result.artifact_reuse.tool_cpu_s.n, 2);
  assert.equal(result.artifact_reuse.tool_cpu_s.sum, 1.2);
  assert.equal(result.artifact_reuse.matching_hit_cpu_s.sum, .5);
  assert.equal(result.artifact_reuse.unknown_cpu_runs, 1);
  assert.equal(result.artifact_shadow.skipped_runs, 1);
});


for(const code of ['ENOENT','ENODEV','ESRCH','EIO','EACCES'])for(const operation of ['stat','memory.peak'])
test(`aggregate peak keeps acquired identity across owners at ${operation}: ${code}`,async t=>{
  const dir=fixture(t),scope={path:'/acquired',inode:'123'},env={...ownMemory(join(dir,'observations')),NTS_GATE_CASE_COSTS_DIR:dir,NTS_GATE_STEP:'examples'};
  let stopped=false;
  const files:CgroupFiles={inode:()=>{if(stopped&&operation==='stat')throw Object.assign(Error(code),{code});return scope.inode;},text:()=>{if(stopped&&operation==='memory.peak')throw Object.assign(Error(code),{code});return '456';},children:()=>[]};
  assert.equal(new CgroupObservations(files).inode(scope.path),scope.inode);stopped=true;
  const sampler=new CgroupObservations(files),host={...hostObservations(env),cgroupMemoryPeak:(path:string,inode?:string)=>sampler.peak(path,inode)};
  if(['EIO','EACCES'].includes(code))assert.throws(()=>recordAggregatePeak(scope,1024,env,host),error=>error instanceof HostObservationError&&!(error instanceof CgroupDeparted)&&error.message.includes(code)&&error.message.includes(operation));
  else{
    recordAggregatePeak(scope,1024,env,host);
    assert.equal(((await summarizeCosts(dir,[],[step])).steps.examples as any).aggregate_memory.unknown_scopes,1);
  }
});
