import assert from 'node:assert/strict';
import {rmSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {reserveJob,readLedger} from './memory-ledger.ts';
import {readCostHistory} from './step-scheduling.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {ownMemory} from './test-memory.ts';
import {newTestScratch} from './test-scratch.ts';

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
