import {assignTestValues,fixtureEnvironment} from "../gate/test-environment.ts";
// A landing's steps (run.ts): the build first, the rest through the gate's own
// runner, narrowed steps, failing builds and steps, a run inside another gate,
// and memory pressure run again alone. Shared helpers are in run-fixture.ts.
import {test} from "node:test";
import assert from "node:assert/strict";
import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {ENVIRONMENT_EXPERIMENT,gateEnvironment} from '../gate/canonical-environment.ts';
import {ENVIRONMENT_CONTEXT} from '../differential/oracle-seal/main.ts';
import {cancelReason,FAIL_FAST_STOP,gateInterruption,launcherEnvironment,PROFILE,runLanding} from "./run.ts";
import {WithdrawalRequested} from './withdrawal-watch.ts';
import {fixture} from './run-fixture.ts';
import {spawnTest} from "../gate/test-wait.ts";
import {TEST_PROFILE_MANIFEST} from '../gate/test-profile.ts';
import {withoutHanded} from '../gate/test-memory.ts';
import {writeLandingVerdict,readLandingVerdict} from './verdict.ts';
import {recordCosts} from './service.ts';
import {costKey,readLandingCosts,type Selection} from './selection.ts';
import {fixtureContract} from '../gate/verdict-contract-fixture.ts';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {generatedJavaScript} from '../gate/generated-javascript.ts';

test("the compiler builds first in nts-dev, and the steps drive it through the gate's own runner", async t => {
  const f = fixture(t);
  const ran = await runLanding(f.options(["build", "examples", "outcomes", "rustfmt"]));
  assert.equal(ran.state, "green", ran.message);
  assert.deepEqual(ran.steps.map(s => `${s.name} ${s.verdict}`), ["build PASS", "examples PASS", "outcomes PASS", "rustfmt PASS"]);
  assert.ok(ran.steps[0]!.wall !== undefined, "the build is timed");
  assert.equal(readFileSync(join(f.target, PROFILE, "nts"), "utf8"), "nts 1\n", "built incrementally");
  // Every step builds in nts-dev and drives the compiler built: the runner's
  // pin of it by content, kept in the fixture's own cache, not the machine's.
  for (const line of f.calls()) {
    const [, profile, bin, incremental] = line.split(" ");
    assert.equal(profile, "nts-dev");
    assert.equal(incremental, "1");
    assert.ok(bin!.startsWith(join(f.target, "..", "nts-gate/bin-v2/")), bin);
    assert.equal(readFileSync(bin!, "utf8"), "nts 1\n");
  }
  const summary = JSON.parse(readFileSync(join(f.run, "summary.json"), "utf8"));
  assert.deepEqual([...summary.requested].sort(), ["examples", "outcomes", "program-oracles", "rustfmt"], "the runner ran the landing steps and their required producer");
  assert.equal(summary.environment.canonical, true);
  assert.equal(summary.memory.priority, "landing", "the runner's reservation waits at the landing check's priority");
  assert.ok(existsSync(join(f.run, "landing.json")));
});

test("pinned binary identities survive a step relinking the original target", async t => {
  const f = fixture(t), script = join(f.tree, "tooling/gate/all.sh");
  const original = readFileSync(script, "utf8");
  assert.ok(original.includes("pass) echo"));
  writeFileSync(script, original.replace("pass) echo",
    `pass) printf changed > "$CARGO_TARGET_DIR/${PROFILE}/nts"; echo`));
  const ran = await runLanding(f.options(["build", "rustfmt"]));
  assert.equal(ran.state, "green", ran.message);
  const summary = JSON.parse(readFileSync(join(f.run, "summary.json"), "utf8"));
  const changed = createHash("sha256").update(readFileSync(join(f.target, PROFILE, "nts"))).digest("hex");
  assert.notEqual(summary.identities.nts.sha256, changed);
  assert.equal(ran.steps.find(step => step.name === "rustfmt")?.binaries?.nts, summary.identities.nts.sha256);
  assert.equal(ran.steps.find(step => step.name === "build")?.binaries?.nts, summary.identities.nts.sha256);
});

test("a step the rules narrowed runs narrowed: the touched crates' doc tests", async t => {
  const f = fixture(t);
  const ran = await runLanding(f.options(["build", "doctests"], { doctests: "nts-core nts-cli" }));
  assert.equal(ran.state, "green", ran.message);
  assert.equal(readFileSync(join(f.controls, "doctest-crates"), "utf8"), "nts-core nts-cli\n");
});

test('a doctests-only landing prepares before its execution, and retains preparation on retry',async t=>{
  const f=fixture(t);f.control('doctests','pressure');
  copyModuleClosure(['tooling/gate/verdict-contract.ts','tooling/gate/durable-record.ts'],f.tree);
  writeFileSync(join(f.tree,'tooling/gate/verdict-contract.ts'),generatedJavaScript(`import {durableRecord} from './durable-record.ts';durableRecord(process.argv[2],${JSON.stringify(fixtureContract())});`));
  mkdirSync(join(f.target,PROFILE));
  for(const name of ['nts','nts-suite'])writeFileSync(join(f.target,PROFILE,name),'stale compiler from an earlier commit\n');
  const options=f.options(['doctests'],{doctests:'nts-core'}),ran=await runLanding(options);
  assert.equal(ran.state,'green',ran.message);
  assert.deepEqual(ran.steps.map(row=>row.name),['doctests']);
  assert.deepEqual(ran.binaries,{});
  assert.equal(ran.steps[0]!.binaries,undefined);
  assert.equal(ran.steps[0]!.preparation?.verdict,'PASS');
  assert.match(ran.steps[0]!.preparation!.log!,/doctest-preparation\.log$/);
  for(const name of ['nts','nts-suite'])assert.equal(readFileSync(join(f.target,PROFILE,name),'utf8'),'stale compiler from an earlier commit\n');
  assert.equal(ran.steps.find(row=>row.name==='doctests')?.attempt,2);
  assert.ok(existsSync(join(f.run,'doctest-build.json')));
  assert.equal(readFileSync(join(f.controls,'doctest-crates'),'utf8'),'nts-core\n');
  const selection:Selection={owed:['doctests'],deferred:[],landing:[{step:'doctests',form:'as-is',seconds:1,cost:{cpu:1,measured:true,source:'fixture'}}],
    budget:{slots:24,frontends:24,seconds:600},fits:true,estimate:{seconds:1,build:0,work:1,longest:1,longestStep:'doctests',fixed:0}};
  const receipt=writeLandingVerdict(f.own,{commit:options.commit,tree:options.commit,submission:options.commit,landing:'doctests-only',base:options.commit,
    selected:{selection,interop:null,doctests:'nts-core'},ran})!;
  assert.deepEqual(receipt.steps.map(row=>row.outcome.name),['doctests']);assert.deepEqual(receipt.binaries,{});
  assert.deepEqual(readLandingVerdict(f.own,options.commit,options.commit,ran.contract!,['doctests']).receipt,receipt);
  recordCosts(f.own,ran,'other');assert.equal(readLandingCosts(join(f.own,'costs.json')).has(costKey('build','other')),false);
});

test('failed doctest-only preparation reports the selected step and never reports a compiler build',async t=>{
  const f=fixture(t);f.control('build','fail');
  const ran=await runLanding(f.options(['rustfmt','doctests'],{doctests:'nts-core'}));
  assert.equal(ran.state,'red',ran.message);
  assert.deepEqual(ran.steps.map(row=>row.name+' '+row.verdict),['doctests FAIL','rustfmt NOT RUN']);
  assert.match(ran.steps[0]!.log!,/doctest-preparation\.log$/);
  assert.deepEqual(f.calls(),[]);
});

test('a direct build and doctests selection compiles both profiles before step scopes',t=>{
  const f=fixture(t),bin=join(f.own,'bin'),calls=join(f.own,'cargo-calls');mkdirSync(bin);
  writeFileSync(join(f.tree,'Cargo.toml'),'[workspace]\n'+readFileSync(TEST_PROFILE_MANIFEST,'utf8').split(/(?=^\[)/m).find(part=>part.startsWith('[profile.nts-dev]')));
  writeFileSync(join(bin,'cargo'),`#!${process.execPath}
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
assert.equal(process.env.NTS_GATE_STEP,undefined,'compilation entered a step scope');assert.ok(process.env.NTS_MEMORY_RESERVATION);
const target=process.env.CARGO_TARGET_DIR,doc=process.argv.includes('--doc');
fs.appendFileSync(${JSON.stringify(calls)},doc?'doctest prerequisites\\n':'release compiler\\n');
fs.mkdirSync(path.join(target,doc?'nts-dev':'release'),{recursive:true});
if(doc){console.log(JSON.stringify({reason:'compiler-artifact',filenames:[path.join(target,'nts-dev/deps/private')],profile:{test:false,debuginfo:0},fresh:false}));console.log(JSON.stringify({reason:'build-finished',success:true}));}
else for(const name of ['nts','nts-suite'])fs.writeFileSync(path.join(target,'release',name),'#!/bin/sh\\nexit 0\\n',{mode:0o755});
`,{mode:0o755});
  const base=launcherEnvironment(withoutHanded(f.options([]).env!));
  assignTestValues(base,{NTS_GATE_STEP:undefined,NTS_GATE_STEP_ATTEMPT:undefined,NTS_GATE_STEP_RESULT:undefined,
    NTS_GATE_STEP_MEMORY_BYTES:undefined,NTS_GATE_CASE_COSTS_DIR:undefined,NTS_MEMORY_HANDOVER:undefined});
  const planned=gateEnvironment(base,{run:f.run,owned:{...f.memory,NTS_TOOLING_SLICE:f.slice,NTS_GATE_STEPS:'build doctests',
    NTS_GATE_SLOTS:'4',CARGO_TARGET_DIR:f.target,PATH:bin+':'+base.PATH,NTS_MEMORY_PRIORITY:'agent'}});
  const ran=spawnTest(process.execPath,[join(f.tree,'tooling/gate/run.mjs')],{cwd:f.tree,env:planned.env,encoding:'utf8'});
  assert.equal(ran.status,0,ran.stdout+ran.stderr);
  assert.deepEqual(readFileSync(calls,'utf8').trim().split('\n'),['release compiler','doctest prerequisites']);
  const summary=JSON.parse(readFileSync(join(f.run,'summary.json'),'utf8'));
  assert.deepEqual(summary.steps.map((row:{name:string;verdict:string})=>row.name+' '+row.verdict),['build PASS','doctests PASS']);
});

test("a failing build refuses the change, and nothing after it runs", async t => {
  const f = fixture(t);
  f.control("build", "fail");
  const ran = await runLanding(f.options(["build", "examples"]));
  assert.equal(ran.state, "red");
  assert.match(ran.message, /^build FAIL; log .*build\.log$/);
  assert.deepEqual(ran.steps.map(s => `${s.name} ${s.verdict}`), ["build FAIL", "examples NOT RUN"]);
  assert.match(readFileSync(ran.steps[0]!.log!, "utf8"), /mismatched types/);
  assert.deepEqual(f.calls(), []);
});

test("a failing step refuses the change and names itself and its log first", async t => {
  const f = fixture(t);
  f.control("outcomes", "fail");
  const ran = await runLanding(f.options(["build", "examples", "outcomes"]));
  assert.equal(ran.state, "red");
  assert.match(ran.message, /^outcomes FAIL; log \S*outcomes\.log; /);
  assert.match(ran.message, /; logs \S+$/);
});

test("the first red step cancels the running rest within the bound, and every row and log stays readable", async t => {
  const f = fixture(t);
  f.control("examples", "stuck");
  f.control("outcomes", "fail-after-examples");
  const ran = await runLanding(f.options(["build", "examples", "outcomes"]));
  assert.equal(ran.state, "red", ran.message);
  // The stuck step was running when outcomes failed, and was killed, not waited for.
  const failedAt = BigInt(readFileSync(join(f.controls, "outcomes.failed"), "utf8").trim());
  const sinceFail = Number(BigInt(Date.now()) * 1_000_000n - failedAt) / 1e9;
  assert.ok(sinceFail < 30, `the run ended ${sinceFail.toFixed(1)} s after the first FAIL; the bound is 30 s`);
  const examples = ran.steps.find(s => s.name === "examples")!;
  assert.equal(examples.verdict, "NOT RUN");
  assert.equal(examples.cancelledBy, "outcomes");
  assert.equal(examples.reason, "cancelled: outcomes FAIL");
  assert.match(readFileSync(examples.log!, "utf8"), /examples: waits for ever/, "the cancelled step's log keeps what it wrote");
  assert.match(ran.message, /^outcomes FAIL; log \S*outcomes\.log; cancelled 1 step\(s\): examples; logs /);
  const recorded = JSON.parse(readFileSync(join(f.run, "landing.json"), "utf8"));
  assert.equal(recorded.message, ran.message);
  assert.equal(recorded.steps.find((s: { name: string }) => s.name === "examples").reason, "cancelled: outcomes FAIL");
  assert.doesNotMatch(readFileSync(join(f.run, "landing.json"), "utf8"), /\[object Object\]/);
});

test("only a runner stopped by its own fail-fast is a verdict; any other interruption holds", () => {
  const failed = [{ name: "examples", verdict: "NOT RUN" as const }, { name: "outcomes", verdict: "FAIL" as const }];
  assert.deepEqual(gateInterruption({ steps: failed }), { state: "none" });
  assert.deepEqual(gateInterruption({ fail_fast: true, interrupted: FAIL_FAST_STOP, steps: failed }), { state: "fail-fast", first: "outcomes" });
  // A signal (a withdrawal delivers one) after a FAIL replaces fail-fast's reason: held, never red.
  assert.deepEqual(gateInterruption({ fail_fast: true, interrupted: "signal SIGTERM", steps: failed }), { state: "held", reason: "the run was interrupted: signal SIGTERM" });
  assert.equal(gateInterruption({ fail_fast: false, interrupted: FAIL_FAST_STOP, steps: failed }).state, "held");
  assert.equal(gateInterruption({ fail_fast: true, interrupted: FAIL_FAST_STOP, steps: [{ name: "examples", verdict: "INSTRUMENT" }] }).state, "held");
});

test("a cancel reason reads as words, never [object Object]", () => {
  assert.equal(cancelReason(new WithdrawalRequested("a1")), "withdrawal requested for a1");
  assert.equal(cancelReason({ kind: "signal", signal: "SIGTERM" }), "the landing process received SIGTERM");
  assert.equal(cancelReason({ kind: "failure", error: new Error("disk gone") }), "the landing process failed: disk gone");
  assert.equal(cancelReason({ kind: "failure" }), "the landing process failed");
  assert.equal(cancelReason(new Error("bound")), "bound");
  assert.equal(cancelReason({ other: 1 }), '{"other":1}');
});

test("a landing run started inside another gate is a run of its own, not that gate's", async t => {
  // The tooling step of an outer gate: its context owns that gate's fail-fast.
  const f = fixture(t), home = f.options([]).env!.HOME!;
  const outer = gateEnvironment({ ...fixtureEnvironment(t), HOME: home }, { run: join(home, ".cache/outer-gate"), owned: { NTS_GATE_FAIL_FAST: "1", NTS_GATE_STEPS: "tooling" } }).env;
  assert.ok(outer[ENVIRONMENT_CONTEXT]);
  f.control("outcomes", "fail");
  const ran = await runLanding(f.options(["build", "examples", "outcomes"], { env: { ...outer, HOME: home } }));
  assert.equal(ran.state, "red");
  const summary = JSON.parse(readFileSync(join(f.run, "summary.json"), "utf8"));
  assert.ok(summary.requested.includes("examples") && summary.requested.includes("outcomes"), "the outer gate's steps did not reach this run");
  assert.deepEqual(launcherEnvironment({ A: "1", [ENVIRONMENT_CONTEXT]: "{}", [ENVIRONMENT_EXPERIMENT]: "today" }), { A: "1" });
});

test("a step memory pressure kept from measuring runs again, alone", async t => {
  const f = fixture(t);
  f.control("examples", "pressure");
  const holds: string[] = [];
  const ran = await runLanding(f.options(["build", "examples", "outcomes"], { hold: reason => holds.push(reason) }));
  assert.equal(ran.state, "green", ran.message);
  // Memory pressure is no FAIL: it cancels nothing beside it.
  assert.equal(ran.steps.find(s => s.name === "outcomes")?.verdict, "PASS");
  assert.equal(ran.steps.some(s => s.cancelledBy), false);
  assert.equal(ran.steps.find(s => s.name === "examples")?.attempt, 2);
  assert.ok(holds.some(h => /memory pressure kept examples from measuring/.test(h)), holds.join("\n"));
  assert.ok(existsSync(join(f.run, "attempt-2/summary.json")));
  const attempt = JSON.parse(readFileSync(join(f.run, "attempt-2/summary.json"), "utf8"));
  assert.deepEqual(attempt.requested, ["program-oracles", "examples"], "only the unmeasured native step and its run-owned producer run again");
  assert.equal(attempt.memory.priority, "landing");
});

test("a landing keeps its reporter alive until its sampler closes", t => {
  const code = `import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {mock} from 'node:test';
const ledger=${JSON.stringify(new URL('../gate/memory-ledger.ts',import.meta.url).href)};
const real=await import(ledger);let report,releaseObserved,close;const released=new Promise(done=>{releaseObserved=done;}),closed=new Promise(done=>{close=done;});
mock.module(ledger,{namedExports:{...real,reserveJob:async(_request,options)=>{
 report=options.report;return {id:'owned-log-control',ledger:'/owned',inherited:false,env:{},bytes:1,active:()=>true,grow:async()=>{},shrink:async()=>{},outranked:()=>false,noteOver:async()=>{},release:()=>releaseObserved(),closed};
}}});
const {fixture}=await import(${JSON.stringify(new URL('./run-fixture.ts',import.meta.url).href)});
const {runLanding}=await import(${JSON.stringify(new URL('./run.ts',import.meta.url).href)});
const cleanup=[],f=fixture({after(callback){cleanup.push(callback);}});let returned=false;
const pending=runLanding(f.options(['build']));pending.then(()=>{returned=true;},()=>{returned=true;});
try{
 await released;await new Promise(done=>queueMicrotask(done));
 assert.equal(returned,false,'landing returned before its owned sampler closed');
 report('last sampler report');close();const ran=await pending;assert.equal(ran.state,'green',ran.message);
 assert.match(readFileSync(join(f.run,'build.log'),'utf8'),/last sampler report/);console.log('reporter closed before return');
}finally{close();await pending.catch(()=>{});for(const callback of cleanup.reverse())await callback();}`;
  // Preserve declared import instrumentation in the control's own process.
  const imports=process.execArgv.flatMap((argument,index,args)=>argument==='--import'&&args[index+1]?[argument,args[index+1]!] : []);
  const result=spawnTest(process.execPath,[...imports,'--experimental-test-module-mocks','--input-type=module','-e',code],{encoding:'utf8',env:fixtureEnvironment(t)});
  assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/reporter closed before return/);
});


test('a memory retry joins the build sampler before the next attempt or final publication',t=>{
 const code=`import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {mkdirSync,readFileSync,existsSync} from 'node:fs';import {join} from 'node:path';import {mock} from 'node:test';
import {durableRecord} from ${JSON.stringify(new URL('../gate/durable-record.ts',import.meta.url).href)};
const ledger=${JSON.stringify(new URL('../gate/memory-ledger.ts',import.meta.url).href)},candidate=${JSON.stringify(new URL('./candidate-environment.ts',import.meta.url).href)};
const realLedger=await import(ledger),realCandidate=await import(candidate);
const {workerLifecycle,newWorkerTerminal}=await import(${JSON.stringify(new URL('../gate/worker-lifecycle.ts',import.meta.url).href)});
let now=0,guard,cancelled=false,released,closeObserved=false,attempts=0;const releasedEvent=new Promise(done=>{released=done;});
const worker=new EventEmitter(),terminal=newWorkerTerminal(),diagnostics=[];
Object.assign(worker,{postMessage(){released();},unref(){},async terminate(){worker.emit('exit',1);return 1;}});
const life=workerLifecycle(worker,'retry control sampler',line=>diagnostics.push(line),{wallNow:()=>now,arm(callback){guard=callback;return()=>{cancelled=true;};}},terminal);
life.closed.then(()=>{closeObserved=true;},()=>{});
mock.module(ledger,{namedExports:{...realLedger,reserveJob:async()=>({id:'owned-retry-control',ledger:'/owned',inherited:false,env:{},bytes:1,drained:0,active:()=>true,grow:async()=>{},shrink:async()=>{},outranked:()=>false,noteOver:async()=>{},release:()=>life.stop(),closed:life.closed})}});
function launch(_node,request){
 const result={status:0,signal:null,stdout:'',stderr:''};
 if(request.command.includes('sh')||request.command.some(word=>word.endsWith('/all.sh'))){
  attempts++;if(attempts===2){assert.equal(closeObserved,true,'retry started before owned worker exit was joined');now=90001;if(!cancelled)guard();}
  mkdirSync(request.run,{recursive:true});durableRecord(join(request.run,'summary.json'),{identities:{commit:request.commit??commit},environment:{canonical:true},steps:[{name:'rustfmt',verdict:attempts===1?'INSTRUMENT':'PASS',...(attempts===1?{instrument:{kind:'memory-pressure'}}:{})}]});
 }else if(request.command.some(word=>word.endsWith('/verdict-contract.ts')))result.status=1;
 return result;
}
mock.module(candidate,{namedExports:{...realCandidate,candidateCommand:launch,candidateCommandAsync:async(...args)=>launch(...args)}});
const {fixture}=await import(${JSON.stringify(new URL('./run-fixture.ts',import.meta.url).href)});
const {runLanding}=await import(${JSON.stringify(new URL('./run.ts',import.meta.url).href)});
const cleanup=[],f=fixture({after(fn){cleanup.push(fn);}}),commit=f.options([]).commit;
const pending=runLanding(f.options(['build','rustfmt']));let returned=false;pending.then(()=>{returned=true;},()=>{returned=true;});
try{
 await releasedEvent;await Promise.resolve();assert.equal(attempts,1,'retry started before owned worker exit was joined');assert.equal(returned,false);assert.equal(existsSync(join(f.run,'landing.json')),false,'verdict appeared before sampler drain');
 now=19;worker.emit('message',{kind:'stopped',peak:0});Atomics.store(terminal,0,23n);now=29;worker.emit('exit',0);
 const ran=await pending;assert.equal(ran.state,'green',ran.message);assert.equal(attempts,2);assert.equal(ran.steps.find(row=>row.name==='rustfmt').attempt,2);
 assert.equal(JSON.parse(readFileSync(join(f.run,'landing.json'),'utf8')).state,'green');assert.ok(diagnostics.some(line=>line.includes('"workerTerminalHookAt":23')&&line.includes('"exitObservedAt":29')));console.log('retry and publication follow joined sampler');
}finally{if(!closeObserved){worker.emit('message',{kind:'stopped',peak:0});worker.emit('exit',0);}await pending.catch(()=>{});for(const fn of cleanup.reverse())await fn();}`;
 const imports=process.execArgv.flatMap((argument,index,args)=>argument==='--import'&&args[index+1]?[argument,args[index+1]!] : []);
 const result=spawnTest(process.execPath,[...imports,'--experimental-test-module-mocks','--input-type=module','-e',code],{encoding:'utf8',env:fixtureEnvironment(t)});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/retry and publication follow joined sampler/);
});
