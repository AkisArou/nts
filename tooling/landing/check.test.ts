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
import { spawn, spawnSync } from "node:child_process";
import { once } from 'node:events';
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname,join } from "node:path";
import { fileURLToPath } from "node:url";
import { acquire } from "./lock.ts";
import { Queue } from "./queue.ts";
import { scratchRepo } from "./scratch-repo.ts";
import {landingStatus,reportLandingStatus} from './status.ts';
import {describePool,Pool,PoolRetry,type PoolOptions} from './pool.ts';
import {TreeOwnershipUnavailable} from './tree-users.ts';
import {spawnTest, waitFor} from "../gate/test-wait.ts";
import {fixtureEnvironment} from "../gate/test-environment.ts";
import {hostObservations} from '../gate/host-observations.ts';
import {ownMemory} from '../gate/test-memory.ts';
import { HERE_REF, hereRestore, hereRestorePath } from './here-restore-record.ts';
import { landOne, prepareTree, type Config } from './service.ts';
import { rebaseOnto } from './git.ts';
import { createWithdrawalWatch } from './withdrawal-watch.ts';
import { recordPath } from '../differential/oracle-record-paths.ts';
import { recordsMessage } from '../full-check/records.ts';
import { treeRunLockPath } from '../gate/tree-run-lock.ts';
import { installationCatalogPath, installationIdentityPath } from '../inputs/dependency-inputs.ts';

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
  return { s, home, landing, env, queue: new Queue(landing), run };
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
  const c=cli(t),failure=new TreeOwnershipUnavailable([Error('EACCES: supplied unreadable tool process')]);let unreadable=false;
  const {pool,tree}=heldTree(c,'787-status',()=>{if(unreadable)throw failure;return [{pid:42,command:'worker',where:'its working directory'}];});
  const tip=c.s.git(['rev-parse','HEAD'],tree.path);
  assert.equal(pool.release('787-status',tip).state,'kept');unreadable=true;
  const model=landingStatus(c.s.root,c.landing,0);
  const output:string[]=[];t.mock.method(console,'log',(...values:unknown[])=>output.push(values.map(String).join(' ')));
  assert.equal(reportLandingStatus(model,{pool}),0);
  const text=output.pop()!;assert.ok(text.includes(tree.path));assert.ok(text.includes(failure.message));
  assert.equal(reportLandingStatus(model,{json:true}),0);
  const json=output.pop()!;assert.ok(!json.includes(tree.path),'the JSON form holds no trees');
  assert.equal(pool.trees().find(row=>row.path===tree.path)!.state,'landed','Git state never reads tree users');
  assert.throws(()=>pool.give('787-status'),error=>error instanceof PoolRetry&&error.cause===failure,'status diagnostics cannot certify ownership for reset');
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

function staleCheckout(t: TestContext) {
  const c = cli(t);
  const generated = 'results/gate-inputs/rust-runtime.json';
  c.s.commit({
    [generated]: 'old accepted record\n',
    'worker/anchor': 'task shell stays here\n',
    'tooling/inputs/link.sh': `#!/bin/sh
set -eu
mkdir -p "$3/third_party"
ln -sfn "$(cat "$3/input-pin")" "$3/third_party/corpus"
if [ -n "\${HERE_CONTROL_CATALOG:-}" ]; then
  mkdir -p "$3/node_modules"
  printf 'candidate package\n' > "$3/node_modules/candidate"
  printf 'candidate catalog\n' > "$HERE_CONTROL_CATALOG"
fi
`,
    'input-pin': '../original-input\n',
    'original-input': 'original corpus bytes\n',
    'updated-input': 'main corpus bytes\n',
  }, 'original inputs and generated record');
  const acquired = heldTree(c, 'fix/replay');
  const tree = acquired.tree.path;
  mkdirSync(join(tree, 'third_party'));
  symlinkSync('../original-input', join(tree, 'third_party/corpus'));
  const submitted = c.s.commit({'.gitignore': 'target/\nthird_party/\nnode_modules/\n', 'task-change': 'my edit\n'}, 'task change', tree);
  const main = c.s.commit({[generated]: 'new accepted record\n', 'input-pin': '../updated-input\n'}, 'refresh accepted inputs');
  return { c, tree, submitted, main, generated, pool: acquired.pool };
}

function observedHere(f: Pick<ReturnType<typeof staleCheckout>, 'c' | 'tree' | 'generated'>, effect: 'verdict' | 'wait' | 'advance' = 'verdict') {
  const source = `
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { mock } from 'node:test';
import { gitArguments } from ${JSON.stringify(new URL('../gate/git-arguments/main.ts', import.meta.url).href)};
import { landingSelection } from ${JSON.stringify(new URL('./selection.ts', import.meta.url).href)};
const tree = ${JSON.stringify(f.tree)}, root = ${JSON.stringify(f.c.s.root)}, row = ${JSON.stringify(f.generated)};
const git = (cwd, args) => execFileSync('git', gitArguments(args), { cwd, encoding: 'utf8' }).trim();
const selection = landingSelection({owed:{steps:['records']},paths:[],catalogue:['records'],table:{records:{form:'as-is'}},inCorpus:()=>false,rows:new Map(),cost:()=>({cpu:1,measured:true,source:'control'}),budget:{slots:24,frontends:24,seconds:600}});
const ruleURL = ${JSON.stringify(new URL('./rules.ts', import.meta.url).href)};
mock.module(ruleURL, {exports: {...await import(ruleURL), ruleSelect: () => (base, tip, paths) => {
  assert(!paths.includes(row));
  process.stdout.write('selected ' + base + ' ' + tip + '\\n');
  return {selection, kind:'other', interop:null, doctests:null};
}}});
const scopeURL = ${JSON.stringify(new URL('../gate/scopes/bound-slice.ts', import.meta.url).href)};
mock.module(scopeURL, {exports: {...await import(scopeURL), rankedScopeArgs: () => null}});
const memoryURL = ${JSON.stringify(new URL('./selection-memory.ts', import.meta.url).href)};
mock.module(memoryURL, {exports: {...await import(memoryURL), holdSelection: async () => ({release(){}, closed:Promise.resolve()})}});
const runURL = ${JSON.stringify(new URL('./run.ts', import.meta.url).href)};
mock.module(runURL, {exports: {...await import(runURL), runLanding: async options => {
  const head = git(tree, ['rev-parse', 'HEAD']);
  assert.equal(options.tree, tree);
  assert.equal(options.commit, head);
  assert.deepEqual(options.steps, ['records']);
  const matches = readFileSync(tree + '/' + row, 'utf8').trim() === git(root, ['show', 'refs/heads/main:' + row]);
  process.stdout.write('ran ' + head + ' ' + tree + '\\n');
  if (${JSON.stringify(effect)} === 'wait') {
    writeFileSync(${JSON.stringify(join(f.c.s.dir, 'ran'))}, head);
    await new Promise(resolve => process.stdin.once('data', resolve));
  }
  if (${JSON.stringify(effect)} === 'advance') git(root, ['commit', '--allow-empty', '-qm', 'main moved while checking']);
  return {state:matches?'green':'red', message:matches?'records match':'stale generated row', steps:[], pending:[], refresh:[], wall_s:0};
}}});
process.argv = [process.execPath, ${JSON.stringify(CHECK)}, 'HEAD', '--here'];
await import(${JSON.stringify(new URL('./check.ts', import.meta.url).href)});
`;
  const imports = process.execArgv.flatMap((argument, index, args) => argument === '--import' && args[index + 1] ? [argument, args[index + 1]!] : []);
  return {args: [...imports, '--experimental-test-module-mocks', '--input-type=module', '-e', source], cwd: f.tree, env: f.c.env};
}

function installedInputs(t: TestContext, f: ReturnType<typeof staleCheckout>) {
  const catalog = installationCatalogPath(f.c.s.root, f.tree), originalCatalog = Buffer.from('{ "original catalog": "exact bytes" }\n\n');
  const state = installationIdentityPath(f.c.s.root, f.tree), originalState = '{"version":1,"importers":[".","worker"]}\n';
  mkdirSync(dirname(catalog), {recursive:true});
  writeFileSync(catalog, originalCatalog);
  writeFileSync(state, originalState);
  t.after(() => { rmSync(catalog, {force:true}); rmSync(state, {force:true}); });
  const paths = ['node_modules', 'worker/node_modules'].map(path => join(f.tree, path));
  for (const path of paths) {
    mkdirSync(path);
    writeFileSync(join(path, 'package'), 'original package bytes\n');
    symlinkSync('package', join(path, 'alias'));
  }
  const identity = (path: string) => { const {dev, ino} = lstatSync(path); return {dev, ino}; };
  const original = paths.map(identity);
  Object.assign(f.c.env, {HERE_CONTROL_CATALOG:catalog});
  const verify = () => {
    assert.deepEqual(paths.map(identity), original);
    for (const path of paths) {
      assert.equal(readlinkSync(join(path, 'alias')), 'package');
      assert.equal(readFileSync(join(path, 'alias'), 'utf8'), 'original package bytes\n');
    }
    assert.deepEqual(readFileSync(catalog), originalCatalog);
    assert.equal(readFileSync(state, 'utf8'), originalState);
    assert.equal(existsSync(f.tree + '.here-inputs'), false);
  };
  return {catalog, verify};
}

test('--here checks the queued replay of a stale task, and names the exact tree and range it ran', t => {
  const f = staleCheckout(t), git = {root:f.c.s.root, env:f.c.s.env};
  const queued = rebaseOnto(git, f.main, f.submitted);
  assert.ok('tip' in queued);
  const landingTree = join(f.c.s.dir, 'landing-tree');
  prepareTree(git.root, landingTree, queued.tip, git.env);
  const accepted = f.c.s.git(['show', `refs/heads/main:${f.generated}`]);
  assert.notEqual(readFileSync(join(f.tree, f.generated), 'utf8').trim(), accepted, 'the stale checkout would fail the records verdict');
  assert.equal(readFileSync(join(landingTree, f.generated), 'utf8').trim(), accepted, 'the queued replay passes the records verdict');

  const {args, ...options} = observedHere(f);
  const lock = treeRunLockPath(f.tree);
  mkdirSync(dirname(lock), {recursive:true});
  writeFileSync(lock, `${process.pid} ${f.c.s.dir}/live run\n`);
  const busy = spawnTest(process.execPath, args, {...options, encoding:'utf8'});
  assert.equal(busy.status, 2, busy.stdout + busy.stderr);
  assert.match(busy.stdout, /the gate runner \(pid .*\/live run\) owns .*\.gate-run\.lock/);
  assert.doesNotMatch(busy.stdout, /^ran /m);
  writeFileSync(lock, `2147483647 ${f.c.s.dir}/dead run\n`);
  const ran = spawnTest(process.execPath, args, {...options, encoding:'utf8'});
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  const checked = /ran ([a-f0-9]+) /.exec(ran.stdout)?.[1];
  assert.ok(checked);
  assert.equal(f.c.s.git(['rev-parse', `${checked}^{tree}`]), f.c.s.git(['rev-parse', `${queued.tip}^{tree}`]));
  assert.ok(ran.stdout.includes(`selected ${f.main} ${checked}`));
  const facts = `${f.submitted} as ${checked} on main ${f.main} in ${f.tree}`;
  assert.ok(ran.stdout.includes(`checking ${facts}: records`), ran.stdout);
  assert.ok(ran.stdout.includes(`records match; checked ${facts}`), ran.stdout);
  assert.equal(f.c.s.git(['symbolic-ref', '--short', 'HEAD'], f.tree), 'fix/replay');
  assert.equal(f.c.s.git(['rev-parse', 'HEAD'], f.tree), f.submitted);
  assert.equal(hereRestore(f.tree), null);
  assert.equal(f.c.s.git(['for-each-ref', HERE_REF], f.tree), '');
});

test('--here refuses untracked inputs before selecting or mounting the replay', t => {
  const f = staleCheckout(t), path = join(f.tree, 'tests/programs/untracked.ts');
  mkdirSync(dirname(path), {recursive:true});
  writeFileSync(path, 'export const untracked = 1;\n');
  const {args, ...options} = observedHere(f);
  const result = spawnTest(process.execPath, args, {...options, encoding:'utf8'});
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /tree has uncommitted changes:\n\?\? tests\//);
  assert.doesNotMatch(result.stdout, /^(selected |ran )/m);
  assert.equal(readFileSync(path, 'utf8'), 'export const untracked = 1;\n');
  assert.equal(hereRestore(f.tree), null);
});

test('--here names the issue-stamped tip while running its identical tree in place', t => {
  const c = cli(t), generated = 'row.txt', tree = join(c.s.dir, 'outside-pool');
  const main = c.s.commit({[generated]:'accepted\n'}, 'accepted row');
  c.s.git(['worktree', 'add', '-q', '-b', '123-stamp', tree]);
  const submitted = c.s.commit({'task-change':'one edit\n'}, 'a task without an issue trailer', tree);
  const {args, ...options} = observedHere({c, tree, generated});
  const result = spawnTest(process.execPath, args, {...options, encoding:'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const tip = /selected [a-f0-9]+ ([a-f0-9]+)/.exec(result.stdout)?.[1];
  assert.ok(tip);
  assert.notEqual(tip, submitted);
  assert.equal(c.s.git(['rev-parse', `${tip}^{tree}`]), c.s.git(['rev-parse', `${submitted}^{tree}`]));
  assert.match(c.s.git(['show', '-s', '--format=%B', tip]), /Fixes #123/);
  assert.ok(result.stdout.includes(`ran ${submitted} ${tree}`));
  assert.ok(result.stdout.includes(`checked ${submitted} as ${tip} on main ${main} in ${tree}`));
  assert.equal(c.s.git(['branch', '--show-current'], tree), '123-stamp');
  assert.equal(hereRestore(tree), null);
});

test('--here withdraws an all-left-pending submission with the queued result and no steps', async t => {
  const c = cli(t), fixture = 'tests/programs/changed', source = `${fixture}/main.ts`, generated = recordPath(fixture);
  const measured = c.s.commit({[source]:'export function old() { return 1; }\n'}, 'measure fixture');
  const tree = join(c.s.dir, 'recording');
  c.s.git(['worktree', 'add', '-q', '-b', 'records', tree]);
  c.s.commit({[generated]:'old measurement\n'}, 'record fixture', tree);
  c.s.git(['commit', '--amend', '-qm', recordsMessage({commit:measured, main:measured, part:'core', run:'/runs/core', attempt:1, output:''})], tree);
  const submitted = c.s.git(['rev-parse', 'HEAD'], tree);
  const main = c.s.commit({[source]:'export function added() { return 2; }\n'}, 'change measured source');
  const logs: string[] = [], noCheck = () => assert.fail('a withdrawn submission has no check');
  const config: Config = {home:c.landing, root:c.s.root, remote:null, tree, target:join(tree,'target'), pool:null, env:c.s.env,
    select:noCheck, holdSelection:noCheck, prepare:noCheck, runSteps:noCheck, watchWithdrawals:createWithdrawalWatch, log:line=>logs.push(line)};
  c.queue.submit(submitted, {branch:'records'});
  const queued = await landOne(config, c.queue, c.queue.take()!);
  assert.equal(queued.state, 'withdrawn');
  assert.match(queued.message, /all records were dropped/);

  const {args, ...options} = observedHere({c, tree, generated});
  const local = spawnTest(process.execPath, args, {...options, encoding:'utf8'});
  assert.equal(local.status, 1, local.stdout + local.stderr);
  assert.ok(local.stdout.includes(`landing: ${queued.message}`));
  assert.ok(local.stdout.includes(`landing: ${logs[0]}`));
  assert.doesNotMatch(local.stdout, /^(selected |ran )/m);
  assert.equal(c.s.git(['rev-parse', 'main']), main);
  assert.equal(c.s.git(['rev-parse', 'HEAD'], tree), submitted);
});

test('a killed --here keeps its task reserved and the next invocation restores HEAD and linked bytes', async t => {
  const f = staleCheckout(t), link = join(f.tree, 'third_party/corpus');
  const inputs = installedInputs(t, f);
  const originalLink = readlinkSync(link), originalBytes = readFileSync(link);
  const cwd = join(f.tree, 'worker'), shell = spawn('sh', ['-c', 'printf "ready\\n"; read -r _; pwd -P; cat anchor'], {cwd, env:f.c.env});
  const shellClosed = once(shell, 'close');
  t.after(() => { shell.stdin.end(); return shellClosed; });
  const [ready] = await once(shell.stdout, 'data');
  assert.equal(String(ready), 'ready\n');
  let shellOutput = '';
  shell.stdout.setEncoding('utf8').on('data', data => { shellOutput += data; });

  const {args, ...options} = observedHere(f, 'wait');
  const child = spawn(process.execPath, args, options), closed = once(child, 'close');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); return closed; });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.setEncoding('utf8').on('data', data => { output += data; });
  const runMarker = join(f.c.s.dir, 'ran');
  await waitFor('the detached records step', () => existsSync(runMarker), {stopped:() => child.exitCode === null && child.signalCode === null ? undefined : output});
  const record = hereRestore(f.tree);
  assert.ok(record);
  assert.equal(f.c.s.git(['branch', '--show-current'], f.tree), '');
  assert.equal(f.c.s.git(['rev-parse', HERE_REF], f.tree), record.tip);
  assert.equal(f.c.s.git(['rev-parse', 'refs/heads/fix/replay']), f.submitted);
  assert.equal(readFileSync(link, 'utf8'), 'main corpus bytes\n');
  assert.equal(readFileSync(inputs.catalog, 'utf8'), 'candidate catalog\n');
  assert.equal(readFileSync(join(f.tree, 'node_modules/candidate'), 'utf8'), 'candidate package\n');
  assert.match(f.c.run(['HEAD', '--dry-run'], f.tree).out, /checkout protected by .*here-restore\.json/);
  assert.throws(() => f.pool.take('fix/replay'), /checkout protected by .*here-restore\.json/);
  child.kill('SIGKILL');
  assert.deepEqual(await closed, [null, 'SIGKILL']);
  assert.equal(f.pool.trees()[0]?.branch, 'fix/replay');
  assert.match(f.pool.prune().kept[0]?.why ?? '', /checkout protected by .*here-restore\.json/);
  assert.throws(() => f.pool.give('fix/replay', {discard:true}), /checkout protected by .*here-restore\.json/);
  assert.ok(existsSync(hereRestorePath(f.tree)));

  const {args: recoveryArgs, ...recoveryOptions} = observedHere(f);
  const recovered = spawnTest(process.execPath, recoveryArgs, {...recoveryOptions, encoding:'utf8'});
  assert.equal(recovered.status, 0, recovered.stdout + recovered.stderr);
  assert.ok(recovered.stdout.includes(`restored fix/replay at ${f.submitted} and its inputs in ${f.tree}`));
  assert.equal(f.c.s.git(['symbolic-ref', '--short', 'HEAD'], f.tree), 'fix/replay');
  assert.equal(f.c.s.git(['rev-parse', 'HEAD'], f.tree), f.submitted);
  assert.equal(readlinkSync(link), originalLink);
  assert.deepEqual(readFileSync(link), originalBytes);
  inputs.verify();
  assert.equal(hereRestore(f.tree), null);
  assert.equal(f.c.s.git(['for-each-ref', HERE_REF], f.tree), '');
  shell.stdin.end('continue\n');
  assert.deepEqual(await shellClosed, [0, null]);
  assert.equal(shellOutput, `${cwd}\ntask shell stays here\n`);
});

for (const count of [0, 1]) test(`recovery after SIGKILL with ${count} installation roots parked preserves each original inode`, async t => {
  const f = staleCheckout(t), inputs = installedInputs(t, f);
  const replay = rebaseOnto({root:f.c.s.root, env:f.c.s.env}, f.main, f.submitted);
  assert.ok('tip' in replay);
  const marker = join(f.c.s.dir, 'parked');
  const program = `
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HereCheckout } from ${JSON.stringify(new URL('./here-replay.ts', import.meta.url).href)};
import { GateResource } from ${JSON.stringify(new URL('../gate/gate-resource.ts', import.meta.url).href)};
const tree = process.cwd(), lock = GateResource.tryAcquire(tree + '.lock');
if (!lock) throw Error('fixture tree is busy');
const checkout = new HereCheckout(tree, lock);
const head = checkout.head(), branch = checkout.branch();
const record = checkout.prepare(${JSON.stringify(f.c.s.root)}, 'here-' + head.slice(0,12) + '-1', branch, head, ${JSON.stringify(replay.tip)});
if (${count}) {
  const saved = record.inputs.parked[0];
  mkdirSync(tree + '.here-inputs');
  renameSync(join(tree, saved.path), join(tree + '.here-inputs', saved.slot));
}
writeFileSync(${JSON.stringify(marker)}, 'ready');
await new Promise(resolve => process.stdin.once('data', resolve));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], {cwd:f.tree, env:f.c.env});
  const closed = once(child, 'close');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); return closed; });
  let output = '';
  child.stderr.setEncoding('utf8').on('data', data => { output += data; });
  await waitFor('the parking receipt', () => existsSync(marker), {stopped:() => child.exitCode === null && child.signalCode === null ? undefined : output});
  const record = hereRestore(f.tree);
  assert.equal(record?.version, 2);
  assert.equal(record.phase, 'parking');
  assert.equal(record.inputs.parked.length, 2);
  child.kill('SIGKILL');
  assert.deepEqual(await closed, [null, 'SIGKILL']);
  const recovered = f.c.run(['refs/nts/nonexistent-restore-control', '--here'], f.tree);
  assert.equal(recovered.status, 2, recovered.out);
  assert.match(recovered.out, /restored fix\/replay at .* and its inputs/);
  assert.equal(hereRestore(f.tree), null);
  inputs.verify();
});

test('--here holds a completed check if main advances and refuses a conflict before checkout', t => {
  const f = staleCheckout(t);
  const {args, ...options} = observedHere(f, 'advance');
  const held = spawnTest(process.execPath, args, {...options, encoding:'utf8'});
  const current = f.c.s.git(['rev-parse', 'main']);
  assert.equal(held.status, 3, held.stdout + held.stderr);
  assert.match(held.stdout, /held .* main moved to /);
  assert.ok(held.stdout.includes(`main moved to ${current}`));
  assert.doesNotMatch(held.stdout, /^landing: green/m);
  const conflicting = f.c.s.commit({'task-change':'different edit\n'}, 'conflicting task path on main');
  const refused = spawnTest(process.execPath, args, {...options, encoding:'utf8'});
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.ok(refused.stdout.includes(`conflicts with main ${conflicting.slice(0, 12)}`));
  assert.match(refused.stdout, /task-change/);
  assert.doesNotMatch(refused.stdout, /^(selected |ran )/m);
  assert.equal(f.c.s.git(['rev-parse', 'HEAD'], f.tree), f.submitted);
  assert.equal(hereRestore(f.tree), null);
});
