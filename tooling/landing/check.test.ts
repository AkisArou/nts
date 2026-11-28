// The check command's own behaviour: status, withdraw, retry, rerun, and the
// refusals it makes before doing anything.
//
//   node --test tooling/landing/check.test.ts
//
// Each command runs in a child with its own HOME (so the landing home and the
// pool are the test's) and only the variables a command needs. The test holds
// the service's lock itself, so no command starts a service.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname,join } from "node:path";
import { fileURLToPath } from "node:url";
import { acquire } from "./lock.ts";
import { Queue } from "./queue.ts";
import { scratchRepo } from "./scratch-repo.ts";
import {landingStatus,reportLandingStatus} from './status.ts';
import {describePool,Pool,PoolRetry,type PoolOptions} from './pool.ts';
import {TreeOwnershipUnavailable} from './tree-users.ts';
import {hostObservations} from '../gate/host-observations.ts';
import {ownMemory} from '../gate/test-memory.ts';
import { fixture } from './run-fixture.ts';
import { runLanding, type RunOptions } from './run.ts';
import { recordedHost, rerunIn } from './rerun.ts';
import { gitArguments } from '../gate/git-arguments/main.ts';
import { installationCatalogPath, installationCatalogState } from '../inputs/dependency-inputs.ts';

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

test("the command refuses before it acts: usage, policy variables, the removed --here, a rerun outside a pool tree, serve elsewhere", t => {
  const c = cli(t);
  assert.equal(c.run([]).status, 2);
  assert.equal(c.run(["no-such-commit"]).status, 2);
  for(const args of [["HEAD","--trace-rust-inputs"],["HEAD","--dry-run","--trace-rust-inputs"],["status","--trace-rust-inputs"]]){
    const observed=c.run(args);assert.equal(observed.status,2,observed.out);
    assert.match(observed.out,/trace-rust-inputs is an observation of rerun/);
  }
  const policy = c.run(["rerun", "some-id", "--step", "outcomes"], c.s.root, { NTS_GATE_SLOTS: "4" });
  assert.equal(policy.status, 2);
  assert.match(policy.out, /verdict-policy overrides are not allowed.*NTS_GATE_SLOTS/);
  // --here is gone, and says so rather than queueing the commit it names.
  const gone = c.run(["HEAD", "--here"]);
  assert.equal(gone.status, 2, gone.out);
  assert.match(gone.out, /--here is gone: .*check\.ts rerun <id> --step <name>/);
  assert.deepEqual(c.queue.waiting(), []);
  assert.equal(c.run(["rerun", "some-id"]).status, 2, "rerun names its step");
  const outside = c.run(["rerun", "some-id", "--step", "outcomes"]);
  assert.equal(outside.status, 2, outside.out);
  assert.match(outside.out, /rerun runs in a task's pool tree; .* is not one/);
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



/**
 * A refused landing recorded in a run fixture's tree, as the service records
 * one: the runner's own run, with an ANDROID_HOME the caller's shell lacks,
 * and the queue's answer naming that run.
 */
async function refusedLanding(t: TestContext) {
  const f = fixture(t);
  const git = (...args: string[]) => execFileSync("git", gitArguments(args), { cwd: f.tree, env: { ...f.options([]).env, GIT_CONFIG_GLOBAL: "/dev/null" }, encoding: "utf8" }).trim();
  // A pool tree ignores its build output, which the landing's runner writes there.
  writeFileSync(join(f.tree, ".gitignore"), "target/\n");
  git("add", ".");
  git("-c", "user.name=rerun control", "-c", "user.email=rerun@example.invalid", "commit", "-qm", "private rerun inputs");
  // The fixture's node_modules is its source's: the source's catalog authenticates it.
  const source = fileURLToPath(new URL("../..", import.meta.url));
  const sourceShared = dirname(execFileSync("git", gitArguments(["rev-parse", "--path-format=absolute", "--git-common-dir"]), { cwd: source, encoding: "utf8" }).trim());
  const catalog = installationCatalogPath(f.tree, f.tree);
  copyFileSync(installationCatalogPath(sourceShared, source), catalog);
  t.after(() => rmSync(catalog, { force: true }));
  assert.equal(installationCatalogState(f.tree, f.tree).state, "current");
  const commit = git("rev-parse", "HEAD"), android = join(f.own, "android-sdk");
  mkdirSync(android);
  f.control("outcomes", "fail");
  const landed = await runLanding(f.options(["build", "examples", "outcomes"], { commit, env: { ...f.options([]).env, ANDROID_HOME: android } }));
  assert.equal(landed.state, "red", landed.message);
  const home = join(f.own, "landing"), queue = new Queue(home);
  queue.submit(commit);
  const refused = queue.answer(queue.take()!, { state: "refused", message: `red: ${landed.message}`, base: commit, tip: commit, run: landed.run,
    landing: ["build", "examples", "outcomes"], deferred: [], estimate_s: 60 });
  return { f, commit, android, home, queue, id: refused.id };
}

/** `rerunIn` with the fixture's build and owned controls, its printed lines and every runner request it made. */
async function rerunFixture(t: TestContext, r: Awaited<ReturnType<typeof refusedLanding>>, id: string, step: string) {
  const lines: string[] = [], requests: RunOptions[] = [];
  const log = t.mock.method(console, "log", (line: unknown) => { lines.push(String(line)); });
  try {
    const status = await rerunIn(r.f.tree, r.f.tree, id, step, false, new AbortController().signal, {
      home: r.home, owned: r.f.options([]).owned,
      // The fixture's build writes its own target; a pool tree's is its tree's.
      runSteps: (options: RunOptions) => { requests.push(options); return runLanding({ ...options, target: r.f.target, build: r.f.options([]).build }); },
    });
    return { status, out: lines.join("\n"), requests };
  } finally { log.mock.restore(); }
}

test("rerun runs one step of a refused landing in the caller's tree, as the landing ran it, and lands nothing", async t => {
  const r = await refusedLanding(t);
  assert.equal(process.env.ANDROID_HOME === r.android, false, "the caller's shell lacks the recorded ANDROID_HOME");
  const before = r.f.calls().filter(line => line.startsWith("outcomes ")).length;
  const answers = r.queue.results().length;
  const ran = await rerunFixture(t, r, r.id, "outcomes");
  assert.equal(ran.status, 1, ran.out);
  assert.match(ran.out, new RegExp(`rerun outcomes of ${r.id} \\(refused\\): reproduces ${r.id}'s tip ${r.commit.slice(0, 12)}`));
  assert.match(ran.out, /FAIL\s+outcomes/);
  assert.match(ran.out, /red in .* s: outcomes FAIL; log \S*outcomes\.log; .*nothing was queued or landed/);
  const [request] = ran.requests;
  assert.deepEqual(request!.steps, ["build", "outcomes"], "the step, after the build the landing ran");
  assert.equal(request!.commit, r.commit);
  assert.equal(request!.target, join(r.f.tree, "target"));
  assert.equal(request!.priority, "agent");
  assert.equal(request!.env!.ANDROID_HOME, r.android, "the landing's recorded host capability, not the caller's shell");
  assert.ok(request!.run.includes(`rerun-${r.id}-outcomes-`));
  const summary = JSON.parse(readFileSync(join(request!.run, "summary.json"), "utf8"));
  assert.equal(summary.environment.canonical, true);
  assert.equal(summary.environment.host.ANDROID_HOME, r.android);
  assert.deepEqual([...summary.requested].filter((name: string) => name !== "program-oracles"), ["outcomes"]);
  assert.equal(r.f.calls().filter(line => line.startsWith("outcomes ")).length, before + 1);
  assert.equal(r.queue.results().length, answers, "rerun answers nothing in the queue");
  assert.deepEqual(r.queue.waiting(), []);
});

test("rerun refuses what it cannot reproduce, by name, before running anything", async t => {
  const r = await refusedLanding(t);
  const refused = async (id: string, step: string, pattern: RegExp) => {
    const ran = await rerunFixture(t, r, id, step);
    assert.equal(ran.status, 2, ran.out);
    assert.match(ran.out, pattern);
    assert.deepEqual(ran.requests, []);
  };
  await refused("no-such-landing", "outcomes", /no landing answer is no-such-landing/);
  await refused(r.id, "doctests", new RegExp(`doctests was not one of ${r.id}'s steps: build examples outcomes`));
  r.queue.submit(r.commit);
  const landed = r.queue.answer(r.queue.take()!, { state: "landed", message: "LANDED" });
  await refused(landed.id, "outcomes", new RegExp(`rerun diagnoses a refused or held landing; ${landed.id} is landed`));
  // A recorded toolchain path that is gone refuses by name; the caller's shell never stands in for it.
  rmSync(r.android, { recursive: true });
  await refused(r.id, "outcomes", new RegExp(`${r.id}: its recorded ANDROID_HOME ${r.android} no longer exists`));
  mkdirSync(r.android);
  writeFileSync(join(r.f.tree, "README.md"), "edited\n");
  await refused(r.id, "outcomes", /rerun checks a commit, and this tree has uncommitted changes/);
});

test("a recorded environment gives only host capabilities: another name refuses by name", () => {
  const home = fileURLToPath(new URL("../..", import.meta.url));
  assert.deepEqual(recordedHost({ environment: { host: { HOME: home, JAVA_HOME: null, NTS_ORACLE_TYPESCRIPT: "/derived", SSH_AUTH_SOCK: "/gone/agent.sock" } } }),
    { HOME: home, SSH_AUTH_SOCK: "/gone/agent.sock" });
  assert.throws(() => recordedHost({ environment: { host: { HOME: home, NTS_GATE_SLOTS: "4" } } }), /names NTS_GATE_SLOTS, which is not a host capability/);
  assert.throws(() => recordedHost({ environment: { host: { JAVA_HOME: "/no/such/jdk" } } }), /recorded JAVA_HOME \/no\/such\/jdk no longer exists/);
  assert.throws(() => recordedHost({}), /records no host environment/);
});
