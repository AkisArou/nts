import {STEP_CPU_MEASURE,GNU_CPU_MEASURE} from '../gate/step-time.ts';
import {fixtureEnvironment} from "../gate/test-environment.ts";
// The landing service end to end, in a scratch repository with a local bare
// origin and a pool of two trees: queue order, rebase and conflict refusal,
// fast-forward and push, branch deletion here and on origin, the pool tree
// reset, red, held and retried, withdrawal, recovery and restart.
//
//   node --test tooling/landing/service.test.ts
//
// The selection and the step runs are stubs (selection.test.ts and the
// run-*.test.ts files check the real ones); the landing tree is prepared for
// real, and a check is red when the tree it checks has a file named RED.
import { test, type TestContext } from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { fixtureContract } from "../gate/verdict-contract-fixture.ts";
import { verdictPath, type LandingVerdict } from "./verdict.ts";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {treeUsers,describeUsers} from "./tree-users.ts";
import { Pool } from "./pool.ts";
import { Queue } from "./queue.ts";
import type { Ran, RunOptions } from "./run.ts";
import { scratchRepo } from "./scratch-repo.ts";
import { landingCpuMeasure,landingSelection, type Selection } from "./selection.ts";
import { drain, prepareTree, prune, recordCosts, type Config } from "./service.ts";
import {holder} from './lock.ts';
import {lockChild} from './lock-fixture.ts';
import {generatedJavaScript} from '../gate/generated-javascript.ts';
import {landingStatus,statusText} from './status.ts';
import {assertObservedGroupEmpty,ownedProcessGroup} from '../gate/process-group.ts';
import {durableRecord} from '../gate/durable-record.ts';
import {randomUUID} from 'node:crypto';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {pathToFileURL} from 'node:url';
import {waitFor} from '../gate/test-wait.ts';

function selection(steps: string[]): Selection {
  return landingSelection({ owed: { steps: [...steps, "integrity"] }, paths: [], catalogue: [...steps, "integrity"],
    table: Object.fromEntries([...steps.map(step => [step, { form: "as-is" as const }]), ["integrity", { form: "after" as const }]]),
    inCorpus: () => false, rows: new Map(), cost: () => ({ cpu: 10, measured: true, source: "test" }), budget: { slots: 24, frontends: 24, seconds: 600 } });
}

function service(t: TestContext, overrides: Partial<Config> = {}) {
  const s = scratchRepo(t, "landing-service");
  s.commit({"Cargo.toml":"[workspace]\n[profile.nts-dev]\ndebug=0\n",".gitignore":"target/\n"},"fixture build policy");
  // A fixed disk reading: the host's free disk must not decide whether a fixture's tree can be made.
  const ownedProcesses=new Set<number>();
  const users=(tree:string)=>treeUsers(tree,{pids:[...ownedProcesses]});
  const pool = new Pool(join(s.dir, "pool"), { root: s.root, env: s.env }, undefined,{users,
    reclamation:{services:[],ownership:tree=>{const owners=users(tree);if(owners.length)throw Error('fixture owns '+describeUsers(owners));}}});
  pool.init(2);
  const logs: string[] = [], checked: string[] = [];
  const config: Config = {
    home: join(s.dir, "landing"), root: s.root, remote: "origin", tree: join(s.dir, "landing-tree"), target: join(s.dir, "target"), pool, env: s.env,
    select: () => ({ selection: selection(["build", "tests", "rustfmt"]), kind: "other", interop: null, doctests: null }),
    prepare: tip => prepareTree(s.root, join(s.dir, "landing-tree"), tip, s.env),
    runSteps: async (options: RunOptions): Promise<Ran> => {
      checked.push(options.commit);
      const red = existsSync(join(options.tree, "RED"));
      return { state: red ? "red" : "green", message: red ? `tests FAIL; logs ${options.run}` : "green", run: options.run, wall_s: 2, pending: [],
        steps: options.steps.map(name => ({ name, verdict: red && name === "tests" ? "FAIL" as const : "PASS" as const, cpu: 5, cpu_measure:landingCpuMeasure(name),wall: 1 })) };
    },
    log: line => logs.push(line), ...overrides,
  };
  const queue = new Queue(config.home);
  /** A task's change, made in its pool tree on its branch, pushed there too. */
  const task = (branch: string, files: Record<string, string | null>, { push = true } = {}) => {
    const tree = pool.take(branch);
    const sha = s.commit(files, `task ${branch}`, tree.path);
    if (push) s.git(["push", "-q", "origin", branch], tree.path);
    return { tree: tree.path, sha };
  };
  const submit = (branch: string, sha: string, first = false) => queue.submit(sha, { branch, first });
  return { s, pool, config, queue, logs, checked, task, submit, ownedProcesses, main: () => s.git(["rev-parse", "main"]), origin: () => s.git(["ls-remote", "origin", "refs/heads/main"]).split("\t")[0] };
}

test("queued changes land one at a time, each rebased onto the newest main, pushed, its branch deleted and its tree freed", async t => {
  const f = service(t);
  const a = f.task("fix/a", { "src/a.txt": "a\n" });
  const b = f.task("fix/b", { "src/b.txt": "b\n" });
  const ea = f.submit("fix/a", a.sha), eb = f.submit("fix/b", b.sha);
  const drained = await drain(f.config);
  assert.equal(drained.state, "drained");
  assert.deepEqual(drained.answered.map(r => r.state), ["landed", "landed"]);
  const ra = f.queue.result(ea.id)!, rb = f.queue.result(eb.id)!;
  assert.equal(ra.tip, a.sha, "a was on main's line: it lands as itself");
  assert.notEqual(rb.tip, b.sha, "b was rebased onto main with a in it");
  assert.equal(f.s.git(["rev-parse", `${rb.tip}^`]), ra.tip);
  assert.equal(f.main(), rb.tip);
  assert.equal(f.origin(), rb.tip, "main is pushed");
  assert.equal(readFileSync(join(f.s.root, "src/b.txt"), "utf8"), "b\n", "the shared checkout moved with main");
  assert.deepEqual(rb.commits, [rb.tip]);
  assert.deepEqual(rb.landing, ["build", "tests", "rustfmt"]);
  assert.deepEqual(rb.deferred, ["integrity"]);
  for (const branch of ["fix/a", "fix/b"]) {
    assert.equal(f.s.git(["branch", "--list", branch]), "", `${branch} is deleted here`);
    assert.equal(f.s.git(["ls-remote", "--heads", "origin", branch]), "", `${branch} is deleted on origin`);
  }
  // Each tree was freed at the main its task landed as; the next task to take
  // one gets the newest main then.
  assert.deepEqual(f.pool.trees().map(t => `${t.state} ${t.head.slice(0, 12)}`), [`free ${ra.tip!.slice(0, 12)}`, `free ${rb.tip!.slice(0, 12)}`]);
  assert.match(rb.message, /^LANDED [0-9a-f]{12} as [0-9a-f]{12}: main is [0-9a-f]{12}; pushed to origin$/);
  assert.equal(f.queue.status().state, "idle");
});

test("a revert from the full check is checked before the changes waiting", async t => {
  const f = service(t);
  const a = f.task("fix/a", { "src/a.txt": "a\n" }, { push: false });
  f.submit("fix/a", a.sha);
  f.s.git(["switch", "-q", "--detach", "main"], f.s.dir.concat("/pool/2"));
  const revert = f.s.commit({ "docs/workflow.md": "reverted\n" }, "Revert of something", f.s.dir.concat("/pool/2"));
  const er = f.queue.submit(revert, { first: true, by: "full-check" });
  const drained = await drain(f.config);
  assert.equal(drained.answered[0]!.id, er.id);
  assert.deepEqual(drained.answered.map(r => r.state), ["landed", "landed"]);
});

test("a change that conflicts with main is refused, naming the files, and the queue goes on", async t => {
  const f = service(t);
  const a = f.task("fix/a", { "docs/workflow.md": "the task's words\n" });
  const b = f.task("fix/b", { "src/b.txt": "b\n" });
  f.s.commit({ "docs/workflow.md": "main's words\n" }, "main moved");
  const ea = f.submit("fix/a", a.sha);
  f.submit("fix/b", b.sha);
  const drained = await drain(f.config);
  assert.deepEqual(drained.answered.map(r => r.state), ["refused", "landed"]);
  assert.match(f.queue.result(ea.id)!.message, /conflicts with main [0-9a-f]{12} in docs\/workflow\.md \(at [0-9a-f]{12}\): rebase it onto main/);
  assert.notEqual(f.s.git(["branch", "--list", "fix/a"]), "", "a refused change keeps its branch");
  assert.equal(f.pool.trees().find(t => t.branch === "fix/a")?.state, "held", "and its tree");
});

test("a red check refuses the change with its failing steps and run, and main does not move", async t => {
  const f = service(t);
  const before = f.main();
  const a = f.task("fix/a", { "RED": "tests fail\n" });
  const ea = f.submit("fix/a", a.sha);
  await drain(f.config);
  const r = f.queue.result(ea.id)!;
  assert.equal(r.state, "refused");
  assert.match(r.message, /^red: tests FAIL; logs .*\/runs\/[0-9a-f]{12}-\d+$/);
  assert.equal(f.main(), before);
  assert.notEqual(f.s.git(["ls-remote", "--heads", "origin", "fix/a"]), "", "its branch stays on origin");
});

test("a held check waits aside, and lands once retried", async t => {
  let held = true;
  const f = service(t);
  const green = f.config.runSteps;
  f.config.runSteps = async options => held ? { state: "held", message: "examples INSTRUMENT: memory pressure three times", run: options.run, steps: [], pending: [], wall_s: 1 } : green(options);
  const a = f.task("fix/a", { "src/a.txt": "a\n" });
  const ea = f.submit("fix/a", a.sha);
  await drain(f.config);
  assert.equal(f.queue.result(ea.id)!.state, "held");
  assert.deepEqual(f.queue.held().map(e => e.id), [ea.id]);
  held = false;
  f.queue.retry(ea.id);
  await drain(f.config);
  assert.equal(f.queue.result(ea.id)!.state, "landed");
});

test("main moved during a check: the change is checked again on the new main", async t => {
  let moved = false;
  const f = service(t);
  const green = f.config.runSteps;
  f.config.runSteps = async options => {
    if (!moved) { moved = true; f.s.commit({ "docs/elsewhere.md": "someone wrote main\n" }, "direct"); }
    return green(options);
  };
  const a = f.task("fix/a", { "src/a.txt": "a\n" });
  const ea = f.submit("fix/a", a.sha);
  await drain(f.config);
  const r = f.queue.result(ea.id)!;
  assert.equal(r.state, "landed");
  assert.equal(f.checked.length, 2, "checked twice");
  assert.ok(f.logs.some(line => /main moved to [0-9a-f]{12} during the check/.test(line)), f.logs.join("\n"));
  assert.ok(existsSync(join(f.s.root, "docs/elsewhere.md")) && existsSync(join(f.s.root, "src/a.txt")));
});

test("a withdrawal asked during the check is answered, and the change does not land", async t => {
  const f = service(t);
  const green = f.config.runSteps;
  const a = f.task("fix/a", { "src/a.txt": "a\n" });
  const ea = f.submit("fix/a", a.sha);
  const before = f.main();
  f.config.runSteps = async options => { f.queue.withdraw(ea.id); return green(options); };
  await drain(f.config);
  assert.equal(f.queue.result(ea.id)!.state, "withdrawn");
  assert.equal(f.main(), before);
});

test('an unproved cancellation holds the service and resumes only when its retained closer certifies the drain',async t=>{
  const f=service(t),green=f.config.runSteps;
  const a=f.task('fix/a',{'src/a.txt':'a\n'}),b=f.task('fix/b',{'src/b.txt':'b\n'});
  const ea=f.submit('fix/a',a.sha),eb=f.submit('fix/b',b.sha),base=f.main();
  let entered!:()=>void,held!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),retained=new Promise<void>(resolve=>{held=resolve;});
  f.config.runSteps=async options=>{
    if(options.commit!==a.sha)return green(options);
    assert.ok(options.signal);assert.ok(options.drainRetry);assert.ok(options.cancellationHold);
    const aborted=new Promise<void>(resolve=>options.signal!.addEventListener('abort',()=>resolve(),{once:true}));
    entered();await aborted;
    options.cancellationHold('owned closer still has a populated scope');
    const retry=options.drainRetry();held();await retry;
    assert.equal(f.queue.checking()?.id,ea.id,'the same check still owns recovery');
    assert.equal(f.main(),base);
    return {state:'cancelled',message:'scope certified empty',run:options.run,wall_s:1,steps:[],pending:[]};
  };
  const pending=drain(f.config);await started;f.queue.withdraw(ea.id);await retained;
  const model=landingStatus(f.s.root,f.config.home,f.pool.home,Date.parse('2026-11-16T00:00:00Z'),{statusTrees:()=>[]});
  assert.equal(model.service.state,'held');assert.equal(model.service.running,true);
  assert.equal(model.service.run,f.queue.checking()?.run);
  assert.match(model.service.message!,new RegExp(`service held: cancellation of ${ea.id} could not prove its drain: owned closer`));
  assert.match(statusText(model),/retry certification with node tooling\/landing\/check.ts withdraw/);
  assert.equal(f.queue.result(ea.id)?.state,'held');assert.equal(f.queue.withdrawRequested(ea.id),true);
  assert.deepEqual(f.queue.waiting().map(entry=>entry.id),[eb.id],'no later entry starts while the drain is unproved');
  assert.equal(f.queue.withdraw(ea.id),'requested');
  const done=await pending;
  assert.deepEqual(done.answered.map(row=>row.state),['withdrawn','landed']);
  assert.equal(f.queue.withdrawRequested(ea.id),false);assert.equal(f.queue.held().length,0);
  assert.equal(f.queue.result(eb.id)?.state,'landed');
});

test('a retained closer with no proof stays held across service activity without answering withdrawn or starting another check',async t=>{
  const f=service(t),a=f.task('fix/a',{'src/a.txt':'a\n'}),b=f.task('fix/b',{'src/b.txt':'b\n'});
  const ea=f.submit('fix/a',a.sha),eb=f.submit('fix/b',b.sha),base=f.main();
  let entered!:()=>void,held!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),retained=new Promise<void>(resolve=>{held=resolve;}),closed=new Promise<void>(resolve=>{release=resolve;});
  f.config.runSteps=async options=>{
    const aborted=new Promise<void>(resolve=>options.signal!.addEventListener('abort',()=>resolve(),{once:true}));entered();await aborted;
    options.cancellationHold!('the real child has not exited');held();await closed;
    return {state:'cancelled',message:'fixture cleanup finally drained',run:options.run,wall_s:1,steps:[],pending:[]};
  };
  let answered=false;
  const pending=drain(f.config);pending.then(()=>{answered=true;});
  t.after(async()=>{release();await pending;});
  await started;f.queue.withdraw(ea.id);await retained;
  assert.equal(f.queue.withdraw(eb.id),'withdrawn','the queue remains responsive while its owned drain waits');
  await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(answered,false);assert.equal(f.main(),base);
  assert.equal(f.queue.result(ea.id)?.state,'held');assert.equal(f.queue.checking()?.id,ea.id);
  assert.equal(f.queue.status().state,'held');assert.equal(f.queue.withdrawRequested(ea.id),true);
  release();assert.deepEqual((await pending).answered.map(row=>row.state),['withdrawn']);
});

test('a restarted service certifies a persisted held entry whose group is gone and resumes without a human',async t=>{
  const f=service(t),a=f.task('fix/a',{'src/a.txt':'a\n'}),b=f.task('fix/b',{'src/b.txt':'b\n'});
  const ea=f.submit('fix/a',a.sha),eb=f.submit('fix/b',b.sha),base=f.main(),entry=f.queue.take()!;
  const run=join(f.config.home,'runs','interrupted'),groups=join(run,'candidate-groups');mkdirSync(groups,{recursive:true});
  const child=spawn(process.execPath,['-e','process.stdin.resume()'],{detached:true,env:fixtureEnvironment(t),stdio:['pipe','ignore','ignore']});
  const closed=once(child,'close'),group=ownedProcessGroup(child);assert.ok(group);
  t.after(async()=>{child.stdin!.end();await closed;});
  durableRecord(join(groups,randomUUID()+'.json'),group.observation);
  assert.throws(()=>assertObservedGroupEmpty(group.observation),/has not drained: live member/);
  child.stdin!.end();assert.deepEqual(await closed,[0,null]);
  f.queue.update({base,tip:a.sha,run});f.queue.withdraw(ea.id);
  f.queue.answer(entry,{state:'held',run,message:'service interrupted with cancellation pending'},{retainChecking:true});
  const prepared:string[]=[],prepare=f.config.prepare;f.config.prepare=tip=>{prepared.push(tip);prepare(tip);};
  const result=await drain(f.config);
  assert.deepEqual(result.answered.map(row=>row.state),['withdrawn','landed']);
  assert.equal(f.queue.result(ea.id)?.state,'withdrawn');assert.equal(f.queue.result(eb.id)?.state,'landed');
  assert.deepEqual(prepared,[b.sha],'the cancelled tree was never prepared or replayed');
  assert.equal(f.queue.held().length,0);assert.equal(f.queue.status().state,'idle');
});

test('a watcher fault leaves the current verdict intact, fences a later marker, and takes no next entry',async t=>{
  const stage=testScratch(t,'landing-watch-fault');copyModuleClosure(['tooling/landing/service.ts'],stage);
  const file=join(stage,'tooling/landing/queue.ts'),source=readFileSync(file,'utf8');
  const anchor="this.watcher.on('error',error=>this.failed(error));";
  assert.equal(source.split(anchor).length,2);
  writeFileSync(file,source.replace(anchor,anchor+"\nthis.watcher.on('change',()=>{if(existsSync(join(queue.home,'withdraw','watch-error')))this.watcher.emit('error',Error('controlled inotify failure'));});"));
  const {drain:stagedDrain}:typeof import('./service.ts')=await import(pathToFileURL(join(stage,'tooling/landing/service.ts')).href);
  for(const arm of ['green','red','marker'] as const){
    const f=service(t),a=f.task('fix/a',{'src/a.txt':'a\n'}),b=f.task('fix/b',{'src/b.txt':'b\n'});
    const ea=f.submit('fix/a',a.sha),eb=f.submit('fix/b',b.sha),base=f.main();
    let entered!:()=>void,release!:()=>void,signal:AbortSignal|undefined;
    const started=new Promise<void>(resolve=>{entered=resolve;}),closed=new Promise<void>(resolve=>{release=resolve;});
    f.config.runSteps=async options=>{
      signal=options.signal;entered();await closed;
      return {state:arm==='red'?'red':'green',message:'own verdict '+arm,run:options.run,steps:[],pending:[],wall_s:1};
    };
    const pending=stagedDrain(f.config);t.after(async()=>{release();await pending;});await started;
    writeFileSync(join(f.config.home,'withdraw','watch-error'),'fault');
    await waitFor('the recorded withdrawal watcher error',()=>f.queue.status().message?.includes('controlled inotify failure')===true);
    assert.equal(signal?.aborted,false,'a watch fault has no authority to cancel healthy work');
    if(arm==='marker')assert.equal(f.queue.withdraw(ea.id),'requested');
    release();const result=await pending;
    assert.equal(result.state,'held');assert.equal(result.answered.length,1);
    assert.equal(result.answered[0]!.state,arm==='red'?'refused':arm==='marker'?'withdrawn':'landed');
    assert.deepEqual(f.queue.waiting().map(entry=>entry.id),[eb.id]);
    assert.match(f.queue.status().message!,/service held: withdrawal watcher failed:.*controlled inotify failure.*restart nts-landing-check/);
    if(arm!=='green')assert.equal(f.main(),base);
  }
});

test("a change already on main lands as nothing, and its branch and tree are still cleaned up", async t => {
  const f = service(t);
  const a = f.task("fix/a", { "src/a.txt": "a\n" });
  f.s.git(["merge", "-q", "--ff-only", a.sha]);
  const ea = f.submit("fix/a", a.sha);
  await drain(f.config);
  const r = f.queue.result(ea.id)!;
  assert.equal(r.state, "landed");
  assert.match(r.message, /is on main already/);
  assert.deepEqual(f.checked, [], "nothing to check");
  assert.equal(f.s.git(["branch", "--list", "fix/a"]), "",JSON.stringify({result:r,logs:f.logs}));
});

test("a service that stopped after moving main finishes the landing; one that stopped mid-check checks again", async t => {
  const f = service(t);
  const a = f.task("fix/a", { "src/a.txt": "a\n" });
  const ea = f.submit("fix/a", a.sha);
  const taken = f.queue.take()!;
  const base = f.main();
  f.queue.update({ base, tip: a.sha, phase: "landing" });
  f.s.git(["merge", "-q", "--ff-only", a.sha]); // the fast-forward happened, then the service died
  const drained = await drain(f.config);
  assert.equal(drained.answered[0]?.id, taken.id);
  assert.equal(f.queue.result(ea.id)!.state, "landed");
  assert.equal(f.s.git(["branch", "--list", "fix/a"]), "");
  const b = f.task("fix/b", { "src/b.txt": "b\n" });
  const eb = f.submit("fix/b", b.sha);
  f.queue.take();
  f.queue.update({ phase: "checking" });
  await drain(f.config);
  assert.equal(f.queue.result(eb.id)!.state, "landed");
  assert.ok(f.logs.some(line => /was being checked when the service stopped/.test(line)));
});

test("a landing of the landing check's own code stops the service so the new code runs", async t => {
  const f = service(t, { restartAfter: paths => paths.some(p => p.startsWith("tooling/landing/")) });
  const a = f.task("fix/a", { "tooling/landing/check.ts": "// new\n" });
  const b = f.task("fix/b", { "src/b.txt": "b\n" });
  f.submit("fix/a", a.sha); f.submit("fix/b", b.sha);
  // The deployed service publishes the old boot/pid/start format and removes
  // it with its old release. The replacement must respect that live owner.
  const path=join(f.config.home,'serve.lock');
  const old=lockChild(t,generatedJavaScript(`import {openSync,writeSync,closeSync,readSync,readFileSync,rmSync} from 'node:fs';
import {processIdentity} from ${JSON.stringify(new URL('./lock.ts',import.meta.url).href)};
const path=process.argv[1],owner=processIdentity(process.pid),fd=openSync(path,'wx',0o600);
try{writeSync(fd,owner+'\\n');}finally{closeSync(fd);}process.stdout.write('old-held\\n');
readSync(0,Buffer.alloc(1),0,1,null);if(readFileSync(path,'utf8').trim()===owner)rmSync(path);`),[path]);
  await old.wait('old-held');const oldBytes=readFileSync(path);
  assert.equal(holder(path),old.child.pid);assert.equal((await drain(f.config)).state,'busy');
  assert.deepEqual(readFileSync(path),oldBytes,'the new reader never rewrites an old live owner');
  old.child.stdin.end();assert.equal(await old.closed,0,old.errors());assert.equal(existsSync(path),false);
  const first = await drain(f.config);
  assert.equal(first.state, "restart");
  assert.equal(first.answered.length, 1);
  assert.equal(holder(path),null,'self-restart releases the service lock before the replacement starts');
  assert.equal((await drain(f.config)).answered[0]?.state, "landed");
  assert.equal(holder(path),null);
});

test("a push origin refuses is reported, and the next landing pushes main", async t => {
  const f = service(t);
  const a = f.task("fix/a", { "src/a.txt": "a\n" }, { push: false });
  const ea = f.submit("fix/a", a.sha);
  f.s.git(["remote", "set-url", "origin", join(f.s.dir, "nowhere.git")]);
  await drain(f.config);
  const r = f.queue.result(ea.id)!;
  assert.equal(r.state, "landed");
  assert.equal(r.pushed, false);
  assert.match(r.message, /NOT pushed: .*the next landing pushes it/);
  f.s.git(["remote", "set-url", "origin", f.s.origin]);
  await drain(f.config);
  assert.equal(f.origin(), f.main());
  assert.ok(f.logs.includes("pushed main to origin"));
});

test("a check that throws holds its change for a person, and the queue goes on", async t => {
  const f = service(t);
  const green = f.config.runSteps;
  let first = true;
  f.config.runSteps = async options => { if (first) { first = false; throw new Error("cannot read gate capabilities: run.mjs exited 1"); } return green(options); };
  const a = f.task("fix/a", { "src/a.txt": "a\n" }), b = f.task("fix/b", { "src/b.txt": "b\n" });
  const ea = f.submit("fix/a", a.sha), eb = f.submit("fix/b", b.sha);
  const drained = await drain(f.config);
  assert.equal(drained.state, "drained");
  assert.equal(f.queue.result(ea.id)!.state, "held");
  assert.match(f.queue.result(ea.id)!.message, /the check could not finish: cannot read gate capabilities/);
  assert.equal(f.queue.result(eb.id)!.state, "landed");
  assert.equal(f.queue.checking(), null);
});

test("tidying up after main moved never un-lands a change", async t => {
  const f = service(t);
  const a = f.task("fix/a", { "src/a.txt": "a\n" });
  const ea = f.submit("fix/a", a.sha);
  f.config.pool = { release: () => { throw new Error("pool lock held by process 1"); } } as unknown as Config["pool"];
  await drain(f.config);
  const r = f.queue.result(ea.id)!;
  assert.equal(r.state, "landed");
  assert.equal(f.main(), a.sha);
  assert.match(r.message, /the pool tree was not released: pool lock held by process 1/);
});

test("a landing whose tree a process still uses keeps the tree on its branch and says why; the upkeep resets it once nothing does", async t => {
  const f = service(t);
  const a = f.task("fix/a", { "src/a.txt": "a\n" });
  // The task's own tests still run in its tree after it queued.
  const tests = spawn("cat", [], {env:fixtureEnvironment(t), cwd: a.tree, stdio: ["pipe", "ignore", "ignore"] });
  // Ended when its input closes, here or, if an assertion stops the test first, after it.
  t.after(() => { tests.stdin.end(); });
  await once(tests, "spawn");f.ownedProcesses.add(tests.pid!);
  const ea = f.submit("fix/a", a.sha);
  await drain(f.config);
  const r = f.queue.result(ea.id)!;
  assert.equal(r.state, "landed");
  assert.equal(f.main(), a.sha);
  assert.match(r.message, new RegExp(`pool tree 1 stays on its branch while pid ${tests.pid} cat \\(its working directory\\) still uses it `
    + `\\(a shell or editor with its working directory there counts too\\); the next upkeep resets it once nothing does`));
  assert.equal(f.s.git(["rev-parse", "--abbrev-ref", "HEAD"], a.tree), "fix/a", "nothing changed under the running tests");
  assert.equal(f.s.git(["ls-remote", "--heads", "origin", "fix/a"]), "", "its branch on origin is deleted as before");
  assert.deepEqual(f.pool.trees().map(t => `${t.name} ${t.state}`), ["1 landed", "2 free"]);
  tests.stdin.end(); await once(tests, "exit");f.ownedProcesses.delete(tests.pid!);
  assert.deepEqual(f.pool.prune().released.map(released => `${released.tree.name} ${released.branch}`), ["1 fix/a"]);
  assert.deepEqual(f.pool.trees().map(t => `${t.name} ${t.state}`), ["1 free", "2 free"]);
  assert.equal(f.pool.trees()[0]!.head, f.main(), "at the main it landed as");
  assert.equal(f.s.git(["branch", "--list", "fix/a"]), "", "and its branch here goes with the reset");
});

test("a second service finds the first draining and leaves", async t => {
  const f = service(t);
  let inner: string | undefined;
  const green = f.config.runSteps;
  f.config.runSteps = async options => { inner = (await drain(f.config)).state; return green(options); };
  const a = f.task("fix/a", { "src/a.txt": "a\n" });
  f.submit("fix/a", a.sha);
  await drain(f.config);
  assert.equal(inner, "busy");
});

test("the costs of passing steps are kept by kind of change, and old runs are pruned", t => {
  const f = service(t);
  recordCosts(f.config.home, { state: "green", message: "", run: "", pending: [], wall_s: 1, steps: [
    { name: "build", verdict: "PASS", cpu: 700,cpu_measure:GNU_CPU_MEASURE,wall: 120 }, { name: "tooling", verdict: "PASS", cpu: 500,cpu_measure:STEP_CPU_MEASURE,wall: 240 },
    { name: "tests", verdict: "FAIL", cpu: 9999 } ] }, "rust");
  const costs = JSON.parse(readFileSync(join(f.config.home, "costs.json"), "utf8"));
  assert.deepEqual(costs, { version: 2, steps: { "build:rust": { cpu: 700, cpu_measure:GNU_CPU_MEASURE,wall: 120 }, tooling: { cpu: 500,cpu_measure:STEP_CPU_MEASURE,wall: 240 } } });
  // A run is aged by its own time: kept at three days less a minute, deleted after three.
  const runs = join(f.s.dir, "runs"), old = join(runs, "a-run");
  mkdirSync(old, { recursive: true });
  const made = statSync(old).mtimeMs;
  assert.deepEqual(prune(runs, 3, made + 3 * 86_400_000 - 60_000), []);
  // A red run kept read-only captured inputs (a sealed dependency tree) in its temporary directory.
  const sealed = join(old, "tmp/oracle-dependencies/node-24/tree");
  mkdirSync(join(sealed, "node_modules"), { recursive: true });
  writeFileSync(join(sealed, "node_modules/package.json"), "{}\n");
  chmodSync(join(sealed, "node_modules"), 0o555); chmodSync(sealed, 0o555);
  assert.deepEqual(prune(runs, 3, made + 3 * 86_400_000 + 60_000), [old]);
  assert.equal(existsSync(old), false);
});

test("a change from an issue's branch lands saying Fixes #N, and one from a branch named for no issue lands as it is", async t => {
  const f = service(t);
  const issue = f.task("42-a-task", { "src/a.txt": "a\n" });
  const other = f.task("fix/b", { "src/b.txt": "b\n" });
  const ei = f.submit("42-a-task", issue.sha), eo = f.submit("fix/b", other.sha);
  assert.deepEqual((await drain(f.config)).answered.map(r => r.state), ["landed", "landed"]);
  const ri = f.queue.result(ei.id)!, ro = f.queue.result(eo.id)!;
  assert.notEqual(ri.tip, issue.sha, "a was on main's line, and lands with its issue named");
  assert.equal(f.s.git(["log", "-1", "--format=%B", ri.tip!]), "task 42-a-task\n\nFixes #42");
  assert.deepEqual(f.checked[0], ri.tip, "the commit checked is the commit that lands");
  assert.equal(f.s.git(["log", "-1", "--format=%B", ro.tip!]), "task fix/b");
  assert.equal(f.s.git(["branch", "--list", "42-a-task"]), "", "the task's branch is deleted: everything on it landed");
  assert.equal(f.s.git(["ls-remote", "--heads", "origin", "42-a-task"]), "");
});

test("the checked tip's portable receipt is durable before main is published and pool cleanup starts", async t => {
  const f = service(t), originalRun = f.config.runSteps, originalRelease = f.pool.release.bind(f.pool);
  f.config.runSteps = async options => {
    const ran = await originalRun(options);
    mkdirSync(ran.run, { recursive: true });
    for (const step of ran.steps) writeFileSync(join(ran.run, step.name + ".log"), "");
    return { ...ran, contract: fixtureContract() };
  };
  let observed = false;
  f.pool.release = (...args) => {
    const checked = f.checked.at(-1)!;
    assert.equal(f.main(), checked);
    const receipt = JSON.parse(readFileSync(verdictPath(f.config.home, checked), "utf8")) as LandingVerdict;
    assert.equal(receipt.commit, checked);
    assert.deepEqual(receipt.steps.map(step => step.outcome.name), ["build", "tests", "rustfmt"]);
    assert.deepEqual(receipt.deferred.map(step => step.step), ["integrity"]);
    observed = true;
    return originalRelease(...args);
  };
  const task = f.task("42-portable-verdict", { "src/new.txt": "checked\n" });
  f.submit("42-portable-verdict", task.sha);
  assert.equal((await drain(f.config)).answered[0]!.state, "landed");
  assert.equal(observed, true);
  assert.notEqual(f.checked[0], task.sha);
  assert.equal(existsSync(verdictPath(f.config.home, task.sha)), false);
});


test('the service lands a real memory retry after its build sampler drains',async t=>{
 const {fixture}=await import('./run-fixture.ts');const {runLanding}=await import('./run.ts');
 const run=fixture(t),f=service(t);run.control('rustfmt','pressure');
 f.config.select=()=>({selection:selection(['build','rustfmt']),kind:'other',interop:null,doctests:null});
 // The injected real runner owns an independent repository, and checks its
 // actual commit; the service's task repository owns queue/publication state.
 f.config.runSteps=()=>runLanding(run.options(['build','rustfmt'],{priority:'landing'}));
 const task=f.task('fix/sampler-retry',{'src/retry.txt':'retry control\n'}),entry=f.submit('fix/sampler-retry',task.sha);
 const drained=await drain(f.config);assert.equal(drained.state,'drained');
 const result=f.queue.result(entry.id);assert.ok(result);assert.equal(result.state,'landed',result.message);
 assert.equal(JSON.parse(readFileSync(join(run.run,'landing.json'),'utf8')).state,'green');
 const retry=JSON.parse(readFileSync(join(run.run,'attempt-2/summary.json'),'utf8'));assert.equal(retry.steps.find((row:{name:string})=>row.name==='rustfmt').verdict,'PASS');
 assert.match(readFileSync(join(run.run,'build.log'),'utf8'),/worker drain: .*"stage":"exit"/);
 assert.doesNotMatch(readFileSync(join(run.run,'build.log'),'utf8'),/did not stop within/);
 assert.ok(f.logs.some(line=>line.includes('LANDED')),'service printed its final landing report');
});
