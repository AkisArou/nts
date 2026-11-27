import {testEnvironment} from "../gate/test-environment.ts";
// The processes that use a tree, read from /proc: by their working directory,
// their executable or an open file; never the process that asks, never one
// outside the tree.
//
//   node --test tooling/landing/tree-users.test.ts
import { test,type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertNoProcessUsers, describeUsers, observedFailure, observeTreeProcesses, OwnershipObservationFailure, TreeOwnershipUnavailable, treeUsers } from "./tree-users.ts";
import {treeProcessFixture} from './tree-users-fixture.ts';
import {copyModuleClosure} from '../gate/module-closure-fixture.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {replaceOnce} from './lock-fixture.ts';
import {pathToFileURL} from 'node:url';

for(const link of ['cwd','exe'])test('an exiting task with absent '+link+' has no owner at that link',t=>{
  const f=treeProcessFixture(t);rmSync(join(f.task,link));
  assert.deepEqual(observeTreeProcesses([f.tree],f.options),{users:[],ignored:[],unreadable:[]});
  assert.deepEqual(treeUsers(f.tree,f.options),[]);
  assert.deepEqual(assertNoProcessUsers([f.tree],f.options),[]);
  if(link==='cwd'){
    rmSync(join(f.task,'exe'));symlinkSync(join(f.tree,'program'),join(f.task,'exe'));
  }else symlinkSync(join(f.tree,'held'),join(f.task,'fd/3'));
  assert.deepEqual(treeUsers(f.tree,f.options).map(user=>user.pid),[42],'an absent link cannot hide another live owner');
});

test('non-ENOENT process failures retain strict cgroup provenance',t=>{
  const f=treeProcessFixture(t);
  rmSync(join(f.task,'cwd'));writeFileSync(join(f.task,'cwd'),'not a proc link');
  assert.throws(()=>treeUsers(f.tree,f.options),/live unreadable tool process 42.*EINVAL/);
  rmSync(join(f.task,'cwd'));symlinkSync('/outside',join(f.task,'cwd'));
  chmodSync(join(f.task,'fd'),0);
  try{
    assert.throws(()=>treeUsers(f.tree,f.options),/live unreadable tool process 42/);
    assert.throws(()=>assertNoProcessUsers([f.tree],f.options),/live unreadable tool process 42/);
    writeFileSync(join(f.task,'cgroup'),'0::/user.slice/session-2.scope\n');
    assert.match(assertNoProcessUsers([f.tree],f.options).join('\n'),/ignored non-dumpable outside nts: pid 42/);
  }finally{chmodSync(join(f.task,'fd'),0o700);}
});

/**
 * A `cat` that runs until its input closes, started from `binary` in `cwd`.
 * With `open`, a shell opens that file on descriptor 3, says so, and becomes
 * the `cat`, which keeps it open.
 */
async function waiting(binary: string, cwd: string, open?: string) {
  const child = open === undefined ? spawn(binary, [], {env:testEnvironment(), cwd, stdio: ["pipe", "pipe", "ignore"] })
    : spawn("sh", ["-c", 'exec 3<"$1"; echo open; exec cat', "sh", open], {env:testEnvironment(), cwd, stdio: ["pipe", "pipe", "ignore"] });
  await once(child, "spawn");
  if (open !== undefined) await once(child.stdout, "data");
  return { pid: child.pid!, end: async () => { child.stdin.end(); await once(child, "exit"); } };
}

test("a process uses a tree by its working directory, its executable or an open file there, and no other way", async t => {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "tree-users-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tree = join(dir, "tree"), outside = join(dir, "outside");
  mkdirSync(join(tree, "target/release"), { recursive: true }); mkdirSync(outside);
  writeFileSync(join(tree, "held.txt"), "held\n");
  copyFileSync("/usr/bin/cat", join(tree, "target/release/cat"));
  assert.deepEqual(treeUsers(tree,{pids:[]}), [], "nothing uses a new tree");
  const inside = await waiting("cat", tree);
  const reading = await waiting("cat", outside, join(tree, "held.txt"));
  const running = await waiting(join(tree, "target/release/cat"), outside);
  const elsewhere = await waiting("cat", outside);
  try {
    const pids=[inside.pid,reading.pid,running.pid,elsewhere.pid];
    const users = treeUsers(tree,{pids});
    assert.deepEqual(users.map(user => `${user.pid} ${user.where}`).sort(), [
      `${inside.pid} its working directory`,
      `${reading.pid} an open file held.txt`,
      `${running.pid} its executable target/release/cat`,
    ].sort(), JSON.stringify(users));
    assert.ok(users.every(user => user.command === "cat"), JSON.stringify(users));
    assert.equal(users.some(user => user.pid === elsewhere.pid), false, "a process outside the tree does not use it");
    assert.equal(treeUsers(tree, { self: inside.pid,pids }).some(user => user.pid === inside.pid), false, "the process that asks is never its own user");
    assert.deepEqual(treeUsers(join(tree, "target"),{pids}).map(user => user.pid), [running.pid], "a folder in the tree is a tree of its own");
    assert.match(describeUsers(users, 2), /^pid \d+ cat \([^)]+\), pid \d+ cat \([^)]+\) and 1 more$/);
  } finally {
    for (const one of [inside, reading, running, elsewhere]) await one.end();
  }
  assert.deepEqual(treeUsers(tree,{pids:[]}), [], "once they end, nothing uses it");
  assert.deepEqual(treeUsers(join(dir, "gone")), [], "a tree that is not there has no users");
});

function runReceipt(f:ReturnType<typeof treeProcessFixture>,tree=f.tree){
  const group='/user.slice/nts-r12345678.slice',cgroups=join(f.root,'cgroups'),scope=join(cgroups,group);
  mkdirSync(scope,{recursive:true});
  const info=statSync(scope,{bigint:true}),boot='11111111-1111-1111-1111-111111111111';
  mkdirSync(join(f.proc,'sys/kernel/random'),{recursive:true});writeFileSync(join(f.proc,'sys/kernel/random/boot_id'),boot);
  const runner=join(f.proc,'43');mkdirSync(runner);
  writeFileSync(join(runner,'status'),'Uid:\t'+Array<number>(4).fill(process.getuid!()).join('\t')+'\n');
  writeFileSync(join(runner,'stat'),'43 (runner) '+['S',...Array<string>(18).fill('0'),'88'].join(' '));
  const receipt={version:1,nonce:boot,boot,pid:43,start:'88',slice:'nts-r12345678.slice',scope:{group,device:String(info.dev),inode:String(info.ino)}};
  const file=join(tree,'target/gate-scope-owner.json');mkdirSync(join(tree,'target'),{recursive:true});writeFileSync(file,JSON.stringify(receipt));
  writeFileSync(join(f.task,'cgroup'),'0::'+group+'/nts-test-inner-compiler-private.service\n');
  return {file,receipt,options:{...f.options,pids:[42],runTrees:[tree],cgroups}};
}

for(const mutation of ['none','absent','corrupt','future','boot','start','device','inode','sibling','conflict','missing-cgroups'] as const){
  test('unreadable nts process attribution requires owned run evidence: '+mutation,t=>{
    const f=treeProcessFixture(t),r=runReceipt(f),other=join(f.root,'other');mkdirSync(other);
    chmodSync(join(f.task,'fd'),0);
    try{
      if(mutation==='absent')rmSync(r.file);
      if(mutation==='corrupt')writeFileSync(r.file,'{broken');
      if(mutation==='future')writeFileSync(r.file,JSON.stringify({...r.receipt,version:2}));
      if(mutation==='boot')writeFileSync(r.file,JSON.stringify({...r.receipt,boot:'22222222-2222-2222-2222-222222222222'}));
      if(mutation==='start')writeFileSync(r.file,JSON.stringify({...r.receipt,start:'89'}));
      if(mutation==='device'||mutation==='inode')writeFileSync(r.file,JSON.stringify({...r.receipt,scope:{...r.receipt.scope,[mutation]:'999999999'}}));
      if(mutation==='sibling')writeFileSync(join(f.task,'cgroup'),'0::'+r.receipt.scope.group+'-sibling/nts-test-inner-compiler-private.service\n');
      if(mutation==='conflict'){
        mkdirSync(join(other,'target'));writeFileSync(join(other,'target/gate-scope-owner.json'),JSON.stringify(r.receipt));r.options.runTrees.push(other);
      }
      const options=mutation==='missing-cgroups'?{...r.options,cgroups:undefined}:r.options;
      if(mutation==='missing-cgroups'){
        // A caller's missing capability is a defect: retrying never supplies it.
        for(const root of [f.tree,other])assert.throws(()=>treeUsers(root,options),error=>!(error instanceof TreeOwnershipUnavailable)&&/^missing cgroup filesystem observation$/.test((error as Error).message));
        return;
      }
      if(mutation!=='none'){
        for(const root of [f.tree,other])assert.throws(()=>treeUsers(root,options),error=>error instanceof TreeOwnershipUnavailable&&/unreadable process 42/.test(error.message));
        return;
      }
      const users=treeUsers(f.tree,options);assert.deepEqual(users.map(row=>row.pid),[42]);assert.match(users[0]!.where,/owned gate run.*nts-test-inner-compiler-private/);
      assert.deepEqual(treeUsers(other,options),[],'validated ownership permits an unrelated tree');
      assert.throws(()=>assertNoProcessUsers([f.tree],options),/process 42 owns cgroup/);
      assert.deepEqual(assertNoProcessUsers([other],options),[]);
      // Readable evidence always wins, even when the run belongs elsewhere.
      rmSync(join(f.task,'cwd'));symlinkSync(other,join(f.task,'cwd'));
      assert.deepEqual(treeUsers(other,options).map(row=>row.pid),[42]);
    }finally{chmodSync(join(f.task,'fd'),0o700);}
  });
}


test('a malformed live process stat protects tree ownership while absent stat proves gone',t=>{
  const f=treeProcessFixture(t);
  for(const text of ['', '42 (short) R', '42 (bad counters) '+['S',...Array<string>(18).fill('0'),'bad'].join(' ')]){
    writeFileSync(join(f.task,'stat'),text);
    const reading=observeTreeProcesses([f.tree],f.options);
    assert.equal(reading.unreadable.length,1);
    assert.match(String(reading.unreadable[0]!.cause),/invalid process 42 stat after recheck/);
    assert.throws(()=>treeUsers(f.tree,f.options),TreeOwnershipUnavailable);
  }
  rmSync(join(f.task,'stat'));
  assert.deepEqual(treeUsers(f.tree,f.options),[]);
});


async function deferredStatFixture(t:TestContext,outcome:'gone'|'live'|'malformed',first:string){
  const f=treeProcessFixture(t),other=join(f.proc,'43'),stage=join(f.root,'staged');
  const valid=readFileSync(join(f.task,'stat'),'utf8');
  mkdirSync(join(other,'fd'),{recursive:true});mkdirSync(stage);
  writeFileSync(join(other,'status'),readFileSync(join(f.task,'status')));
  writeFileSync(join(other,'stat'),valid.replace(/^42/,'43'));
  writeFileSync(join(other,'comm'),'other');symlinkSync('/outside',join(other,'cwd'));symlinkSync('/outside/program',join(other,'exe'));
  rmSync(join(f.task,'cwd'));symlinkSync(f.tree,join(f.task,'cwd'));
  writeFileSync(join(f.task,'stat'),first);
  copyModuleClosure(['tooling/landing/tree-users.ts'],stage);
  const file=join(stage,'tooling/landing/tree-users.ts'),source=readFileSync(file,'utf8');
  const anchor=source.split('\n').find(line=>line.startsWith('const procStat='));assert.ok(anchor);
  const second=outcome==='live'?valid:'42 (still malformed) S';
  const change=outcome==='gone'?"removeSuppliedStat(join(proc,'42','stat'),{force:true});":`replaceSuppliedStat(join(proc,'42','stat'),${JSON.stringify(second)});`;
  writeFileSync(file,source.replace(anchor,`${anchor.replace('const procStat=','const suppliedProcStat=')}
import {rmSync as removeSuppliedStat,writeFileSync as replaceSuppliedStat} from 'node:fs';
export const statReadLog:number[]=[];
const procStat=(pid:number,proc:string)=>{statReadLog.push(pid);if(pid===43){${change}}return suppliedProcStat(pid,proc);};`));
  const reader:typeof import('./tree-users.ts')&{statReadLog:number[]}=await import(pathToFileURL(file).href);
  return {...f,reader,second,options:{...f.options,pids:[42,43]}};
}

for(const first of ['', '42 (exiting) R'])for(const outcome of ['gone','live','malformed'] as const){
  test(`ownership stat recheck follows the complete scan: ${JSON.stringify(first)} then ${outcome}`,async t=>{
    const f=await deferredStatFixture(t,outcome,first);
    if(outcome==='malformed'){
      assert.throws(()=>f.reader.treeUsers(f.tree,f.options),error=>{
        assert.ok(error instanceof f.reader.TreeOwnershipUnavailable);
        const cause=String(error.errors[0].cause);assert.match(cause,/invalid process 42 stat after recheck/);
        assert.ok(cause.includes(JSON.stringify(first)));assert.ok(cause.includes(JSON.stringify(f.second)));return true;
      });
    }else assert.deepEqual(f.reader.treeUsers(f.tree,f.options).map(row=>row.pid),outcome==='live'?[42]:[]);
    assert.deepEqual(f.reader.statReadLog,[42,43,42],'pid 43 must be observed before retrying pid 42');
  });
}

test('the ownership stat scan excludes self and other UIDs before parsing',t=>{
  const f=treeProcessFixture(t);writeFileSync(join(f.task,'stat'),'42 (malformed) R');
  assert.deepEqual(treeUsers(f.tree,{...f.options,self:42}),[]);
  writeFileSync(join(f.task,'status'),'Uid:\t'+Array<number>(4).fill(process.getuid!()+1).join('\t')+'\n');
  assert.deepEqual(treeUsers(f.tree,f.options),[]);
});

test('only a failed process or cgroup observation is an observation failure',t=>{
  const f=treeProcessFixture(t),cgroups=join(f.root,'cgroups');
  const errno=(path:string)=>Object.assign(Error('EACCES: permission denied, open '+path),{code:'EACCES',syscall:'open',path});
  for(const path of [join(f.proc,'42/fd'),join(cgroups,'user.slice')])assert.equal(observedFailure(errno(path),{proc:f.proc,cgroups}),true,path);
  for(const path of [join(f.root,'pool'),join(f.tree,'.git/index'),f.proc+'-other/1'])assert.equal(observedFailure(errno(path),{proc:f.proc,cgroups}),false,path);
  assert.equal(observedFailure(new OwnershipObservationFailure('unowned gate receipt'),{proc:f.proc}),true);
  assert.equal(observedFailure(new TypeError('defect'),{proc:f.proc}),false);
  assert.equal(observedFailure(Object.assign(new TypeError('bad argument'),{code:'ERR_INVALID_ARG_TYPE'}),{proc:f.proc}),false);
});

type ControlledReader=typeof import('./tree-users.ts')&{failures:Map<string,()=>never>};

async function controlledProcReader(t:TestContext):Promise<ControlledReader>{
  const stage=testScratch(t,'controlled-proc-reader');
  copyModuleClosure(['tooling/landing/tree-users.ts'],stage);
  const module=join(stage,'tooling/landing/tree-users.ts'),source=readFileSync(module,'utf8');
  // Inject at the filesystem call so a Linux read error can omit error.path.
  writeFileSync(module,`export const failures=new Map<string,()=>never>();
const readFileSync=(path:string,encoding:'utf8')=>{failures.get(path)?.();return readText(path,encoding);};
const readlinkSync=(path:string)=>{failures.get(path)?.();return readLink(path);};
const readdirSync=(path:string)=>{failures.get(path)?.();return readDirectory(path);};
`+replaceOnce(source,'readdirSync,readFileSync,readlinkSync','readdirSync as readDirectory,readFileSync as readText,readlinkSync as readLink'));
  return import(pathToFileURL(module).href);
}

function failedProcRead(reader:ControlledReader,t:TestContext,field:string,code:string,state:'absent'|'Z'|'R'|'reused'){
  const f=treeProcessFixture(t),owner=field==='owner-status'?runReceipt(f):undefined;
  const task=owner?join(f.proc,'43'):f.task;
  const file=join(task,owner?'status':field),stat=join(task,'stat');
  const live=readFileSync(stat,'utf8').replace(') S ',') R ');
  writeFileSync(stat,live);
  const reads:string[]=[];
  reader.failures.set(file,()=>{
    reads.push(file);
    reader.failures.delete(file);
    if(state==='absent')rmSync(task,{recursive:true});
    else writeFileSync(stat,state==='reused'?live.replace(/\d+$/,'100'):live.replace(') R ',') '+state+' '));
    if(code==='defect')throw new TypeError('supplied process reader defect');
    throw Object.assign(Error(code+': supplied process read'),{code,syscall:'read'});
  });
  const fd=join(f.task,'fd');
  if(field==='cgroup'||owner)reader.failures.set(fd,()=>{
    throw Object.assign(Error('supplied fd denial'),{code:'EACCES',syscall:'scandir',path:fd});
  });
  t.after(()=>{reader.failures.delete(file);reader.failures.delete(fd);});
  if(field==='comm'){
    rmSync(join(f.task,'cwd'));symlinkSync(f.tree,join(f.task,'cwd'));
  }
  if(field==='fd/3')symlinkSync(f.tree,join(f.task,'fd/3'));
  return {...f,file,reads,options:owner?.options??f.options};
}

test('supplied per-process read failures',async t=>{
  const reader=await controlledProcReader(t);
  for(const field of ['status','cwd','fd','fd/3','comm','cgroup'])await t.test('pathless ESRCH while reading '+field+' skips only the departed process',t=>{
    const f=failedProcRead(reader,t,field,'ESRCH','absent'),other=join(f.proc,'44');
    mkdirSync(other);
    writeFileSync(join(other,'status'),'Uid:\t'+Array<number>(4).fill(process.getuid!()).join('\t')+'\n');
    writeFileSync(join(other,'stat'),'44 (owner) '+['S',...Array<string>(18).fill('0'),'100'].join(' '));
    writeFileSync(join(other,'comm'),'owner\n');symlinkSync(f.tree,join(other,'cwd'));
    const reading=reader.observeTreeProcesses([f.tree],f.options);
    assert.deepEqual(reading.users.map(user=>user.pid),[44]);
    assert.deepEqual(reading.ignored,[]);
    assert.deepEqual(reading.unreadable,[]);
    assert.deepEqual(f.reads,[f.file]);
  });

  for(const state of ['Z','reused','R'] as const)await t.test('ESRCH on cwd rechecks process birth and liveness: '+state,t=>{
    const f=failedProcRead(reader,t,'cwd','ESRCH',state);
    if(state==='R'){
      assert.throws(()=>reader.treeUsers(f.tree,f.options),error=>error instanceof reader.TreeOwnershipUnavailable&&/live unreadable tool process 42.*ESRCH/.test(error.message));
    }else assert.deepEqual(reader.treeUsers(f.tree,f.options),[]);
    assert.deepEqual(f.reads,[f.file]);
  });

  for(const [field,code] of [['comm','EACCES'],['comm','EIO'],['fd','ENOENT'],['status','ESRCH']] as const)await t.test('a live process with '+code+' on '+field+' keeps the tree',t=>{
    const f=failedProcRead(reader,t,field,code,'R');
    assert.throws(()=>reader.treeUsers(f.tree,f.options),error=>{
      assert.ok(error instanceof reader.TreeOwnershipUnavailable,String(error));
      assert.match(error.message,new RegExp(code==='ESRCH'?'unreadable process ownership.*42':code));
      assert.equal(error.errors[0].cause.path,f.file);
      return true;
    });
    assert.deepEqual(f.reads,[f.file]);
  });

  await t.test('a departed attribution owner cannot certify an unreadable live process idle',t=>{
    const f=failedProcRead(reader,t,'owner-status','ESRCH','absent');
    assert.throws(()=>reader.treeUsers(f.tree,f.options),error=>{
      assert.ok(error instanceof reader.TreeOwnershipUnavailable,String(error));
      assert.match(error.message,/unreadable process 42: unavailable gate owner identity/);
      return true;
    });
    assert.deepEqual(f.reads,[f.file]);
  });

  await t.test('a process-reader defect remains a hard error',t=>{
    const f=failedProcRead(reader,t,'comm','defect','R');
    assert.throws(()=>reader.treeUsers(f.tree,f.options),{name:'TypeError',message:'supplied process reader defect'});
    assert.deepEqual(f.reads,[f.file]);
  });
});

// A gate run that drains removes its receipt between attribution's first read
// and its verification: that is a changed owner, so the pool retries.
for(const change of ['removed','unreadable','replaced'] as const)test('a receipt '+change+' during attribution is an observation failure, never a raw errno',async t=>{
  const f=treeProcessFixture(t),r=runReceipt(f),stage=join(f.root,'staged');mkdirSync(stage);
  copyModuleClosure(['tooling/landing/tree-users.ts'],stage);
  const file=join(stage,'tooling/landing/tree-users.ts'),source=readFileSync(file,'utf8');
  const anchor='  for(const verify of owners.values())verify();';assert.equal(source.split(anchor).length,2);
  const act=change==='removed'?'removeStagedReceipt(file,{force:true});':change==='unreadable'?'chmodStagedReceipt(file,0);':`replaceStagedReceipt(file,${JSON.stringify(JSON.stringify({...r.receipt,start:'89'}))});`;
  writeFileSync(file,`import {rmSync as removeStagedReceipt,chmodSync as chmodStagedReceipt,writeFileSync as replaceStagedReceipt} from 'node:fs';\n`
    +source.replace(anchor,`  for(const tree of new Set(runTrees)){const file=join(tree,'target/gate-scope-owner.json');${act}}\n${anchor}`));
  const reader:typeof import('./tree-users.ts')=await import(pathToFileURL(file).href);
  chmodSync(join(f.task,'fd'),0);
  try{
    assert.throws(()=>reader.treeUsers(f.tree,r.options),error=>{
      assert.ok(error instanceof reader.TreeOwnershipUnavailable,String(error));
      assert.match(error.message,/unreadable process 42: gate owner changed during attribution .*gate-scope-owner\.json/);return true;
    });
  }finally{chmodSync(join(f.task,'fd'),0o700);if(existsSync(r.file))chmodSync(r.file,0o600);}
});
