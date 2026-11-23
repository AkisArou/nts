import {gitArguments} from "../gate/git-arguments/main.ts";
import {fixtureEnvironment} from "../gate/test-environment.ts";
// The worktree pool, elastic: take (reusing a warm tree, else growing while
// the disk allows), give back, discard, release after landing, the upkeep that
// removes idle trees, and status.
//
//   node --test tooling/landing/pool.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COLD_TARGET_BYTES, describePool, DISK_MARGIN_BYTES, IDLE_LIMIT_MS, Pool, PoolFull, PoolRetry, poolExit, pruneLines, TreeInUse, reportPoolStatus, statusJson, WARM_MINIMUM, type PoolOptions } from "./pool.ts";
import {treeProcessFixture} from './tree-users-fixture.ts';
import {treeUsers} from "./tree-users.ts";
import { scratchRepo } from "./scratch-repo.ts";
import {ownMemory} from '../gate/test-memory.ts';
import {hostObservations} from '../gate/host-observations.ts';
import {completeBuild} from '../gate/build-completion.ts';
import {generatedJavaScript} from '../gate/generated-javascript.ts';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {lockChild,replaceOnce,LOCK_BARRIER} from './lock-fixture.ts';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {workerPresence,workerPresenceFile} from './pool-presence.ts';
import {DISK_TRASH} from '../gate/disk-reclamation.ts';
import {GateResource} from '../gate/gate-resource.ts';
import {cargoSync} from '../gate/cargo.ts';
import {spawnTest} from '../gate/test-wait.ts';

const GB = 2 ** 30, DAY = 86_400_000;
/** The tests' "now": git's clock and every idle time are read against it, never the machine's. */
const NOW = Date.parse("2026-11-06T12:00:00Z");

function pool(t: Parameters<typeof scratchRepo>[0], size = 2, options: PoolOptions = {}) {
  const s = scratchRepo(t, "landing-pool");
  // A tree's cargo target is ignored, as the repository's .gitignore has it.
  s.commit({ ".gitignore": "target/\n", "Cargo.toml":"[workspace]\n[profile.nts-dev]\ndebug=0\n" }, "ignore targets");
  const linked: string[] = [];
  const inputs = (tree: string) => { linked.push(tree); };
  /** Git's clock `ago` ms before NOW, for what a tree did then. */
  const clock = (ago: number) => ({ ...s.env, GIT_COMMITTER_DATE: `@${Math.floor((NOW - ago) / 1000)} +0000` });
  const observationRoot=join(s.dir,'observations');
  const observations=ownMemory(observationRoot,{disk:{freeBytes:1000*GB,freeInodes:2**30}});
  const host=options.host??hostObservations({...s.env,...observations});
  const p = new Pool(join(s.dir, "pool"), { root: s.root, env: clock(0) }, inputs, {users:()=>[],reclamation:{services:[],ownership:()=>{}},...options,host});
  if (size) p.init(size);
  /** The same pool, `ago` ms before NOW. */
  const at = (ago: number) => new Pool(p.dir, { root: s.root, env: clock(ago) }, inputs, {users:()=>[],reclamation:{services:[],ownership:()=>{}},...options,host});
  /** Free tree `name` was last given back `ago` ms before NOW: a task's branch on it, then main again. */
  const freedAt = (name: string, ago: number) => {
    const cwd = join(p.dir, name), env = clock(ago);
    for (const args of [["switch", "-q", "-c", `task-${name}`], ["switch", "-q", "--detach", "refs/heads/main"], ["branch", "-q", "-D", `task-${name}`]]) execFileSync("git", gitArguments(args), { cwd, env });
  };
  return { s, p, linked, at, freedAt,
    observe:(disk: {freeBytes:number;freeInodes:number},paths:Record<string,number>={})=>ownMemory(observationRoot,{disk,allocated:{kind:'fixed',defaultBytes:0,paths}}) };
}
const names = (p: Pool) => p.trees().map(t => `${t.name} ${t.state}${t.branch ? ` ${t.branch}` : ""}`);

test("init prewarms the missing trees, detached at main, each with its inputs", t => {
  const { s, p, linked } = pool(t, 3);
  const trees = p.trees();
  assert.deepEqual(trees.map(t => `${t.name} ${t.state}`), ["1 free", "2 free", "3 free"]);
  assert.deepEqual(linked, trees.map(t => t.path));
  const main = s.git(["rev-parse", "main"]);
  assert.ok(trees.every(t => t.head === main && t.branch === null));
  p.init(3);
  assert.equal(linked.length, 3, "a tree that exists is left as it is");
  assert.throws(() => p.init(0), /a pool of 0 trees/);
});

test("a task takes a free tree on its branch at the newest main, keeps it, and the pool grows when every tree is held", t => {
  const { s, p, linked } = pool(t);
  const newer = s.commit({ "src/a.txt": "a\n" }, "main moved");
  const one = p.take("fix/a");
  assert.equal(one.name, "1");
  assert.equal(one.branch, "fix/a");
  assert.equal(s.git(["rev-parse", "fix/a"]), newer, "the branch starts at the newest main");
  assert.ok(existsSync(join(one.path, "src/a.txt")));
  assert.equal(linked.at(-1), one.path, "its inputs are linked again");
  assert.equal(p.take("fix/a").name, "1", "asking again is the same tree");
  assert.equal(p.take("fix/b").name, "2");
  // Every tree held: a new one, past what init made.
  const three = p.take("fix/c");
  assert.equal(three.name, "3");
  assert.equal(three.path, join(p.dir, "3"));
  assert.equal(s.git(["rev-parse", "fix/c"]), newer);
  assert.ok(linked.includes(three.path), "a new tree gets its inputs");
  assert.deepEqual(names(p), ["1 held fix/a", "2 held fix/b", "3 held fix/c"]);
  assert.throws(() => p.take("main"), /not a task branch/);
  // A task's branch that already exists is checked out as it is.
  s.git(["branch", "fix/old", "main~1"]);
  p.give("fix/b");
  const old = p.take("fix/old");
  assert.equal(old.name, "2", "a free tree before a new one");
  assert.equal(old.head, s.git(["rev-parse", "main~1"]));
  assert.equal(old.behind, 1);
});

test("a free tree with a warm target is taken before a cold one", t => {
  const { p } = pool(t, 3);
  for(const name of ['nts-dev','clippy'] as const){const output=join(p.dir,'3','target',name);mkdirSync(output,{recursive:true});completeBuild(join(p.dir,'3'),name,output);}
  assert.equal(p.take("fix/a").name, "3");
  assert.equal(p.take("fix/b").name, "1");
});

test('attach, detach and take own worker presence while status stays read-only',t=>{
  const {p}=pool(t,1),tree=p.take('884'),file=workerPresenceFile(tree.path);
  assert.equal(workerPresence(tree.path,'884').state,'attached');assert.equal(p.room().reservedBytes,COLD_TARGET_BYTES);
  p.detach('884');const bytes=readFileSync(file,'utf8');
  assert.equal(p.room().reservedBytes,0);assert.equal(p.capacity.activeLeases().length,0);
  const trees=p.measured(p.statusTrees()),status=statusJson(p.dir,trees,p.room(trees),NOW);
  assert.equal(status.version,2);assert.equal(status.trees[0]!.worker_presence,'detached');
  assert.equal(readFileSync(file,'utf8'),bytes,'status never attaches a worker');
  p.attach('884');assert.equal(workerPresence(tree.path,'884').state,'attached');
  p.detach('884');assert.equal(p.take('884').path,tree.path);assert.equal(workerPresence(tree.path,'884').state,'attached');
  assert.equal(p.capacity.activeLeases().length,1);
  assert.throws(()=>p.detach('absent'),/no pool tree holds/);
  for(const body of [null,'{broken',JSON.stringify({version:99})]){
    if(body===null)rmSync(file);else writeFileSync(file,body);
    assert.equal(p.room().reservedBytes,COLD_TARGET_BYTES);
    const status=statusJson(p.dir,p.measured(p.statusTrees()),p.room(),NOW);
    assert.equal(status.trees[0]!.worker_presence,body===null?'attached':'unknown');
    if(body===null){assert.equal(status.trees[0]!.presence_diagnostic,null);assert.equal(existsSync(file),false);}
    else{assert.match(status.trees[0]!.presence_diagnostic!,/worker.json/);assert.equal(readFileSync(file,'utf8'),body);}
  }
  assert.throws(()=>p.attach('884'),/unsupported future state version/);
});

test('the CLI attach/detach verbs and take --issue preserve the branch and status v2 bytes with the count active',t=>{
  const f=pool(t,1),{p,s}=f,tree=p.take('884');
  const {env,log}=poolCliEnvironment(f);
  const cli=(...args:string[])=>{
    const result=spawnTest(process.execPath,[fileURLToPath(new URL('./pool.ts',import.meta.url)),...args,'--pool',p.dir],{cwd:s.root,env,encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);return result.stdout;
  };
  assert.match(cli('detach','884'),/task 884: detached/);
  const before=readFileSync(workerPresenceFile(tree.path),'utf8');
  const status=JSON.parse(cli('status','--json'));assert.equal(status.version,2);assert.equal(status.trees[0].worker_presence,'detached');
  assert.equal(readFileSync(workerPresenceFile(tree.path),'utf8'),before);
  assert.match(cli('attach','884'),/task 884: attached/);
  cli('detach','884');cli('take','--issue','884');
  assert.equal(workerPresence(tree.path,'884').state,'attached');assert.equal(s.git(['branch','--show-current'],tree.path),'884');
  assert.match(readFileSync(log,'utf8'),/busctl.*ExecStart/,'detach queried the supplied active count');
  for(const command of ['systemctl','busctl']){
    const unexpected=spawnTest(command,['unsupplied-observation'],{env,encoding:'utf8'});
    assert.notEqual(unexpected.status,0);
    assert.match(unexpected.stderr,new RegExp('unsupplied '+command+' request.*unsupplied-observation'));
  }
});

for(const action of ['take','attach'] as const)test('reattachment cannot spend another cold task promise: '+action,t=>{
  const {p,observe}=pool(t,2),tree=p.take('884'),target=join(tree.path,'target');
  mkdirSync(target);writeFileSync(join(target,'CACHEDIR.TAG'),'Signature: 8a477f597d28d172789f06886806bc55\n');
  for(const name of ['nts-dev','clippy'] as const){const output=join(target,name);mkdirSync(output);completeBuild(tree.path,name,output);}
  p.detach('884');observe({freeBytes:44*GB,freeInodes:1000});
  assert.ok(p.capacity.reclaim(p.dir)!.removed.some(row=>row.kind==='detached-build-output'));
  assert.equal(existsSync(target),false);
  observe({freeBytes:DISK_MARGIN_BYTES+COLD_TARGET_BYTES,freeInodes:1000});
  const other=p.take('885'),record=readFileSync(workerPresenceFile(tree.path),'utf8');
  assert.equal(p.capacity.snapshot(p.dir).availableBytes,0,'the one available cold promise belongs to B');
  assert.throws(()=>p[action]('884'),error=>error instanceof PoolFull);
  assert.equal(readFileSync(workerPresenceFile(tree.path),'utf8'),record,'refusal leaves A detached');
  assert.equal(p.capacity.snapshot(p.dir).availableBytes,0,'A cannot overcommit B\'s admitted promise');
  const release=p.capacity.beginBuild({root:other.path,target:join(other.path,'target')});release();
  observe({freeBytes:DISK_MARGIN_BYTES+2*COLD_TARGET_BYTES,freeInodes:1000});
  assert.equal(p[action]('884').presence!.state,'attached','capacity returning permits a retry');
  assert.equal(p.capacity.snapshot(p.dir).availableBytes,0);
});

for(const action of ['take','attach'] as const)for(const output of ['cold','partial'] as const)test('an already-counted lease stays accessible under pressure: '+action+' '+output,t=>{
  const {p,s,observe}=pool(t,1),tree=p.take('884');
  if(output==='partial'){
    const profile=join(tree.path,'target/nts-dev');mkdirSync(profile,{recursive:true});completeBuild(tree.path,'nts-dev',profile);
  }
  writeFileSync(join(tree.path,'notes.txt'),'uncommitted task work');
  const promised=p.capacity.snapshot(p.dir).reservedBytes;assert.ok(promised>0);
  observe({freeBytes:DISK_MARGIN_BYTES+promised-1,freeInodes:1000});
  const record=readFileSync(workerPresenceFile(tree.path),'utf8'),inode=lstatSync(workerPresenceFile(tree.path)).ino,changes=s.git(['status','--porcelain'],tree.path);
  const resumed=p[action]('884');
  assert.equal(resumed.path,tree.path);assert.equal(resumed.head,tree.head);assert.equal(resumed.presence!.state,'attached');
  assert.equal(readFileSync(workerPresenceFile(tree.path),'utf8'),record);
  assert.equal(lstatSync(workerPresenceFile(tree.path)).ino,inode,'idempotent access publishes no replacement record');
  assert.equal(s.git(['status','--porcelain'],tree.path),changes);
  assert.equal(p.capacity.snapshot(p.dir).reservedBytes,promised,'the existing promise stays counted exactly once');
  assert.equal(p.capacity.snapshot(p.dir).availableBytes,-1,'the idempotent operation neither spends nor frees capacity');
});

test('an already-counted lease stays accessible while its resource is in use',t=>{
  const {p}=pool(t,1),tree=p.take('884'),file=workerPresenceFile(tree.path),record=readFileSync(file,'utf8');
  const lock=GateResource.tryAcquire(tree.path+'.lock');assert.ok(lock);
  try{
    assert.equal(p.take('884').path,tree.path);assert.equal(p.attach('884').path,tree.path);
    assert.equal(readFileSync(file,'utf8'),record);
  }finally{lock.close();}
});

test('a landed hold still needs admission when taken again',t=>{
  let busy=false;
  const {p,observe}=pool(t,2,{users:()=>busy?[{pid:42,command:'worker',where:'its working directory'}]:[]});
  const tree=p.take('884');busy=true;assert.equal(p.release('884',tree.head).state,'kept');busy=false;
  assert.equal(p.trees().find(row=>row.path===tree.path)!.state,'landed');
  observe({freeBytes:DISK_MARGIN_BYTES+COLD_TARGET_BYTES,freeInodes:1000});p.take('885');
  const record=readFileSync(workerPresenceFile(tree.path),'utf8');
  assert.throws(()=>p.take('884'),PoolFull);
  assert.equal(p.trees().find(row=>row.path===tree.path)!.state,'landed');
  assert.equal(readFileSync(workerPresenceFile(tree.path),'utf8'),record);
  assert.equal(p.capacity.snapshot(p.dir).availableBytes,0);
  observe({freeBytes:DISK_MARGIN_BYTES+2*COLD_TARGET_BYTES,freeInodes:1000});
  assert.equal(p.take('884').state,'held');assert.equal(p.capacity.snapshot(p.dir).availableBytes,0);
});

/** The CLI owns its unit observations, including an active hourly count.
 * Unknown queries fail by name; neither shim can reach the user's manager. */
function poolCliEnvironment(f:ReturnType<typeof pool>){
  const bin=join(f.s.dir,'unit-tools'),log=join(f.s.dir,'unit-queries.jsonl');mkdirSync(bin,{recursive:true});
  const unit='nts-full-check-count.service',object='/org/freedesktop/systemd1/unit/nts_2dfull_2dcheck_2dcount_2eservice';
  const properties=[{type:'s',data:'/outside/controller'},{type:'s',data:''},{type:'a(sasbttttuii)',data:[]},
    {type:'a(sasbttttuii)',data:[['/usr/bin/flock',['/usr/bin/flock','--shared','/outside/controller.lock','/usr/bin/node','/outside/controller/tooling/full-check/service.ts','--count'],false,0,0,0,0,0,0,0]]},
    {type:'a(sasbttttuii)',data:[]}].map(row=>JSON.stringify(row)).join('\n')+'\n';
  const bus=['--user','--json=short'];
  const replies={
    systemctl:[{args:['--user','list-units','--all','--type=service','--output=json'],text:JSON.stringify([{unit,active:'active'}])}],
    busctl:[{args:[...bus,'call','org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',unit],text:JSON.stringify({type:'o',data:[object]})},
      {args:[...bus,'get-property','org.freedesktop.systemd1',object,'org.freedesktop.systemd1.Service','WorkingDirectory','RootDirectory','ExecStartPre','ExecStart','ExecStartPost'],text:properties}],
  };
  for(const [command,observations] of Object.entries(replies))writeFileSync(join(bin,command),generatedJavaScript(`#!${process.execPath}
import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2),command=${JSON.stringify(command)};
appendFileSync(${JSON.stringify(log)},JSON.stringify({command,args})+'\\n');
const reply=${JSON.stringify(observations)}.find(row=>JSON.stringify(row.args)===JSON.stringify(args));
if(reply)process.stdout.write(reply.text);
else {process.stderr.write('unsupplied '+command+' request: '+JSON.stringify(args)+'\\n');process.exitCode=1;}
`),{mode:0o755});
  return {env:{...f.s.env,...f.observe({freeBytes:1000*GB,freeInodes:1000}),PATH:bin+':'+f.s.env.PATH},log};
}

/** pool.ts's own CLI on the fixture's pool: its exit status and output, through main's exit mapping. */
const poolCli=(f:ReturnType<typeof pool>,...args:string[])=>spawnTest(process.execPath,[fileURLToPath(new URL('./pool.ts',import.meta.url)),...args,'--pool',f.p.dir],
  {cwd:f.s.root,env:poolCliEnvironment(f).env,encoding:'utf8'});
const inUse=(tree:string)=>(error:unknown)=>error instanceof TreeInUse&&error instanceof PoolRetry&&poolExit(error)===75&&error.tree===tree
  &&error.message.includes('tree resource lock is held for '+tree);

for(const action of ['take','attach'] as const)test('a landed tree whose resource lock is held refuses for retry, unchanged, and resumes once released: '+action,t=>{
  let busy=false;
  const f=pool(t,1,{users:()=>busy?[{pid:42,command:'worker',where:'its working directory'}]:[]}),{p,s}=f;
  const tree=p.take('884');busy=true;assert.equal(p.release('884',tree.head).state,'kept');busy=false;
  const file=workerPresenceFile(tree.path),record=readFileSync(file,'utf8'),inode=lstatSync(file).ino,reserved=p.room().reservedBytes;
  const unchanged=()=>{
    const row=p.trees().find(row=>row.path===tree.path)!;
    assert.deepEqual([row.state,row.branch,row.head,p.landed().get('884')],['landed','884',tree.head,tree.head]);
    assert.equal(readFileSync(file,'utf8'),record);assert.equal(lstatSync(file).ino,inode,'no replacement record is published');
    assert.equal(s.git(['status','--porcelain'],tree.path),'');assert.equal(p.room().reservedBytes,reserved,'no promise is admitted');
  };
  const lock=GateResource.tryAcquire(tree.path+'.lock');assert.ok(lock);
  try{
    assert.throws(()=>p[action]('884'),inUse(tree.path));unchanged();
    const cli=poolCli(f,action,'884');
    assert.equal(cli.status,75,cli.stdout+cli.stderr);assert.ok(cli.stderr.includes('tree resource lock is held for '+tree.path),cli.stderr);unchanged();
  }finally{lock.close();}
  const resumed=p[action]('884');
  assert.deepEqual([resumed.state,resumed.presence!.state,p.landed().size],['held','attached',0]);
  assert.equal(p.room().reservedBytes,reserved+COLD_TARGET_BYTES,'the resumed cold promise is counted');
});

test('a fresh take of a free tree whose resource lock is held refuses for retry with the tree untouched',t=>{
  const f=pool(t,1),{p,s}=f,path=join(p.dir,'1');
  const observed=()=>({head:s.git(['rev-parse','HEAD'],path),branch:s.git(['branch','--show-current'],path),
    status:s.git(['status','--porcelain','--untracked-files=all','--ignored'],path),worktrees:s.git(['worktree','list','--porcelain'],s.root),
    branches:s.git(['for-each-ref','--format=%(refname) %(objectname)','refs/heads/'],s.root),presence:existsSync(workerPresenceFile(path)),
    reserved:p.room().reservedBytes});
  const before=observed();assert.equal(before.branch,'');assert.equal(before.presence,false);
  const lock=GateResource.tryAcquire(path+'.lock');assert.ok(lock);
  try{
    assert.throws(()=>p.take('914'),inUse(path));assert.deepEqual(observed(),before);
    const cli=poolCli(f,'take','--issue','914');
    assert.equal(cli.status,75,cli.stdout+cli.stderr);assert.ok(cli.stderr.includes('tree resource lock is held for '+path),cli.stderr);
    assert.deepEqual(observed(),before);
  }finally{lock.close();}
  const taken=p.take('914');
  assert.deepEqual([taken.name,taken.state,taken.branch,taken.presence!.state],['1','held','914','attached']);
  assert.equal(p.room().reservedBytes,COLD_TARGET_BYTES);
});

for(const action of ['take','attach'] as const)test('a reclaimed landed hold reserves its admitted promise before another take: '+action,t=>{
  let busy=false;
  const {p,s,observe}=pool(t,3,{users:()=>busy?[{pid:42,command:'worker',where:'its working directory'}]:[]});
  const tree=p.take('884'),target=join(tree.path,'target');
  mkdirSync(target);writeFileSync(join(target,'CACHEDIR.TAG'),'Signature: 8a477f597d28d172789f06886806bc55\n');
  for(const name of ['nts-dev','clippy'] as const){const output=join(target,name);mkdirSync(output);completeBuild(tree.path,name,output);}
  p.detach('884');busy=true;assert.equal(p.release('884',tree.head).state,'kept');busy=false;
  assert.equal(p.trees().find(row=>row.path===tree.path)!.state,'landed');
  observe({freeBytes:44*GB,freeInodes:1000});
  assert.ok(p.capacity.reclaim(p.dir)!.removed.some(row=>row.kind==='detached-build-output'&&row.root===target));
  assert.equal(existsSync(target),false);
  observe({freeBytes:DISK_MARGIN_BYTES+COLD_TARGET_BYTES,freeInodes:1000});p.take('885');
  const file=workerPresenceFile(tree.path),record=readFileSync(file,'utf8'),inode=lstatSync(file).ino;
  assert.throws(()=>p[action]('884'),PoolFull);
  assert.equal(p.trees().find(row=>row.path===tree.path)!.state,'landed');
  assert.equal(readFileSync(file,'utf8'),record);assert.equal(lstatSync(file).ino,inode);
  assert.equal(p.capacity.snapshot(p.dir).availableBytes,0,'the other task keeps its admitted promise');
  observe({freeBytes:DISK_MARGIN_BYTES+2*COLD_TARGET_BYTES,freeInodes:1000});
  assert.equal(p[action]('884').presence!.state,'attached');
  assert.throws(()=>p.take('886'),PoolFull,'the admitted remainder is already reserved before the worker commits');
  assert.equal(p.trees().find(row=>row.path===tree.path)!.state,'held');
  assert.equal(p.capacity.snapshot(p.dir).availableBytes,0);
  assert.equal(p.room().reservedBytes,2*COLD_TARGET_BYTES,'both lease owners count the restored promise immediately');
  writeFileSync(join(tree.path,'resumed.txt'),'resumed task work\n');
  s.git(['add','resumed.txt'],tree.path);s.git(['commit','-qm','resume task'],tree.path);
  assert.equal(p.trees().find(row=>row.path===tree.path)!.state,'held');
  assert.equal(p.capacity.snapshot(p.dir).availableBytes,0,'the resumed hold fits beside the other promise');
});

test('reattachment admits only the partial promise and leaves complete output alone under pressure',t=>{
  const {p,observe}=pool(t,1),tree=p.take('884'),target=join(tree.path,'target');
  mkdirSync(target);writeFileSync(join(target,'CACHEDIR.TAG'),'Signature: 8a477f597d28d172789f06886806bc55\n');
  for(const name of ['nts-dev','clippy'] as const){const output=join(target,name);mkdirSync(output);completeBuild(tree.path,name,output);}
  p.detach('884');observe({freeBytes:DISK_MARGIN_BYTES-1,freeInodes:1000});
  assert.equal(p.attach('884').presence!.state,'attached','completed output adds no promise even under pressure');
  assert.ok(existsSync(join(target,'nts-dev/.nts-complete.json')));
  p.detach('884');rmSync(join(target,'clippy'),{recursive:true});
  const needed=p.capacity.snapshot(p.dir,[{root:tree.path,target}]).reservedBytes;
  assert.ok(needed>0&&needed<COLD_TARGET_BYTES);
  observe({freeBytes:DISK_MARGIN_BYTES+needed-1,freeInodes:1000});
  const record=readFileSync(workerPresenceFile(tree.path),'utf8');
  assert.throws(()=>p.attach('884'),PoolFull);
  assert.equal(readFileSync(workerPresenceFile(tree.path),'utf8'),record);
  assert.ok(existsSync(join(target,'nts-dev/.nts-complete.json')),'the requested partial target is protected during reclaim');
  observe({freeBytes:DISK_MARGIN_BYTES+needed,freeInodes:1000});
  p.attach('884');assert.equal(p.capacity.snapshot(p.dir).reservedBytes,needed);
});

test('another builder consuming its admitted bytes cannot fund a reattachment',t=>{
  const {p,observe}=pool(t,2),a=p.take('884'),b=p.take('885');p.detach('884');
  observe({freeBytes:DISK_MARGIN_BYTES+COLD_TARGET_BYTES,freeInodes:1000});
  const original=p.capacity.poolSnapshot.bind(p.capacity);let completed=false;
  p.capacity.poolSnapshot=(path,leases)=>{
    const snapshot=original(path,leases);
    if(!completed){
      completed=true;
      for(const name of ['nts-dev','clippy'] as const){const output=join(b.path,'target',name);mkdirSync(output,{recursive:true});completeBuild(b.path,name,output);}
      observe({freeBytes:DISK_MARGIN_BYTES,freeInodes:1000});
    }
    return snapshot;
  };
  const record=readFileSync(workerPresenceFile(a.path),'utf8');
  assert.throws(()=>p.attach('884'),PoolFull);assert.ok(completed);
  assert.equal(readFileSync(workerPresenceFile(a.path),'utf8'),record);assert.equal(p.capacity.snapshot(p.dir).availableBytes,0);
});

test('reattachment reclaims other approved output before refusing the requested lease',t=>{
  const f=pool(t,2),tree=f.p.take('884'),free=join(f.p.dir,'2'),debug=join(free,'target/debug');
  f.p.detach('884');mkdirSync(debug,{recursive:true});
  writeFileSync(join(free,'target/CACHEDIR.TAG'),'Signature: 8a477f597d28d172789f06886806bc55\n');
  const host={...f.p.capacity.host,disk:(path:string)=>({...f.p.capacity.host.disk(path),freeBytes:DISK_MARGIN_BYTES+COLD_TARGET_BYTES-1+(existsSync(debug)?0:2*GB)})};
  const p=new Pool(f.p.dir,f.p.git,()=>{},{host,users:()=>[],reclamation:{services:[],ownership:()=>{}}});
  p.attach('884');assert.equal(workerPresence(tree.path,'884').state,'attached');assert.equal(existsSync(debug),false);
  assert.ok(p.capacity.snapshot(p.dir).availableBytes>=0);
});

test('a held take recovers inputs after presence publication failed on a fresh take',t=>{
  const {p,linked}=pool(t,1),tree=join(p.dir,'1'),file=workerPresenceFile(tree);
  writeFileSync(file,JSON.stringify({version:99}));const before=linked.length;
  assert.throws(()=>p.take('884'),/unsupported future state version/);
  assert.equal(p.trees()[0]!.branch,'884');assert.equal(linked.length,before);
  rmSync(file);p.take('884');assert.equal(linked.length,before+1);assert.equal(linked.at(-1),tree);
});

test('ending a hold removes presence on give, landing reset and landed upkeep',t=>{
  let busy=false;
  const {p}=pool(t,2,{users:()=>busy?[{pid:42,command:'worker',where:'its working directory'}]:[]});
  const first=p.take('884');p.detach('884');p.give('884');assert.equal(existsSync(workerPresenceFile(first.path)),false);
  const second=p.take('885');p.release('885',second.head);assert.equal(existsSync(workerPresenceFile(second.path)),false);
  const third=p.take('886');busy=true;assert.equal(p.release('886',third.head).state,'kept');
  assert.ok(existsSync(workerPresenceFile(third.path)));busy=false;p.prune({now:NOW});
  assert.equal(existsSync(workerPresenceFile(third.path)),false);
});

test('ending a hold refuses a future presence version before changing Git',t=>{
  const {p,s}=pool(t,1),tree=p.take('884'),file=workerPresenceFile(tree.path),future=JSON.stringify({version:99});
  writeFileSync(file,future);
  assert.throws(()=>p.give('884'),/unsupported future state version/);
  assert.throws(()=>p.release('884',tree.head),/unsupported future state version/);
  assert.equal(s.git(['branch','--show-current'],tree.path),'884');assert.equal(readFileSync(file,'utf8'),future);
});

test('detach refuses live process, unit, claim and resource owners by name',async t=>{
  const f=pool(t,1),tree=f.p.take('884');
  const child=spawn('cat',[],{cwd:tree.path,env:f.s.env,stdio:['pipe','ignore','pipe']}),exited=once(child,'exit');
  try{
    await once(child,'spawn');
    const owned=new Pool(f.p.dir,f.p.git,()=>{},{host:f.p.capacity.host,users:path=>treeUsers(path,{pids:[child.pid!]}),reclamation:{services:[],ownership:()=>{}}});
    assert.throws(()=>owned.detach('884'),new RegExp('pid '+child.pid));
    assert.equal(workerPresence(tree.path,'884').state,'attached');
  }finally{child.stdin.end();await exited;}
  const unit=new Pool(f.p.dir,f.p.git,()=>{},{host:f.p.capacity.host,users:()=>[],reclamation:{services:[],ownership:()=>{throw Error('unit branch-build.service owns WorkingDirectory');}}});
  assert.throws(()=>unit.detach('884'),/branch-build.service/);
  const release=f.p.capacity.beginBuild({root:tree.path,target:join(tree.path,'target')});
  try{assert.throws(()=>f.p.detach('884'),/live build claim.*pid/);}finally{release();}
  const lock=GateResource.tryAcquire(tree.path+'.lock');assert.ok(lock);
  try{assert.throws(()=>f.p.detach('884'),/resource lock is held/);}finally{lock.close();}
  f.p.detach('884');assert.equal(workerPresence(tree.path,'884').state,'detached');
});

test('a reclaimed task reattaches, rebuilds Cargo output and runs its committed branch test',t=>{
  const {p,s,observe}=pool(t,1),tree=p.take('884');
  const branchTest=generatedJavaScript(`import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {test} from 'node:test';import {fileURLToPath} from 'node:url';test('retained branch artifact',()=>assert.equal(execFileSync(fileURLToPath(new URL('./target/nts-dev/branch-fixture',import.meta.url)),{encoding:'utf8'}).trim(),'task 884'));`);
  s.commit({'Cargo.toml':'[package]\nname="branch-fixture"\nversion="0.0.0"\nedition="2021"\n[profile.nts-dev]\ninherits="dev"\ndebug=0\n',
    'src/main.rs':'fn main() { println!("task 884"); }\n','branch.test.mjs':branchTest},'branch build and test',tree.path);
  const build=()=>{
    const release=p.capacity.beginBuild({root:tree.path,target:join(tree.path,'target'),outputs:['nts-dev']});
    try{const result=cargoSync(['build','--offline','--profile','nts-dev'],{cwd:tree.path,env:s.env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
    finally{release();}
  };
  build();assert.ok(existsSync(join(tree.path,'target/nts-dev/branch-fixture')));
  p.detach('884');observe({freeBytes:44*GB,freeInodes:1000});
  const report=p.capacity.reclaim(p.dir)!;assert.deepEqual(report.removed.map(row=>row.kind),['detached-build-output'],JSON.stringify(report));
  assert.equal(existsSync(join(tree.path,'target')),false);
  observe({freeBytes:100*GB,freeInodes:1000});
  p.take('884');assert.equal(workerPresence(tree.path,'884').state,'attached');build();
  const tested=spawnTest(process.execPath,['--test',join(tree.path,'branch.test.mjs')],{cwd:tree.path,env:s.env,encoding:'utf8'});
  assert.equal(tested.status,0,tested.stdout+tested.stderr);assert.match(tested.stdout,/retained branch artifact/);
});

test("a branch checked out outside the pool is not taken", t => {
  const { s, p } = pool(t);
  s.git(["switch", "-q", "-c", "mine"]);
  assert.throws(() => p.take("mine"), /checked out in .* outside the pool/);
});

test("only active cold leases promise the measured build, and take reserves atomically", t => {
  const {p,observe}=pool(t,4);
  assert.equal(COLD_TARGET_BYTES,7*GB);
  assert.equal(DISK_MARGIN_BYTES,40*GB);
  assert.equal(p.room().reservedBytes,0,'four free cold checkouts promise nothing');
  observe({freeBytes:54*GB,freeInodes:100});
  p.take('fix/a');p.take('fix/b');
  assert.equal(p.room().reservedBytes,14*GB);
  assert.equal(p.room().unbuilt,2);
  assert.throws(()=>p.take('fix/c'),(error:unknown)=>error instanceof PoolFull&&error.room.reservedBytes===14*GB&&error.room.floorBytes===47*GB);
  assert.deepEqual(names(p),['1 held fix/a','2 held fix/b'],'refused take switches no branch; pressure may remove only the unbuilt free checkouts');
  p.give('fix/a');
  assert.equal(p.room().reservedBytes,7*GB,'giving a cold tree back returns its promise');
  assert.equal(p.take('fix/c').name,'1');
  const target=join(p.dir,'1','target');
  observe({freeBytes:54*GB,freeInodes:100},{[join(target,'nts-dev')]:GB,[join(target,'evidence')]:77*GB,[join(target,'debug')]:40*GB});
  assert.equal(p.room().reservedBytes,13*GB,'partial declared output consumes one GiB; evidence and obsolete debug consume no promise');
  mkdirSync(join(target,'nts-dev'),{recursive:true});
  assert.equal(p.room().reservedBytes,13*GB,'a directory alone does not prove completion');
});

test('concurrent cold takes cannot spend the same disk promise',async t=>{
  const {p,s,observe}=pool(t,3);
  const observations=observe({freeBytes:54*GB,freeInodes:100});
  const source=generatedJavaScript(`import {Pool,PoolFull} from ${JSON.stringify(new URL('./pool.ts',import.meta.url).href)};
try {new Pool(process.argv[1],{root:process.argv[2]}).take(process.argv[3]);}
catch(error){console.error(String(error));process.exitCode=error instanceof PoolFull?75:1;}`);
  const results=await Promise.all(['parallel/a','parallel/b','parallel/c'].map(branch=>new Promise<{status:number|null;output:string}>(done=>{
    const child=spawn(process.execPath,['--input-type=module','-e',source,p.dir,s.root,branch],{env:{...s.env,...observations},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',part=>output+=String(part));child.stderr.on('data',part=>output+=String(part));
    child.once('close',status=>done({status,output}));
  })));
  assert.deepEqual(results.map(result=>result.status).sort((a,b)=>a!-b!),[0,0,75],JSON.stringify(results));
  assert.equal(p.room().reservedBytes,14*GB);
  assert.equal(p.trees().filter(tree=>tree.state==='held').length,2);
});

test('a cold take publishes its branch promise before a blocked neighbour decides',async t=>{
  const {p,s,observe}=pool(t,2),observations=observe({freeBytes:47*GB,freeInodes:100});
  const stage=join(testScratch(t,'pool-promise-barrier'),'stage');copyModuleClosure(['tooling/landing/pool.ts'],stage);
  const poolFile=join(stage,'tooling/landing/pool.ts'),lockFile=join(stage,'tooling/landing/lock.ts');
  let source=readFileSync(poolFile,'utf8');
  source=replaceOnce(source,'if(!existsSync(path))this.grow(tree);',LOCK_BARRIER+'\n      if(!existsSync(path))this.grow(tree);');
  writeFileSync(poolFile,"import {readSync as __lockRead} from 'node:fs';let __lockPaused=false;\n"+source);
  writeFileSync(lockFile,replaceOnce(readFileSync(lockFile,'utf8'),'if(processIdentity(held.pid)===held.text)return null;',
    "if(processIdentity(held.pid)===held.text){if(process.argv.includes('762-contender'))process.stdout.write('contended\\n');return null;}"));
  const program=generatedJavaScript(`const {Pool,PoolFull}=await import(process.argv[1]);
try{new Pool(process.argv[2],{root:process.argv[3]}).take(process.argv[4]);process.stdout.write('taken\\n');}
catch(error){console.error(String(error));process.exitCode=error instanceof PoolFull?75:1;}`);
  const args=[pathToFileURL(poolFile).href,p.dir,s.root],env={...s.env,...observations};
  const first=lockChild(t,program,[...args,'first/take','762-pause'],env);await first.wait('barrier');
  assert.equal(p.trees().filter(tree=>tree.state==='held').length,0,'the decision precedes the branch switch');
  const second=lockChild(t,program,[...args,'second/take','762-contender'],env);await second.wait('contended');
  assert.equal(second.output().includes('taken'),false);
  first.child.stdin.write('x');assert.equal(await first.closed,0,first.errors());
  assert.equal(await second.closed,75,second.output()+second.errors());
  assert.equal(p.room().reservedBytes,7*GB);assert.equal(p.trees().filter(tree=>tree.state==='held').length,1);
});

test("giving a tree back detaches it at main, keeps the branch and the target; uncommitted work refuses it", t => {
  const { s, p } = pool(t);
  const tree = p.take("fix/a");
  const work = s.commit({ "src/w.txt": "work\n" }, "work", tree.path);
  writeFileSync(join(tree.path, "src/w.txt"), "unsaved\n");
  assert.throws(() => p.give("fix/a"), /uncommitted changes, kept: .*src\/w.txt.*--discard/);
  assert.equal(readFileSync(join(tree.path, "src/w.txt"), "utf8"), "unsaved\n", "nothing was touched");
  writeFileSync(join(tree.path, "src/w.txt"), "work\n");
  mkdirSync(join(tree.path, "target"), { recursive: true });
  writeFileSync(join(tree.path, "target/built"), "warm\n");
  const given = p.give("fix/a");
  assert.equal(given.tree.state, "free");
  assert.equal(given.tree.head, s.git(["rev-parse", "main"]));
  assert.deepEqual(given.branch, [], "the branch is not touched");
  assert.equal(s.git(["rev-parse", "fix/a"]), work, "the task's branch keeps its work");
  assert.ok(existsSync(join(tree.path, "target/built")), "the target stays warm");
  assert.throws(() => p.give("nothing"), /no pool tree is nothing/);
});

test("give --discard drops the task: its uncommitted work and its branch, here and on origin, and keeps the tree warm", t => {
  const { s, p } = pool(t);
  const a = p.take("fix/a");
  s.commit({ "src/a.txt": "dropped\n" }, "work to drop", a.path);
  s.git(["push", "-q", "origin", "fix/a"], a.path);
  writeFileSync(join(a.path, "notes.txt"), "untracked\n");
  mkdirSync(join(a.path, "target"), { recursive: true });
  writeFileSync(join(a.path, "target/built"), "warm\n");
  const dropped = p.give("fix/a", { discard: true });
  assert.equal(dropped.tree.state, "free");
  assert.equal(dropped.tree.head, s.git(["rev-parse", "main"]));
  assert.deepEqual(dropped.branch.map(b => `${b.where} ${b.state}`), ["local deleted", "remote deleted"]);
  assert.equal(s.git(["branch", "--list", "fix/a"]), "");
  assert.equal(s.git(["ls-remote", "--heads", "origin", "fix/a"]), "");
  assert.ok(!existsSync(join(a.path, "notes.txt")), "its uncommitted work is dropped");
  assert.ok(existsSync(join(a.path, "target/built")), "its target stays warm");
  // origin moved past the tip given back: that work is not this task's to drop.
  const b = p.take("fix/b");
  const tip = s.commit({ "src/b.txt": "b\n" }, "b", b.path);
  s.git(["push", "-q", "origin", "fix/b"], b.path);
  const beyond = s.git(["commit-tree", "-p", tip, "-m", "pushed from elsewhere", `${tip}^{tree}`]);
  s.git(["push", "-q", "origin", `${beyond}:refs/heads/fix/b`]);
  const kept = p.give("fix/b", { discard: true });
  assert.deepEqual(kept.branch.map(o => `${o.where} ${o.state}`), ["local deleted", "remote kept"]);
  assert.match(kept.branch[1]!.reason ?? "", new RegExp(`origin/fix/b is at ${beyond.slice(0, 12)}, with commits ${tip.slice(0, 12)} does not have`));
  assert.equal(s.git(["ls-remote", "--heads", "origin", "fix/b"]).split("\t")[0], beyond);
});

test("after its task lands, the tree is reset to the new main, unless it holds uncommitted work", t => {
  const { s, p } = pool(t);
  const a = p.take("fix/a"), b = p.take("fix/b");
  s.commit({ "src/landed.txt": "landed\n" }, "landed");
  const released = p.release("fix/a", a.head);
  assert.equal(released.state, "reset");
  assert.equal(released.tree?.head, s.git(["rev-parse", "main"]));
  assert.ok(existsSync(join(a.path, "src/landed.txt")));
  writeFileSync(join(b.path, "left.txt"), "left behind\n");
  const kept = p.release("fix/b", b.head);
  assert.equal(kept.state, "kept");
  assert.match(kept.reason ?? "", /uncommitted changes: \?\? left.txt; it stays on its branch, and the next upkeep resets it once they are gone and nothing uses it/);
  assert.equal(p.release("fix/none", b.head).state, "none");
  const status = describePool(p.trees(), NOW);
  assert.match(status, / 1 {2}\S+ {2}free, idle 0m/);
  assert.match(status, / 2 {2}\S+ {2}landed fix\/b \(1 behind\), 1 uncommitted, idle 0m/);
  // Its work left: the upkeep keeps it, and resets it once the work is gone.
  assert.match(pruneLines(p.prune({ now: NOW })).join("\n"), /^pool: kept tree 2 on its landed branch fix\/b: it has uncommitted changes: \?\? left.txt$/m);
  rmSync(join(b.path, "left.txt"));
  const settled = p.prune({ now: NOW });
  assert.deepEqual(settled.released.map(r => `${r.tree.name} ${r.branch}: ${r.outcome.map(o => `${o.where} ${o.state}`).join(", ")}`), ["2 fix/b: local deleted"]);
  assert.deepEqual(names(p), ["1 free", "2 free"]);
  assert.equal(p.landed().size, 0, "its mark goes with it");
});

test("a tree a process still uses stays on its landed branch, says what uses it, and the upkeep resets it once nothing does", async t => {
  let ownedPid:number|undefined;
  const { s, p } = pool(t,2,{users:tree=>treeUsers(tree,{pids:ownedPid===undefined?[]:[ownedPid]})});
  const a = p.take("fix/a");
  const tip = s.commit({ "src/a.txt": "the task's change\n" }, "the task's change", a.path);
  // An agent's test, or a person's shell, with its working directory in the tree.
  const shell = spawn("cat", [], {env:fixtureEnvironment(t), cwd: join(a.path, "src"), stdio: ["pipe", "ignore", "ignore"] });
  // Ended when its input closes, here or, if an assertion stops the test first, after it.
  t.after(() => { shell.stdin.end(); });
  await once(shell, "spawn");ownedPid=shell.pid;
  s.commit({ "src/landed.txt": "landed\n" }, "landed");
  const kept = p.release("fix/a", tip);
  assert.equal(kept.state, "kept");
  assert.equal(kept.reason, `pool tree 1 stays on its branch while pid ${shell.pid} cat (its working directory) still uses it `
    + "(a shell or editor with its working directory there counts too); the next upkeep resets it once nothing does");
  assert.deepEqual(names(p), ["1 landed fix/a", "2 free"]);
  assert.equal(p.landed().get("fix/a"), tip, "marked landed at the commit that landed");
  assert.match(describePool(p.trees(), NOW), new RegExp(` 1 {2}\\S+ {2}landed fix/a \\(1 ahead of main, 1 behind\\), kept while pid ${shell.pid} cat \\(its working directory\\) still uses it, idle 0m`));
  assert.throws(() => s.git(["branch", "-D", "fix/a"]), /checked out|used by worktree/, "its branch stays with its tree");
  const waiting = p.prune({ now: NOW });
  assert.deepEqual(waiting.released, []);
  assert.deepEqual(pruneLines(waiting), [`pool: kept tree 1 on its landed branch fix/a: pid ${shell.pid} cat (its working directory) still uses it (a shell or editor with its working directory there counts too)`]);
  assert.equal(p.take("fix/b").name, "2", "a landed tree is not free");
  shell.stdin.end(); await once(shell, "exit");
  assert.match(describePool(p.trees(), NOW), / 1 {2}\S+ {2}landed fix\/a \(1 ahead of main, 1 behind\), reset at the next upkeep, idle 0m/);
  const settled = p.prune({ now: NOW });
  assert.deepEqual(settled.released.map(r => `${r.tree.name} ${r.branch}: ${r.outcome.map(o => `${o.where} ${o.state}`).join(", ")}`), ["1 fix/a: local deleted"]);
  assert.match(pruneLines(settled)[0]!, /^pool: reset tree 1, whose task fix\/a landed, now that nothing uses it; its branch here deleted$/);
  assert.deepEqual(names(p), ["1 free", "2 held fix/b"]);
  assert.equal(p.trees()[0]!.head, s.git(["rev-parse", "main"]), "at the newest main");
  assert.equal(p.landed().size, 0);
});

test('read-only pool status names a failed ownership observation while reset still refuses',t=>{
  let unreadable=false;
  const failure=Error('EACCES: supplied unreadable tool process');
  const {s,p}=pool(t,2,{users:()=>{if(unreadable)throw failure;return [{pid:42,command:'worker',where:'its working directory'}];}});
  const a=p.take('fix/status'),tip=s.git(['rev-parse','HEAD'],a.path);
  assert.equal(p.release('fix/status',tip).state,'kept');unreadable=true;
  assert.throws(()=>p.trees(),error=>error===failure);
  assert.throws(()=>p.prune({now:NOW}),error=>error===failure);
  const trees=p.statusTrees();assert.equal(trees[0]!.ownershipError,failure.message);
  assert.equal(trees[1]!.state,'free');
  const output:string[]=[];t.mock.method(console,'log',(...values:unknown[])=>output.push(values.map(String).join(' ')));
  assert.equal(reportPoolStatus(p),0);assert.match(output.pop()!,/ownership observation failed; kept: EACCES/);
  assert.equal(reportPoolStatus(p,true),0);
  const model=JSON.parse(output.pop()!) as {trees:{path:string;ownership_error?:string}[]};
  assert.equal(model.trees[0]!.path,a.path);assert.equal(model.trees[0]!.ownership_error,failure.message);
  assert.equal(s.git(['rev-parse','HEAD'],a.path),tip,'read-only reporting never resets the tree');
});

test("a landed branch that moves on is its task's again: its mark goes and its tree stays held", async t => {
  let ownedPid:number|undefined;
  const { s, p } = pool(t,2,{users:tree=>treeUsers(tree,{pids:ownedPid===undefined?[]:[ownedPid]})});
  const a = p.take("fix/a");
  const shell = spawn("cat", [], {env:fixtureEnvironment(t), cwd: a.path, stdio: ["pipe", "ignore", "ignore"] });
  await once(shell, "spawn");ownedPid=shell.pid;
  try {
    assert.equal(p.release("fix/a", a.head).state, "kept");
    assert.deepEqual(names(p), ["1 landed fix/a", "2 free"]);
    s.commit({ "src/next.txt": "the next slice\n" }, "the next slice", a.path);
    assert.deepEqual(names(p), ["1 held fix/a", "2 free"], "a new commit: the task goes on");
    p.prune({ now: NOW });
    assert.equal(p.landed().size, 0, "the upkeep drops the mark");
    // A landing of a commit its tree has gone past leaves the tree as it is, unmarked.
    const past = p.release("fix/a", a.head);
    assert.deepEqual([past.state, past.reason], ["kept", "pool tree 1 has commits past the one that landed, so it stays its task's"]);
    assert.deepEqual([names(p), p.landed().size], [["1 held fix/a", "2 free"], 0]);
    // Asked for again, a landed task's tree is its own again too.
    const tip = s.git(["rev-parse", "HEAD"], a.path);
    assert.equal(p.release("fix/a", tip).state, "kept");
    assert.equal(p.take("fix/a").state, "held");
    assert.equal(p.landed().size, 0);
  } finally { shell.stdin.end(); await once(shell, "exit"); }
  assert.equal(s.git(["rev-parse", "--abbrev-ref", "HEAD"], a.path), "fix/a");
});

test("the upkeep removes free trees idle past the limit, cold ones first, keeps the warm minimum, and never touches a held or dirty tree", t => {
  assert.equal(IDLE_LIMIT_MS, 3 * DAY);
  assert.equal(WARM_MINIMUM, 2);
  const { s, p, at, freedAt } = pool(t, 0);
  at(6 * DAY).init(6);
  // 1: held since six days ago; 2 and 3: free for five days, 2 warm and 3 cold; 4: free for four days, warm;
  // 5: free since now, warm; 6: detached with work nobody committed, for five days.
  at(6 * DAY).take("fix/held");
  for (const n of ["2", "4", "5"]) {
    const tree=join(p.dir,n);mkdirSync(join(tree,'target/nts-dev'),{recursive:true});
    writeFileSync(join(tree,'target/CACHEDIR.TAG'),'Signature: 8a477f597d28d172789f06886806bc55\n');
    completeBuild(tree,'nts-dev',join(tree,'target/nts-dev'));
  }
  freedAt("2", 5 * DAY); freedAt("3", 5 * DAY); freedAt("4", 4 * DAY); freedAt("5", 0); freedAt("6", 5 * DAY);
  writeFileSync(join(p.dir, "6", "uncommitted.txt"), "nobody committed this\n");
  // A sealed folder in a removed tree's target: its write permission comes back before it goes.
  mkdirSync(join(p.dir, "2", "target/nts-dev/sealed/inner"), { recursive: true });
  writeFileSync(join(p.dir, "2", "target/nts-dev/sealed/inner/file"), "read-only\n");
  chmodSync(join(p.dir, "2", "target/nts-dev/sealed/inner"), 0o555); chmodSync(join(p.dir, "2", "target/nts-dev/sealed"), 0o555);
  assert.deepEqual(names(p), ["1 held fix/held", "2 free", "3 free", "4 free", "5 free", "6 dirty"]);

  const pruned = p.prune({ now: NOW });
  assert.deepEqual(pruned.removed.map(r => r.tree.name), ["3"], "the unbuilt checkout goes through Git");
  assert.deepEqual(pruned.reclamation?.removed.map(row=>row.kind),['unbuilt-checkout','free-build-output']);
  assert.ok(existsSync(join(p.dir,'2')), 'a built checkout survives output eviction');
  assert.equal(existsSync(join(p.dir,'2/target')),false);
  for(const n of ['4','5'])assert.ok(existsSync(join(p.dir,n,'target/nts-dev')),'two useful targets stay warm');
  assert.equal(s.git(["rev-parse", "--abbrev-ref", "HEAD"], join(p.dir, "1")), "fix/held");
  assert.equal(readFileSync(join(p.dir, "6", "uncommitted.txt"), "utf8"), "nobody committed this\n");
  assert.match(pruneLines(pruned).join("\n"), /disk: removed .*unbuilt-checkout/);
  assert.deepEqual(p.prune({now:NOW}).removed.map(row=>row.tree.name),['2'],'a later idle upkeep can remove the now unbuilt checkout');
  assert.deepEqual(names(p), ["1 held fix/held", "4 free", "5 free", "6 dirty"]);
  assert.throws(()=>p.prune({keep:1,now:NOW}),/at least two warm/);
  assert.deepEqual(p.prune({now:NOW}).reclamation?.removed,[]);

});

test("status shows each tree's state, task, idle time and target size, for a scheduler too", t => {
  const { p } = pool(t, 2, { targetBytes: tree => tree.endsWith("/1") ? 24 * GB : null });
  p.take("fix/a");
  const trees = p.measured(), room = p.room(trees);
  const text = describePool(trees, NOW);
  assert.match(text, / 1 {2}\S+ {2}task fix\/a, idle 0m, target 24\.0 GB/);
  assert.match(text, / 2 {2}\S+ {2}free, idle 0m, no target/);
  const json = statusJson(p.dir, trees, room, NOW);
  assert.equal(json.version, 2);
  assert.equal(json.room.ok, true);
  assert.equal(json.room.tree_bytes, COLD_TARGET_BYTES, "whole-target size never sets the build forecast");
  assert.equal(json.room.unbuilt, 1);
  assert.deepEqual(json.trees.map(tree => [tree.name, tree.state, tree.task, tree.target_bytes]), [["1", "held", "fix/a", 24 * GB], ["2", "free", null, null]]);
  assert.deepEqual(json.trees.map(tree => tree.idle_ms), [0, 0], "both trees moved at NOW");
});


test('ordinary upkeep retains task and warm-target facts without kept-line noise',t=>{
  const {p,freedAt}=pool(t,3);
  p.take('fix/working');
  for(const name of ['2','3']){
    const tree=join(p.dir,name),target=join(tree,'target');mkdirSync(target);
    writeFileSync(join(target,'CACHEDIR.TAG'),'Signature: 8a477f597d28d172789f06886806bc55\n');
    for(const profile of ['nts-dev','clippy'] as const){const output=join(target,profile);mkdirSync(output);completeBuild(tree,profile,output);}
    mkdirSync(join(target,'test-scratch'));
    freedAt(name,5*DAY);
  }
  const pruned=p.prune({now:NOW}),kept=pruned.reclamation!.kept;
  assert.equal(kept.filter(row=>row.reason.startsWith('branch remains owned:')).length,1);
  assert.equal(kept.filter(row=>row.reason==='two warm free targets retained').length,2);
  assert.equal(kept.filter(row=>row.root.endsWith('/test-scratch')).length,2,'sibling inventory remains available to refusal reporting');
  assert.ok(kept.every(row=>row.routine));assert.deepEqual(pruneLines(pruned),[]);
});

for(const blocked of [false,true])test('take reclaims the oldest surplus Cargo profiles beside preserved evidence; blocked '+blocked,t=>{
  const f=pool(t,3),old=join(f.p.dir,'1');
  for(const [index,tree] of f.p.trees().entries()){
    for(const profile of ['nts-dev','clippy'] as const){const path=join(tree.path,'target',profile);mkdirSync(path,{recursive:true});completeBuild(tree.path,profile,path);}
    f.freedAt(tree.name,(3-index)*DAY);
  }
  const evidence=join(old,'target/test-scratch/evidence');mkdirSync(join(old,'target/test-scratch'));writeFileSync(evidence,'keep');
  const host={...f.p.capacity.host,disk:(path:string)=>({...f.p.capacity.host.disk(path),freeBytes:DISK_MARGIN_BYTES-1+(existsSync(join(old,'target/nts-dev'))?0:16*GB)}),
    allocatedBytes:(path:string)=>path===join(old,'target/nts-dev')&&existsSync(path)?16*GB:0};
  const p=new Pool(f.p.dir,f.p.git,()=>{},{host,users:()=>[],reclamation:{services:[],ownership:()=>{if(blocked)throw Error('unit build-owner.service owns profile');}}});
  if(blocked){
    assert.throws(()=>p.take('919'),error=>{
      assert.ok(error instanceof PoolFull);
      for(const tree of f.p.trees())assert.ok(error.message.includes(tree.path),error.message);
      assert.match(error.message,/two warm free targets retained/);assert.match(error.message,/test-scratch/);assert.match(error.message,/build-owner.service/);
      return true;
    });
    assert.equal(p.trees().some(tree=>tree.branch==='919'),false);
  }else{
    const taken=p.take('919');assert.equal(taken.name,'2','a retained compatible warm tree is preferred');
    assert.equal(existsSync(join(old,'target/nts-dev')),false);
    for(const name of ['2','3'])assert.ok(existsSync(join(p.dir,name,'target/nts-dev')));
  }
  assert.equal(readFileSync(evidence,'utf8'),'keep');
});

test('a reclaimed free tree is taken and Cargo rebuilds its removed profile',t=>{
  const f=pool(t,0);
  f.s.commit({'.gitignore':'target/\nCargo.lock\n','Cargo.toml':'[package]\nname="reclaimed-free"\nversion="0.0.0"\nedition="2021"\n[profile.nts-dev]\ninherits="dev"\ndebug=0\n',
    'src/main.rs':'fn main() { println!("rebuilt free tree"); }\n'},'rebuild control');
  f.p.init(3);
  for(const [index,tree] of f.p.trees().entries()){
    for(const name of ['nts-dev','clippy'] as const){const path=join(tree.path,'target',name);mkdirSync(path,{recursive:true});completeBuild(tree.path,name,path);}
    f.freedAt(tree.name,(3-index)*DAY);
  }
  const old=join(f.p.dir,'1'),evidence=join(old,'target/test-scratch/evidence');
  mkdirSync(join(old,'target/test-scratch'));writeFileSync(evidence,'preserve');
  const release=f.p.capacity.beginBuild({root:old,target:join(old,'target'),outputs:['nts-dev']});
  try{const result=cargoSync(['build','--offline','--profile','nts-dev'],{cwd:old,env:f.s.env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);completeBuild(old,'nts-dev',join(old,'target/nts-dev'));}finally{release();}
  const host={...f.p.capacity.host,disk:(path:string)=>({...f.p.capacity.host.disk(path),freeBytes:44*GB+(existsSync(join(old,'target/nts-dev'))?0:16*GB)}),allocatedBytes:(path:string)=>path===join(old,'target/nts-dev')&&existsSync(path)?16*GB:0};
  const p=new Pool(f.p.dir,f.p.git,()=>{},{host,users:()=>[],reclamation:{services:[],ownership:()=>{}}});
  const report=p.capacity.reclaim(p.dir)!;assert.ok(report.removed.some(row=>row.root===join(old,'target/nts-dev')),JSON.stringify(report));
  // Occupy the warm pair so the next task takes the reclaimed checkout.
  p.take('920');p.take('921');const taken=p.take('919');assert.equal(taken.path,old);
  const finish=p.capacity.beginBuild({root:old,target:join(old,'target'),outputs:['nts-dev']});
  try{const result=cargoSync(['build','--offline','--profile','nts-dev'],{cwd:old,env:f.s.env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}finally{finish();}
  assert.equal(execFileSync(join(old,'target/nts-dev/reclaimed-free'),{cwd:old,env:f.s.env,encoding:'utf8'}).trim(),'rebuilt free tree');
  assert.equal(readFileSync(evidence,'utf8'),'preserve');
});

test('status names trash bytes and age in text and JSON without deleting it',t=>{
  const {p}=pool(t,0),entry=join(p.dir,DISK_TRASH,'unknown-entry');mkdirSync(entry,{recursive:true});
  writeFileSync(join(entry,'evidence'),'preserve unknown trash');
  const messages:string[]=[];t.mock.method(console,'log',(value:string)=>messages.push(value));
  assert.equal(reportPoolStatus(p),0);assert.match(messages.join('\n'),/disk trash: .*unknown-entry; unknown allocated bytes; age/);
  messages.length=0;assert.equal(reportPoolStatus(p,true),0);
  const json=JSON.parse(messages.join(''));assert.equal(json.trash[0].path,entry);assert.equal(json.trash[0].allocatedBytes,null);
  assert.equal(typeof json.trash[0].ageMs,'number');assert.ok(json.trash[0].diagnostic);
  assert.equal(readFileSync(join(entry,'evidence'),'utf8'),'preserve unknown trash');
});

for(const known of [true,false])test('unreadable nts process '+(known?'owned by another tree':'without an owner')+' never hard-fails a take',t=>{
  const f=treeProcessFixture(t);let enabled=false,runTrees:string[]=[];
  const cgroups=join(f.root,'cgroups');
  const {s,p}=pool(t,2,{users:tree=>enabled?treeUsers(tree,{...f.options,pids:[42],runTrees,cgroups}):[]});
  const a=p.take('fix/owner'),tip=s.git(['rev-parse','HEAD'],a.path);
  s.git(['push','-q','origin','fix/owner'],a.path);
  writeFileSync(join(a.path,'left.txt'),'keep landed tree');assert.equal(p.release('fix/owner',tip).state,'kept');rmSync(join(a.path,'left.txt'));
  const group='/user.slice/nts-r12345678.slice',scope=join(cgroups,group);mkdirSync(scope,{recursive:true});
  const info=statSync(scope,{bigint:true}),boot='11111111-1111-1111-1111-111111111111';
  mkdirSync(join(f.proc,'sys/kernel/random'),{recursive:true});writeFileSync(join(f.proc,'sys/kernel/random/boot_id'),boot);
  const runner=join(f.proc,'43');mkdirSync(runner);
  writeFileSync(join(runner,'status'),'Uid:\t'+Array<number>(4).fill(process.getuid!()).join('\t')+'\n');
  writeFileSync(join(runner,'stat'),'43 (runner) '+['S',...Array<string>(18).fill('0'),'88'].join(' '));
  mkdirSync(join(a.path,'target'),{recursive:true});
  writeFileSync(join(a.path,'target/gate-scope-owner.json'),JSON.stringify({version:1,nonce:boot,boot,pid:43,start:'88',slice:'nts-r12345678.slice',scope:{group,device:String(info.dev),inode:String(info.ino)}}));
  writeFileSync(join(f.task,'cgroup'),'0::'+group+'/nts-test-inner-compiler-private.service\n');
  runTrees=known?[a.path]:[];enabled=true;chmodSync(join(f.task,'fd'),0);
  try{
    const retry=(error:unknown)=>error instanceof PoolRetry&&poolExit(error)===75&&/unreadable process 42/.test(error.message);
    if(known){assert.equal(p.take('fix/other').name,'2');assert.deepEqual(p.prune({now:NOW}).released,[]);}
    else{assert.throws(()=>p.take('fix/other'),retry);assert.throws(()=>p.prune({now:NOW}),retry);}
    const status=p.statusTrees()[0]!;
    if(known)assert.equal(status.users[0]!.pid,42);else assert.match(status.ownershipError!,/unreadable process 42/);
    for(const discard of [false,true]){
      assert.throws(()=>p.give('fix/owner',{discard}),known?/cannot reset.*pid 42/:retry);
      assert.equal(s.git(['rev-parse','HEAD'],a.path),tip,'refusal precedes checkout reset');
      assert.equal(s.git(['rev-parse','refs/heads/fix/owner']),tip,'refusal precedes local branch deletion');
      assert.equal(s.git(['rev-parse','refs/heads/fix/owner'],s.origin),tip,'refusal precedes remote branch deletion');
    }
    enabled=false;assert.equal(p.prune({now:NOW}).released.length,1,'only a complete idle observation permits reset');
  }finally{chmodSync(join(f.task,'fd'),0o700);}
});
