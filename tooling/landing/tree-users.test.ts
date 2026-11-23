import {testEnvironment} from "../gate/test-environment.ts";
// The processes that use a tree, read from /proc: by their working directory,
// their executable or an open file; never the process that asks, never one
// outside the tree.
//
//   node --test tooling/landing/tree-users.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertNoProcessUsers, describeUsers, observeTreeProcesses, TreeOwnershipUnavailable, treeUsers } from "./tree-users.ts";
import {treeProcessFixture} from './tree-users-fixture.ts';

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
