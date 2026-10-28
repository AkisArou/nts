import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sampleLayouts,validateTrials,type Trial} from './layouts-sitting.ts';
const trials:Trial[]=Array.from({length:20},(_,i)=>({id:'draw-'+i,geometry:{base:'address-a-'+i,changed:'address-b-'+i},heapSeed:{base:i+1,changed:i+101}}));
const options={primary:'cycles',resamples:2000,confidence:0.95};

test('shared sitting keeps every bracket and uses independent layout means',async()=>{
 const root=mkdtempSync(join(process.env.TMPDIR??tmpdir(),'layouts-sitting-'));
 try {
  const out=join(root,'pass');
  const summary=await sampleLayouts(trials,out,{admit:async()=>({load:'synthetic'}),run:async cell=>({signature:'same-work',metrics:{cycles:cell.arm==='base'?100:80}})},options);
  assert.equal(summary.cycles.verdict,'improvement');
  const checkpoint=JSON.parse(readFileSync(join(out,'checkpoint.json'),'utf8'));
  assert.equal(checkpoint.state,'PASS');assert.equal(checkpoint.current,null);assert.equal(checkpoint.completed,220);
  assert.equal(summary.cycles.independentLayouts,20);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('wrong work and failed cells retain failure state, never a verdict',async()=>{
 const root=mkdtempSync(join(process.env.TMPDIR??tmpdir(),'layouts-failure-'));
 try {
  const out=join(root,'bad');let n=0;
  await assert.rejects(sampleLayouts(trials,out,{admit:async()=>({}),run:async()=>({signature:++n===2?'wrong':'same',metrics:{cycles:100}})},options),/signature/);
  const checkpoint=JSON.parse(readFileSync(join(out,'checkpoint.json'),'utf8'));
  assert.equal(checkpoint.state,'FAIL');assert.notEqual(checkpoint.current,null);assert.equal(checkpoint.completed,1);
  assert.throws(()=>readFileSync(join(out,'summary.json')));
  assert.throws(()=>validateTrials(trials.map(t=>({...t,geometry:{base:'same',changed:t.geometry.changed}})),options));
 } finally {rmSync(root,{recursive:true,force:true});}
});
