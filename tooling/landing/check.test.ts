// The check command's own behaviour: status, withdraw, retry, and the
// refusals it makes before doing anything.
//
//   node --test tooling/landing/check.test.ts
//
// Each command runs in a child with its own HOME (so the landing home and the
// pool are the test's) and only the variables a command needs. The test holds
// the service's lock itself, so no command starts a service.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname,join } from "node:path";
import { fileURLToPath } from "node:url";
import { acquire } from "./lock.ts";
import { Queue } from "./queue.ts";
import { scratchRepo } from "./scratch-repo.ts";
import {landingStatus,reportLandingStatus} from './status.ts';
import {describePool,Pool,type PoolOptions} from './pool.ts';
import {spawnTest} from "../gate/test-wait.ts";
import {fixtureEnvironment} from "../gate/test-environment.ts";
import {hostObservations} from '../gate/host-observations.ts';
import {ownMemory} from '../gate/test-memory.ts';

const CHECK = fileURLToPath(new URL("./check.ts", import.meta.url));

function cli(t: TestContext) {
  const s = scratchRepo(t, "landing-cli");
  const home = join(s.dir, "home"), landing = join(home, ".cache/nts-landing");
  mkdirSync(landing, { recursive: true });
  const env = { PATH: process.env.PATH!, HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@a", GIT_COMMITTER_NAME: "a", GIT_COMMITTER_EMAIL: "a@a" };
  const run = (args: string[], cwd = s.root, extra: Record<string, string> = {}) => {
    const r = spawnSync(process.execPath, [CHECK, ...args], { cwd, env: { ...env, ...extra }, encoding: "utf8" });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  return { s, home, landing, queue: new Queue(landing), run };
}

test("status shows the service, the queue, held changes, recent answers and the pool", t => {
  const c = cli(t);
  const empty = c.run(["status"]);
  assert.equal(empty.status, 0, empty.out);
  assert.match(empty.out, /^service: not running; idle/m);
  assert.match(empty.out, /^waiting \(0\): none$/m);
  const sha = c.s.git(["rev-parse", "HEAD"]);
  const a = c.queue.submit(sha, { branch: "fix/a" }), b = c.queue.submit(sha, { branch: "fix/b", first: true, by: "full-check", note: "revert" });
  c.queue.answer(c.queue.take()!, { state: "held", message: "held: tests INSTRUMENT" });
  const listed = c.run(["status"]);
  assert.match(listed.out, new RegExp(`^ {2}1\\. ${a.id} fix/a by agent$`, "m"));
  assert.match(listed.out, new RegExp(`^ {2}${b.id} fix/b: held: tests INSTRUMENT$`, "m"));
  assert.match(listed.out, /^recent \(1\):/m);
});

test("withdraw answers a waiting change; retry queues a held one first", t => {
  const c = cli(t);
  const sha = c.s.git(["rev-parse", "HEAD"]);
  const a = c.queue.submit(sha), b = c.queue.submit(sha);
  const out = c.run(["withdraw", a.id]);
  assert.equal(out.status, 0, out.out);
  assert.equal(c.queue.result(a.id)?.state, "withdrawn");
  assert.equal(c.run(["withdraw", "nothing-here"]).status, 1);
  c.queue.answer(c.queue.take()!, { state: "held", message: "held" });
  const lock = acquire(join(c.landing, "serve.lock"))!; // a service "is draining"
  t.after(() => lock.release());
  const retried = c.run(["retry", b.id]);
  assert.equal(retried.status, 0, retried.out);
  assert.match(retried.out, /queued again, first; running/);
  assert.deepEqual(c.queue.waiting().map(e => e.id), [b.id]);
});

test("the command refuses before it acts: usage, policy variables, a tree not at the commit, a dirty tree, serve elsewhere", t => {
  const c = cli(t);
  assert.equal(c.run([]).status, 2);
  assert.equal(c.run(["no-such-commit"]).status, 2);
  for(const args of [["HEAD","--trace-rust-inputs"],["HEAD","--dry-run","--trace-rust-inputs"],["status","--here","--trace-rust-inputs"]]){
    const observed=c.run(args);assert.equal(observed.status,2,observed.out);
    assert.match(observed.out,/trace-rust-inputs is an observation of --here/);
  }
  const policy = c.run(["HEAD", "--here"], c.s.root, { NTS_GATE_SLOTS: "4" });
  assert.equal(policy.status, 2);
  assert.match(policy.out, /verdict-policy overrides are not allowed.*NTS_GATE_SLOTS/);
  const behind = c.s.git(["rev-parse", "HEAD"]);
  c.s.commit({ "src/a.txt": "a\n" }, "a");
  assert.match(c.run([behind, "--here"]).out, /runs in a tree at [0-9a-f]{12}; this one is not/);
  writeFileSync(join(c.s.root, "README.md"), "edited\n");
  assert.match(c.run(["HEAD", "--here"]).out, /this tree has uncommitted changes/);
  const elsewhere = join(c.s.dir, "elsewhere");
  c.s.git(["worktree", "add", "-q", "--detach", elsewhere]);
  const serve = c.run(["serve"], elsewhere);
  assert.equal(serve.status, 2);
  assert.match(serve.out, /the service runs from the shared checkout/);
});

test("an answer recorded before refresh requests were counted apart still reads, with none", t => {
  const c = cli(t);
  const sha = c.s.git(["rev-parse", "HEAD"]);
  const old = c.queue.submit(sha, { branch: "42-a-task" });
  c.queue.answer(c.queue.take()!, { state: "landed", message: "LANDED", base: sha, tip: sha, wall_s: 125, estimate_s: 100, landing: ["build"], deferred: [], pending: ["one"] });
  const stored = c.queue.result(old.id)!;
  assert.equal(stored.version, 1);
  assert.equal("refresh" in stored, false, "the answer has the shape written before refresh was kept");
  const out = c.run(["status", "--json"]);
  assert.equal(out.status, 0, out.out);
  const [r] = JSON.parse(out.out).recent;
  assert.deepEqual([r.id, r.pending, r.refresh], [old.id, 1, 0]);
});

test("status --json is the same state, versioned, with numbers as numbers and each answer's task and issue", t => {
  const c = cli(t);
  const sha = c.s.git(["rev-parse", "HEAD"]);
  const landed = c.queue.submit(sha, { branch: "42-a-task" });
  c.queue.answer(c.queue.take()!, { state: "landed", message: "LANDED", base: sha, tip: sha, wall_s: 125, estimate_s: 100, landing: ["build", "tests"], deferred: ["integrity"], pending: ["one"], refresh: ["two", "three"] });
  c.queue.submit(sha, { branch: "fix/b", note: "after it" });
  const out = c.run(["status", "--json"]);
  assert.equal(out.status, 0, out.out);
  const s = JSON.parse(out.out);
  assert.equal(s.version, 2);
  assert.equal(s.kind, "landing");
  assert.deepEqual(s.service, { running: false, pid: null, unit: "nts-landing-check", state: "idle", since: s.service.since, message: null,run:null });
  assert.equal(s.checking, null);
  assert.deepEqual(s.waiting.map((w: { branch: string; issue: number | null; note: string }) => [w.branch, w.issue, w.note]), [["fix/b", null, "after it"]]);
  const [r] = s.recent;
  assert.equal(r.id, landed.id);
  assert.deepEqual([r.state, r.branch, r.issue, r.wall_s, r.estimate_s, r.pending, r.refresh], ["landed", "42-a-task", 42, 125, 100, 1, 2], "numbers as numbers, and the task's issue");
  assert.deepEqual(r.landing, ["build", "tests"]);
  assert.deepEqual(s.day, { landed: 1, refused: 0, held: 0, withdrawn: 0, median_wall_s: 125, max_wall_s: 125 });
  assert.equal(s.main.commit, sha);
  assert.equal("pool" in s, false, "the pool's trees are pool.ts status's to report");
  assert.match(c.run(["status"]).out, /^last day: 1 landed \(median 2\.1 min, longest 2\.1 min\), 0 refused, 0 held, 0 withdrawn$/m, "the text is rendered from the same model");
});

/** A pool with one tree held by a task, under the CLI's HOME, as the commands find it. */
function heldTree(c:ReturnType<typeof cli>,branch:string,users:PoolOptions['users']=()=>[]){
  c.s.commit({'Cargo.toml':'[workspace]\n[profile.nts-dev]\ndebug=0\n','.gitignore':'target/\n'},'fixture build policy');
  const home=join(c.home,'.cache/nts-pool');
  const host=hostObservations(ownMemory(join(c.s.dir,'observations'),{disk:{freeBytes:1000*2**30,freeInodes:2**30}}));
  const pool=new Pool(home,{root:c.s.root,env:c.s.env},undefined,{host,remote:null,reclamation:{services:[],ownership:()=>{}},users});
  pool.init(1);return {pool,tree:pool.take(branch)};
}

/** Every git process a command starts, by its working directory and arguments: a shim ahead of git on PATH logs each one. */
function gitLog(c:ReturnType<typeof cli>){
  const real=process.env.PATH!.split(':').map(dir=>join(dir,'git')).find(path=>existsSync(path));assert.ok(real,'git on PATH');
  const bin=join(c.s.dir,'git-shim'),log=join(c.s.dir,'git.log');mkdirSync(bin,{recursive:true});
  writeFileSync(join(bin,'git'),`#!/bin/sh\nprintf '%s\\t%s\\n' "$(pwd -P)" "$*" >> '${log}'\nexec '${real}' "$@"\n`,{mode:0o755});
  return {run:(args:string[])=>{writeFileSync(log,'');const out=c.run(args,c.s.root,{PATH:`${bin}:${process.env.PATH!}`});
    return {...out,calls:readFileSync(log,'utf8').split('\n').filter(Boolean).map(line=>{const [cwd,argv]=line.split('\t');return {cwd:cwd!,argv:argv!};})};}};
}

test('status --json reads the queue and main alone: no git process in any pool tree; the text form still reads and shows the trees',t=>{
  const c=cli(t);const {pool,tree}=heldTree(c,'819-status');
  const path=realpathSync(tree.path),inTree=(call:{cwd:string;argv:string})=>call.cwd.startsWith(path)||call.argv.includes(tree.path)||call.argv.includes(path);
  const shim=gitLog(c);
  const json=shim.run(['status','--json']);assert.equal(json.status,0,json.out);
  const model=JSON.parse(json.out);assert.equal(model.version,2);assert.equal('pool' in model,false);
  assert.deepEqual(json.calls.filter(inTree),[],'no per-tree git');
  assert.ok(json.calls.length<=4,`a fixed handful of git processes, not one set per tree: ${JSON.stringify(json.calls)}`);
  // Control: the same shim sees the text form's per-tree reads, so it would see the JSON form's.
  const text=shim.run(['status']);assert.equal(text.status,0,text.out);
  assert.ok(text.calls.some(inTree),`the text form reads the tree: ${JSON.stringify(text.calls)}`);
  assert.ok(text.out.includes(`pool ${pool.dir}:\n${describePool(pool.statusTrees())}\n`),text.out);
  assert.match(text.out,new RegExp(`^ {2} 1  ${tree.path}  task 819-status, idle [^,]+$`,'m'),'the tree line as before');
});

test('landing status reports an ownership failure on its tree line and returns success',t=>{
  const c=cli(t),failure=Error('EACCES: supplied unreadable tool process');let unreadable=false;
  const {pool,tree}=heldTree(c,'787-status',()=>{if(unreadable)throw failure;return [{pid:42,command:'worker',where:'its working directory'}];});
  const tip=c.s.git(['rev-parse','HEAD'],tree.path);
  assert.equal(pool.release('787-status',tip).state,'kept');unreadable=true;
  const model=landingStatus(c.s.root,c.landing,0);
  const output:string[]=[];t.mock.method(console,'log',(...values:unknown[])=>output.push(values.map(String).join(' ')));
  assert.equal(reportLandingStatus(model,{pool}),0);
  const text=output.pop()!;assert.ok(text.includes(tree.path));assert.ok(text.includes(failure.message));
  assert.equal(reportLandingStatus(model,{json:true}),0);
  const json=output.pop()!;assert.ok(!json.includes(tree.path),'the JSON form holds no trees');
  assert.throws(()=>pool.trees(),error=>error===failure,'status diagnostics cannot certify ownership for reset');
});


test('a real held-then-green --here run prints its final PASS report and exits zero',t=>{
 const code=`import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {mock} from 'node:test';
const rules=${JSON.stringify(new URL('./rules.ts',import.meta.url).href)},run=${JSON.stringify(new URL('./run.ts',import.meta.url).href)},memory=${JSON.stringify(new URL('./selection-memory.ts',import.meta.url).href)};
const realRules=await import(rules),realRun=await import(run),realMemory=await import(memory);
const {landingSelection}=await import(${JSON.stringify(new URL('./selection.ts',import.meta.url).href)});
import {gitArguments} from '../gate/git-arguments/main.ts';
const {hostEnvironment}=await import(${JSON.stringify(new URL('../gate/host-environment.ts',import.meta.url).href)});
const {fixture}=await import(${JSON.stringify(new URL('./run-fixture.ts',import.meta.url).href)});
const cleanup=[],f=fixture({after(fn){cleanup.push(fn);}});f.control('rustfmt','pressure');
const git=(...args)=>execFileSync('git',gitArguments(args),{cwd:f.tree,env:f.options([]).env,encoding:'utf8'}).trim();
git('add','.');git('-c','user.name=retry control','-c','user.email=retry@example.invalid','commit','-qm','private here retry inputs');
// The fixture's node_modules is its source's, with that source's pins copied:
// the source's own catalog authenticates it, published where --here reads it.
const {installationCatalogPath,installationCatalogState}=await import(${JSON.stringify(new URL('../inputs/dependency-inputs.ts',import.meta.url).href)});
const {copyFileSync,rmSync}=await import('node:fs');const {dirname}=await import('node:path');
const source=${JSON.stringify(fileURLToPath(new URL('../..',import.meta.url)))};
const sourceShared=dirname(execFileSync('git',gitArguments(['rev-parse','--path-format=absolute','--git-common-dir']),{cwd:source,encoding:'utf8'}).trim());
const catalog=installationCatalogPath(f.tree,f.tree);copyFileSync(installationCatalogPath(sourceShared,source),catalog);cleanup.push(()=>rmSync(catalog,{force:true}));
assert.equal(installationCatalogState(f.tree,f.tree).state,'current');
const commit=git('rev-parse','HEAD');let actualRun;
const selection=landingSelection({owed:{steps:['build','rustfmt']},paths:[],catalogue:['build','rustfmt'],table:{build:{form:'as-is'},rustfmt:{form:'as-is'}},inCorpus:()=>false,rows:new Map(),cost:()=>({cpu:1,measured:true,source:'control'}),budget:{slots:24,frontends:24,seconds:600}});
mock.module(rules,{namedExports:{...realRules,ruleSelect:()=>()=>({selection,kind:'other',interop:null,doctests:null})}});
// The selection reserves in the fixture's own ledger, which the run's build then takes it over in.
let selectionHeld;
mock.module(memory,{namedExports:{...realMemory,holdSelection:async(caller,commit,target,options)=>{selectionHeld=await realMemory.holdSelection(caller,commit,target,{...options,env:{...hostEnvironment(f.options([]).env),...f.memory}});return selectionHeld;}}});
mock.module(run,{namedExports:{...realRun,runLanding:options=>{actualRun=options.run;assert.equal(options.handover,selectionHeld);return realRun.runLanding({...options,build:f.options([]).build,owned:f.options([]).owned,env:{...options.env,HOME:f.options([]).env.HOME}});}}});
const before=process.cwd(),beforeEnvironment=process.env;process.env=hostEnvironment(f.options([]).env);process.chdir(f.tree);process.argv=[process.execPath,${JSON.stringify(CHECK)},commit,'--here'];
try{
 await import(${JSON.stringify(new URL('./check.ts',import.meta.url).href)});
 assert.equal(process.exitCode,0);const result=JSON.parse(readFileSync(join(actualRun,'landing.json'),'utf8'));
 assert.equal(result.state,'green');assert.equal(result.steps.find(row=>row.name==='rustfmt').attempt,2);
 const retry=JSON.parse(readFileSync(join(actualRun,'attempt-2/summary.json'),'utf8'));assert.equal(retry.environment.canonical,true);
 assert.equal(retry.steps.find(row=>row.name==='rustfmt').verdict,'PASS');
 assert.match(readFileSync(join(actualRun,'build.log'),'utf8'),/memory: landing build of [0-9a-f]{12} took over landing selection of [0-9a-f]{12} \\(--here\\)'s reservation/);
 assert.equal(selectionHeld.active(),false);
}finally{process.env=beforeEnvironment;process.chdir(before);for(const fn of cleanup.reverse())await fn();}`;
 const imports=process.execArgv.flatMap((argument,index,args)=>argument==='--import'&&args[index+1]?[argument,args[index+1]!] : []);
  const result=spawnTest(process.execPath,[...imports,'--experimental-test-module-mocks','--input-type=module','-e',code],{cwd:dirname(CHECK),encoding:'utf8',env:fixtureEnvironment(t)});
 const output=(result.stdout??'')+(result.stderr??'');assert.equal(result.status,0,output);
 assert.match(output,/PASS\s+build/);assert.match(output,/PASS\s+rustfmt/);assert.match(output,/landing: green in .*green/);
});

test('--here refuses a tree whose installation catalog is not current before it selects or runs a step; a tree that installs nothing runs',t=>{
  const c=cli(t);
  const stale=c.s.commit({'package.json':'{"name":"catalog-refusal","private":true}\n','pnpm-lock.yaml':"lockfileVersion: '9.0'\n"},'a package graph with no published catalog');
  const imports=process.execArgv.flatMap((argument,index,args)=>argument==='--import'&&args[index+1]?[argument,args[index+1]!]:[]);
  // A child with this module's real check command, its selection and runner
  // replaced by recorders, and its rank scope declined, so the order is what is seen.
  const here=(commit:string)=>{
    const code=`import {mock} from 'node:test';
const rules=${JSON.stringify(new URL('./rules.ts',import.meta.url).href)},run=${JSON.stringify(new URL('./run.ts',import.meta.url).href)},scope=${JSON.stringify(new URL('../gate/scopes/bound-slice.ts',import.meta.url).href)},memory=${JSON.stringify(new URL('./selection-memory.ts',import.meta.url).href)};
const realRules=await import(rules),realRun=await import(run),realScope=await import(scope),realMemory=await import(memory);
const {landingSelection}=await import(${JSON.stringify(new URL('./selection.ts',import.meta.url).href)});
const calls=[];
const selection=landingSelection({owed:{steps:['build']},paths:[],catalogue:['build'],table:{build:{form:'as-is'}},inCorpus:()=>false,rows:new Map(),cost:()=>({cpu:1,measured:true,source:'control'}),budget:{slots:24,frontends:24,seconds:600}});
mock.module(rules,{exports:{...realRules,ruleSelect:()=>()=>{calls.push('select');return {selection,kind:'other',interop:null,doctests:null};}}});
mock.module(run,{exports:{...realRun,runLanding:async options=>{calls.push(options.handover===held?'run with the selection':'run');return {state:'green',message:'recorded',steps:[],pending:[],refresh:[],wall_s:0};}}});
mock.module(scope,{exports:{...realScope,rankedScopeArgs:()=>null}});
const held={id:'held',inherited:true,release(){calls.push('release');},closed:Promise.resolve()};
mock.module(memory,{exports:{...realMemory,holdSelection:async caller=>{calls.push('hold '+caller);return held;}}});
process.argv=[process.execPath,${JSON.stringify(CHECK)},${JSON.stringify(commit)},'--here'];
await import(${JSON.stringify(CHECK)});
console.log('calls='+JSON.stringify(calls)+' exit='+process.exitCode);`;
    const r=spawnSync(process.execPath,[...imports,'--experimental-test-module-mocks','--input-type=module','-e',code],{cwd:c.s.root,encoding:'utf8',
      env:{PATH:process.env.PATH!,HOME:c.home,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}});
    return `${r.stdout}${r.stderr}`;
  };
  const refused=here(stale);
  assert.match(refused,/landing: --here runs on this tree's installed packages, and installation catalog is missing; publish with node tooling\/inputs\/linker\.ts work ".*" ".*"/,refused);
  assert.match(refused,/calls=\[\] exit=2/,'no step was selected or run');
  const none=c.s.commit({'package.json':null,'pnpm-lock.yaml':null},'no package graph');
  const ran=here(none);
  assert.match(ran,/calls=\["hold here","select","run with the selection","release"\] exit=0/,ran);
  assert.doesNotMatch(ran,/installation catalog/);
});
