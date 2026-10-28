import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {sampleLayouts} from './layouts-sitting.ts';
import {checkedIntervalCase,recordIntervals} from './layouts-interval-record.ts';

test('published intervals must match complete raw coverage and signatures',async()=>{
 const parent=process.env.TMPDIR??join(homedir(),'.cache/nts-tests');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'layout-record-'));
 try{
  const run=join(root,'run');mkdirSync(run);const directory=join(run,'control-llvm');
  const trials=Array.from({length:20},(_,i)=>({id:'draw-'+i,geometry:{base:'a'+i,changed:'b'+i},heapSeed:{base:i+1,changed:i+101}}));
  const options={primary:'cycles',confidence:0.95,resamples:2000};
  const metrics=await sampleLayouts(trials,directory,{admit:async()=>({utc:'2026-01-01T00:00:00Z',load:'0.00 0 0',train:null}),
   run:async cell=>({signature:'work',metrics:{cycles:cell.arm==='base'?100:80},details:{scope:'test',end:{utc:'2026-01-01T00:01:00Z'}}})},options);
  writeFileSync(join(run,'checkpoint.json'),JSON.stringify({state:'PASS',current:null,pairs:1}));
  writeFileSync(join(run,'summary.json'),JSON.stringify([{name:'control',backend:'llvm',metrics}]));
  assert.equal(recordIntervals(run,join(root,'published')).cells,220);
  assert.match(readFileSync(join(root,'published/report.md'),'utf8'),/95.00%/);
  const summary=JSON.parse(readFileSync(join(directory,'summary.json'),'utf8'));summary.metrics.cycles.verdict='noise';
  writeFileSync(join(directory,'summary.json'),JSON.stringify(summary));
  assert.throws(()=>checkedIntervalCase(directory),/summary/);
  writeFileSync(join(directory,'summary.json'),JSON.stringify({primary:'cycles',verdict:'improvement',metrics}));
  const rows=JSON.parse(readFileSync(join(directory,'rows.json'),'utf8'));rows[0].observed.signature='wrong';
  writeFileSync(join(directory,'rows.json'),JSON.stringify(rows));
  assert.throws(()=>recordIntervals(run,join(root,'bad')),/signature/);
  assert.throws(()=>readFileSync(join(root,'bad/report.md')));
 }finally{rmSync(root,{recursive:true,force:true});}
});
