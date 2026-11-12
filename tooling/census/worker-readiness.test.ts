import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {constants,closeSync,existsSync,openSync,readFileSync,rmSync,writeSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {MemoryRun} from './worker-memory.ts';
import {createTokenPool} from '../gate/token-pool.ts';
import {tokenClient} from '../gate/tokens.mjs';
import {registerCaseScope,releaseToken} from '../gate/case-context.ts';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {useOwnMemory} from '../gate/test-memory.ts';
import {newTestScratch} from '../gate/test-scratch.ts';
import {spawnTest,waitFor} from '../gate/test-wait.ts';

test('bounded entry publishes readiness only after its complete cgroup path',async t=>{
  const root=newTestScratch('atomic-worker-ready');t.after(()=>rmSync(root,{recursive:true,force:true}));
  useOwnMemory(join(root,'memory'));
  const paused=join(root,'paused'),release=join(root,'release');
  assert.equal(spawnTest('mkfifo',[release],{encoding:'utf8'}).status,0);
  const run=new MemoryRun({budgetBytes:192*2**20,id:'atomic-ready-control'});t.after(()=>run.close());
  const worker=run.worker(0,96*2**20);
  const scope=worker.scope('true',[],fixtureEnvironment(t,{READY_PAUSED:paused,READY_RELEASE:release}));
  const at=scope.argv.indexOf('-c')+1;
  assert.ok(at>0);
  // Redirection opens the publication's target before this printf function
  // enters. Holding it here exposes exactly the old empty-file window.
  scope.argv[at]='printf() { case "$2" in 0::*) : > "$READY_PAUSED"; IFS= read -r released < "$READY_RELEASE" ;; esac; builtin printf "$@"; }\n'+scope.argv[at];
  const child=spawn('systemd-run',scope.argv,{env:scope.env,stdio:['ignore','pipe','pipe']});
  let output='',ended=false;
  child.stdout.on('data',part=>{output+=part;});child.stderr.on('data',part=>{output+=part;});
  const done=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>{ended=true;resolve(code);});});
  void done.catch(()=>{});
  try{
    await waitFor('the publication writer paused before its first byte',()=>existsSync(paused),{stopped:()=>ended?output||'scope exited':undefined});
    assert.equal(worker.ready(scope),false,'an opened publication target is not ready');
    assert.equal(existsSync(scope.ready),false);
    assert.equal(readFileSync(scope.ready+'.pending','utf8'),'');
    let fd:number|undefined;
    await waitFor('the publication writer to read its release',()=>{
      try{fd=openSync(release,constants.O_WRONLY|constants.O_NONBLOCK);return true;}
      catch(error){if((error as NodeJS.ErrnoException).code==='ENXIO')return false;throw error;}
    },{stopped:()=>ended?output||'scope exited':undefined});
    try{writeSync(fd!,'resume\n');}finally{closeSync(fd!);}
    assert.equal(await done,0,output);
    assert.equal(worker.ready(scope),true);
    assert.match(readFileSync(scope.ready,'utf8'),new RegExp('^0::'+worker.group+'/[^\\n]+\\n$'));
    assert.equal(existsSync(scope.ready+'.pending'),false);
  }finally{worker.close();await done;}
});

test('registration distinguishes incomplete data from a missing lease owner',async t=>{
  const pool=createTokenPool({free:()=>1-pool.total,claim:()=>0,now:()=>0});
  const address=await pool.start();assert.ok(address);t.after(()=>pool.close());
  const release=await tokenClient(address,'control').acquire({scope:'step'});assert.ok(release?.case);
  try{
    await assert.rejects(registerCaseScope(release.case,'/worker',1024,''),/incomplete case scope registration/);
    assert.equal(pool.total,1,'the missing scope did not end the live lease');
    await registerCaseScope(release.case,'/worker',1024,'/worker/scope');
  }finally{await releaseToken(release);}
  assert.equal(pool.total,0);
  await assert.rejects(registerCaseScope(release.case,'/worker',1024,'/worker/scope'),/case lease has ended \(no live owner\)/);
});
