import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {calibration} from '../differential/record-call-costs.ts';

test('calibration requires complete validated calls and derives each arm separately',t=>{
  const root=mkdtempSync(join(tmpdir(),'nts-call-calibration-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const arms=['c','llvm','sanitized','jvm'];
  writeFileSync(join(root,'run.mjs'),'retained replay runner');
  writeFileSync(join(root,'result.json'),JSON.stringify({finished:'complete',pin:{sha:'verified-compiler'},node:'v24',nice:19,affinity:'4',
    arms:arms.map(name=>({name,backend:name==='sanitized'?'c':name,sanitizer:name==='sanitized'?'address':null,finished:'complete',load:'observed'}))}));
  for(const [index,arm] of arms.entries()) {
    mkdirSync(join(root,arm,'costs'),{recursive:true});
    writeFileSync(join(root,arm,'control.json'),JSON.stringify({fixture:'control',status:0,report:{version:1,status:'agrees',
      counts:{functions:1,expected:1,compared:1,unavailable:0,runtime_declined:0,timeouts:0,approximated:0,disagreements:0,aborts:0},
      oracle:{expected:1,received:1,complete:true},refusals:[],disagreements:[],aborts:[],error:null}}));
    writeFileSync(join(root,arm,'costs','check-1-0.jsonl'),[
      {event:'case',step:'bench-agree',binary_sha:'verified-compiler',backend:arm==='sanitized'?'c':arm,project:'control.tsconfig.json'},
      {event:'program.call',index:0,cpu_ticks:(index+1)*10,clock_ticks_per_second:100,cpu_scope:'driver-process-all-threads-and-waited-children',includes_startup:true},
    ].map(value=>JSON.stringify(value)).join('\n')+'\n');
  }
  const value=calibration(root,root,8,300);
  assert.deepEqual(arms.map(arm=>(value.arms[arm] as {allowance_seconds:number}).allowance_seconds),[1,2,3,4]);
  const path=join(root,'c','costs','check-1-0.jsonl'),original=readFileSync(path,'utf8');
  writeFileSync(path,original.replace('"cpu_ticks":10','"cpu_ticks":-1'));assert.throws(()=>calibration(root,root,8,300),/CPU sample/);
  writeFileSync(path,original.replace('"binary_sha":"verified-compiler"','"binary_sha":"another-compiler"'));assert.throws(()=>calibration(root,root,8,300));
  writeFileSync(path,original+original.split('\n')[1]+'\n');assert.throws(()=>calibration(root,root,8,300),/completed calls/);
  unlinkSync(path);assert.throws(()=>calibration(root,root,8,300),/lacks/);
});
