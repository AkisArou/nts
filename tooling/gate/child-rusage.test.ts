import assert from 'node:assert/strict';
import {rmSync} from 'node:fs';
import {test} from 'node:test';
import {observedSpawnSync,prepareChildObserver,readChildUsage,type ChildUsage} from './child-rusage.ts';
import {newTestScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';

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
  const forwarded=observedSpawnSync('sh',['-c','kill -TERM "$PPID"; while :; do :; done'],options,prepared.observer,record);
  assert.equal(forwarded.signal,'SIGTERM','parent cancellation reaches its exact child');
  const missing=observedSpawnSync(root+'/absent',[],options,prepared.observer,record);
  assert.equal((missing.error as NodeJS.ErrnoException)?.code,'ENOENT');assert.equal(missing.status,null);
  assert.ok(rows.every(row=>row.cpu_measure==='wait4-rusage-v1'));
});

test('malformed or missing child accounting cannot become a measured zero',()=>{
  for(const value of [undefined,{}, {version:1,cpu_measure:'wait4-rusage-v1',pid:1,wall_s:0,user_s:-1,sys_s:0,exit:0,signal:0,exec_errno:0}])
    assert.throws(()=>readChildUsage(value),/phase observation/);
});
