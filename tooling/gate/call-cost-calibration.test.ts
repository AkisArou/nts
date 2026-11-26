import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import test from 'node:test';
import {calibration} from '../differential/record-call-costs.ts';

test('calibration requires complete validated calls and derives each arm separately',async t=>{
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
  const value=await calibration(root,root,8,300);
  assert.deepEqual(arms.map(arm=>(value.arms[arm] as {allowance_seconds:number}).allowance_seconds),[1,2,3,4]);
  const path=join(root,'c','costs','check-1-0.jsonl'),original=readFileSync(path,'utf8');
  const compact=join(root,'c','costs','check-1.jsonl'),events=original.trim().split('\n').map(line=>JSON.parse(line));
  unlinkSync(path);
  writeFileSync(compact,events.map(row=>JSON.stringify({...row,session:0})).join('\n')+'\n');
  const compactValue=await calibration(root,root,8,300);
  const withoutEvidence=(row:unknown)=>{const {evidence,...facts}=row as Record<string,unknown>;return facts;};
  assert.deepEqual(withoutEvidence(compactValue.arms.c),withoutEvidence(value.arms.c));
  const second=join(root,'c','second.json');
  writeFileSync(second,readFileSync(join(root,'c','control.json'),'utf8').replace('"fixture":"control"','"fixture":"second"'));
  writeFileSync(compact,[...events.map(row=>({...row,session:0})),...events.map(row=>({...row,session:1,...(row.event==='case'?{project:'second.tsconfig.json'}:{})}))].map(row=>JSON.stringify(row)).join('\n')+'\n');
  const both=(await calibration(root,root,8,300)).arms.c as {accepted_projects:number;completed_calls:number};
  assert.equal(both.accepted_projects,2);assert.equal(both.completed_calls,2);
  const worker=join(root,'c','costs','check-worker-0.jsonl.gz'),hashes=new Map<string,number>();
  const reversed=[1,0].flatMap(session=>[...events.map(row=>({...row,session,...(row.event==='case'?{project:session?'second.tsconfig.json':'control.tsconfig.json'}:{})})),{event:'end',phase:'check.total',session}]);
  writeFileSync(worker,gzipSync(reversed.map(record=>JSON.stringify({producer:1,pid:1,record})).join('\n')+'\n'));unlinkSync(compact);
  const compressed=await calibration(root,root,8,300,{hashFile:file=>{
    hashes.set(file,(hashes.get(file)??0)+1);return createHash('sha256').update(readFileSync(file)).digest('hex');
  }});
  assert.deepEqual(withoutEvidence(compressed.arms.c),withoutEvidence(both),'gzip completion order retains every fact, including the legacy maximum tie');
  assert.equal(hashes.get(worker),1,'one archive is hashed once, regardless of its case count');
  unlinkSync(worker);unlinkSync(second);writeFileSync(path,original);
  writeFileSync(path,original.replace('"cpu_ticks":10','"cpu_ticks":-1'));await assert.rejects(()=>calibration(root,root,8,300),/CPU sample/);
  writeFileSync(path,original.replace('"binary_sha":"verified-compiler"','"binary_sha":"another-compiler"'));await assert.rejects(()=>calibration(root,root,8,300));
  writeFileSync(path,original+original.split('\n')[1]+'\n');await assert.rejects(()=>calibration(root,root,8,300),/completed calls/);
  unlinkSync(path);await assert.rejects(()=>calibration(root,root,8,300),/lacks/);
});
