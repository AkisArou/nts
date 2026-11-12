import assert from 'node:assert/strict';
import {readFileSync,rmSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {observedSpawnSync,prepareChildObserver,readChildUsage,type ChildUsage} from './child-rusage.ts';
import {newTestScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {waitFor} from './test-wait.ts';

test('the waited-child observer preserves streams, failure status, signals and launch errors',t=>{
  const root=newTestScratch('waited-child-rusage');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const env=fixtureEnvironment(t),prepared=prepareChildObserver(root,env);assert.equal(prepared.error,undefined);assert.ok(prepared.observer);
  const rows:ChildUsage[]=[],record=(row:ChildUsage|undefined,error?:string)=>{assert.equal(error,undefined);assert.ok(row);rows.push(row);};
  const options={env,encoding:'utf8' as const};
  const failed=observedSpawnSync('sh',['-c','printf original; printf diagnostic >&2; exit 7'],options,prepared.observer,record);
  assert.equal(failed.stdout,'original');assert.equal(failed.stderr,'diagnostic');assert.equal(failed.status,7);
  assert.equal(rows.at(-1)?.exit,7);assert.ok(rows.at(-1)!.user_s+rows.at(-1)!.sys_s>0);
  const stopped=observedSpawnSync('sh',['-c','kill -TERM $$'],options,prepared.observer,record);
  assert.equal(stopped.signal,'SIGTERM');assert.equal(rows.at(-1)?.signal,15);
  const missing=observedSpawnSync(root+'/absent',[],options,prepared.observer,record);
  assert.equal((missing.error as NodeJS.ErrnoException)?.code,'ENOENT');assert.equal(missing.status,null);
  assert.equal(rows.at(-1)?.pid,0,'a failed spawn has no entered child');
  const exit127=observedSpawnSync('sh',['-c','exit 127'],options,prepared.observer,record);
  assert.equal(exit127.error,undefined);assert.equal(exit127.status,127);assert.ok(rows.at(-1)!.pid>0);
  assert.ok(rows.every(row=>row.cpu_measure==='wait4-rusage-v1'));
  let unmeasured:string|undefined;
  const noReport=observedSpawnSync('sh',['-c','printf preserved; exit 7'],options,{...prepared.observer,directory:root+'/absent'},(row,error)=>{
    assert.equal(row,undefined);unmeasured=error;
  });
  assert.equal(noReport.stdout,'preserved');assert.equal(noReport.status,7);assert.match(unmeasured??'',/ENOENT/,'missing telemetry does not invent a measured zero or replace the child result');
});

test('private waited accounting cannot consume the product output buffer',t=>{
  const root=newTestScratch('waited-child-buffer');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const env=fixtureEnvironment(t),prepared=prepareChildObserver(root,env);assert.ok(prepared.observer,prepared.error??'the observer compiled');
  const options={env,encoding:'utf8' as const,maxBuffer:10};
  const ordinary=spawnSync('sh',['-c','printf 1234567890'],options);
  const observed=observedSpawnSync('sh',['-c','printf 1234567890'],options,prepared.observer,(row,error)=>{assert.equal(error,undefined);assert.ok(row);});
  assert.equal(ordinary.error,undefined);assert.equal(observed.error,undefined);
  assert.deepEqual({stdout:observed.stdout,stderr:observed.stderr,status:observed.status,signal:observed.signal},
    {stdout:ordinary.stdout,stderr:ordinary.stderr,status:ordinary.status,signal:ordinary.signal});
});

test('cancellation reaches the exact waited child after observed readiness',async t=>{
  const root=newTestScratch('waited-child-cancellation');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const env=fixtureEnvironment(t),prepared=prepareChildObserver(root,env);assert.ok(prepared.observer,prepared.error??'the private observer was compiled');
  const report=root+'/cancelled.json',child=spawn(prepared.observer.binary,[report,'--','sh','-c','printf ready; exec cat'],{env,stdio:['pipe','pipe','pipe']});
  let output='',closed:{status:number|null;signal:NodeJS.Signals|null}|undefined,launchError:Error|undefined;
  child.stdout.on('data',part=>{output+=part;});child.stderr.resume();
  child.on('error',error=>{launchError=error;});child.on('close',(status,signal)=>{closed={status,signal};});
  try{
    await waitFor('waited child readiness',()=>output==='ready',{stopped:()=>launchError?.message??(closed?'child exited before readiness':undefined)});
    child.kill('SIGTERM');
    await waitFor('cancelled waited child exit',()=>closed!==undefined);
    assert.deepEqual(closed,{status:null,signal:'SIGTERM'});
    assert.equal(readChildUsage(JSON.parse(readFileSync(report,'utf8'))).signal,15);
  }finally{
    // EOF lets cat leave even if forwarding is broken, so a failing control
    // cannot leave a spinning child or require a time window for cleanup.
    child.stdin.end();if(!closed)await waitFor('waited child cleanup',()=>closed!==undefined);
  }
});

test('malformed or missing child accounting cannot become a measured zero',()=>{
  for(const value of [undefined,{}, {version:1,cpu_measure:'wait4-rusage-v1',pid:1,wall_s:0,user_s:-1,sys_s:0,exit:0,signal:0,exec_errno:0}])
    assert.throws(()=>readChildUsage(value),/phase observation/);
});
