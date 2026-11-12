import assert from 'node:assert/strict';
import {rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {reserveJob,readLedger} from './memory-ledger.ts';
import {readCostHistory} from './step-scheduling.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {ownMemory} from './test-memory.ts';
import {newTestScratch} from './test-scratch.ts';
import {spawnTest} from './test-wait.ts';

test('release records its final peak and returns memory synchronously, then the sampler acknowledges and exits',async t=>{
 const root=newTestScratch('sampler-close');t.after(()=>rmSync(root,{recursive:true,force:true}));
 const owned=ownMemory(join(root,'machine'),{resident:{kind:'fixed',defaultBytes:160*2**20}}),env:NodeJS.ProcessEnv={...fixtureEnvironment(t),...owned};
 delete env.NTS_MEMORY_RESERVATION;
 const held=await reserveJob({key:'sampler-close',what:'sampler close control'},{env,report:()=>{}});
 t.after(async()=>{held.release();await held.closed;});
 held.release();held.release();
 assert.equal(readLedger(owned.NTS_MEMORY_LEDGER).admitted.length,0,'the queue need not wait for thread exit');
 const peak=readCostHistory(join(owned.NTS_GATE_COSTS_DIR,'steps.json')).jobs.get('sampler-close')?.peaks.at(-1);
 assert.ok(peak&&peak>=160*2**20,'the final parent observation was recorded before release returned');
 await held.closed;
});


test('a file-backed sampler owns its execution flags independently of an eval parent',async t=>{
 const root=newTestScratch('sampler-flags');t.after(()=>rmSync(root,{recursive:true,force:true}));
 const preload=join(root,'parent-only.ts');writeFileSync(preload,`import {isMainThread} from 'node:worker_threads';if(!isMainThread)throw Error('parent preload reached sampler');`);
 const variants=[['--input-type=module'],['--input-type','module'],['--import',preload]];
 for(const [index,flags] of variants.entries())await t.test(flags.join(' '),context=>{
  const owned=ownMemory(join(root,String(index)),{resident:{kind:'fixed',defaultBytes:160*2**20}}),env:NodeJS.ProcessEnv={...fixtureEnvironment(context),...owned};
  delete env.NTS_MEMORY_RESERVATION;
  const code=`(async()=>{const {reserveJob}=await import(${JSON.stringify(new URL('./memory-ledger.ts',import.meta.url).href)});const held=await reserveJob({key:'sampler-flags',what:'sampler execution flag control'});held.release();await held.closed;console.log('sampler drained');})().catch(error=>{console.error(error);process.exitCode=1;});`;
  const result=spawnTest(process.execPath,[...flags,'-e',code],{env,encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/sampler drained/);
 });
});
