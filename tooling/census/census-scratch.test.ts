import {fixtureEnvironment} from "../gate/test-environment.ts";
import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { removeOracleSnapshot } from '../differential/oracle-emit.ts';
import { toolingSliceArgs,toolingSlicePrefix } from '../gate/tooling-slice.ts';
import { spawnTest,waitFor } from '../gate/test-wait.ts';

for(const mode of ['success','exception','SIGTERM'] as const)test(`census scratch closes protected snapshots after ${mode}`,async t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-census-scratch-'));t.after(()=>removeOracleSnapshot(root));
  const helper=join(root,'subject.mjs'),ready=join(root,'ready'),drained=join(root,'drained');
  writeFileSync(helper,`
import assert from 'node:assert/strict';
import {chmodSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ownCensusScratch} from ${JSON.stringify(new URL('./census-scratch.ts',import.meta.url).href)};
const owner=ownCensusScratch(()=>{
 if(!existsSync(${JSON.stringify(drained)})){
  assert.ok(existsSync(join(owner.path,'snapshot/input')),'drain precedes scratch deletion');
  writeFileSync(${JSON.stringify(drained)},'drained');
 }
});
assert.equal(owner.path,join(process.env.TMPDIR,'conformance262',String(process.pid)));
mkdirSync(join(owner.path,'snapshot'),{recursive:true});
writeFileSync(join(owner.path,'snapshot/input'),'immutable bytes');
chmodSync(join(owner.path,'snapshot/input'),0o444);chmodSync(join(owner.path,'snapshot'),0o555);
writeFileSync(${JSON.stringify(ready)},owner.path);
if(${JSON.stringify(mode)}==='exception')throw Error('intentional census exception');
if(${JSON.stringify(mode)}==='SIGTERM')process.stdin.resume();
else owner.cleanup();
`);
  const temporary=join(root,'tmp');mkdirSync(temporary);
  if(mode==='SIGTERM'){
    const unit=toolingSlicePrefix('census-cleanup-'+randomUUID());
    t.after(()=>spawnSync('systemctl',['--user','stop',unit],{env:fixtureEnvironment(t),stdio:'ignore'}));
    const child=spawn('systemd-run',['--user','--wait','--pipe','--collect',...toolingSliceArgs(),'--unit='+unit,'-p','LimitCORE=0',
      '--setenv=TMPDIR='+temporary,'taskset','-c','0-3,6-31',process.execPath,helper],{env:fixtureEnvironment(t),stdio:['pipe','pipe','pipe']});
    let output='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>output+=bytes);
    const ended=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    await waitFor('census scratch ready',()=>existsSync(ready));
    const killed=spawnTest('systemctl',['--user','kill','--signal=SIGTERM',unit],{encoding:'utf8'});
    assert.equal(killed.status,0,killed.stderr);
    assert.equal(await ended,143,output);
  }else{
    const result=spawnTest(process.execPath,[helper],{encoding:'utf8',env:{...fixtureEnvironment(t),TMPDIR:temporary,NTS_CENSUS_DIR:undefined}});
    assert.equal(result.status,mode==='success'?0:1,result.stderr);
    if(mode==='exception')assert.match(result.stderr,/intentional census exception/);
  }
  const path=readFileSync(ready,'utf8');assert.ok(path.startsWith(temporary+'/'));
  assert.equal(readFileSync(drained,'utf8'),'drained');assert.equal(existsSync(path),false);
});
