import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {gzipSync,gunzipSync} from 'node:zlib';
import {publishInputTrace,readInputTraceIndex,type InputIndexRow} from './rust-test-inputs.ts';
import {authenticateRustInputTrace,type RustInputCapture} from './rust-input-authentication.ts';
import {testScratch} from './test-scratch.ts';

const fact=(text:string)=>({hex:Buffer.from(text).toString('hex'),error:0,truncated:false,null:false});
const target={package:'fixture',name:'unit',kind:['test'],source:'crate/src/lib.rs'};
function native(path:string,name='input'){
  return [
    {kind:'start',version:2,mechanism:'seccomp-user-notification',noNewPrivileges:true},
    {kind:'root-start',root:1},
    {kind:'attempt',id:'7',tid:1,tgid:1,ppid:0,birth:'1',parentBirth:'0',syscall:'openat',operation:'open',outcome:'unknown',
      canceled:false,factsComplete:true,args:['ffffffffffffff9c','0','0','0','0','0'],cwd:fact(path),image:fact('/fixture'),argvRead:false,argv:fact(''),
      paths:[{arg:1,dirfdArg:0,value:fact(name)}],dirfds:[{arg:0,fd:-100,target:fact(path)}]},
    {kind:'root-exit',root:1,exit:0,signal:0},
    {kind:'complete',complete:true,root:1,entered:true,execErrno:0,exit:0,signal:0,attempts:1,errors:0,drainComplete:true,observerSignal:0},
  ];
}
const put=(path:string,rows:unknown[])=>writeFileSync(path,gzipSync(rows.map(row=>JSON.stringify(row)).join('\n')+'\n'));
const rows=(path:string)=>gunzipSync(readFileSync(path)).toString().trim().split('\n').map(line=>JSON.parse(line) as InputIndexRow);

test('authentication binds all derived subjects and phases to the independently selected raw and target',async t=>{
  const root=testScratch(t,'input-authentication'),raw=join(root,'raw.gz'),index=join(root,'index.gz');
  put(raw,native('/source'));
  const capture:RustInputCapture={raw,index,cwd:'/source',root:'/source',target,observer:null};
  await publishInputTrace({...capture,output:index,observer:undefined});
  const result=await authenticateRustInputTrace(capture);
  assert.equal(result.header.observer,null,'historical absence remains explicit');assert.match(result.indexRowsSha256,/^[0-9a-f]{64}$/);
  const original=rows(index);
  for(const change of ['subject','phase','target','omission'] as const){
    const mutant=structuredClone(original),observation=mutant.find(row=>row.kind==='observation');
    assert.ok(observation&&observation.kind==='observation');
    if(change==='subject'){
      const subject=observation.subjects[0];assert.ok(subject?.kind==='path');
      subject.name='declared';subject.raw=Buffer.from(subject.name).toString('hex');
    }else if(change==='phase'){
      observation.source='another/src/lib.rs';const execution=mutant.find(row=>row.kind==='execution');assert.ok(execution?.kind==='execution');
      execution.phase.source=observation.source;
    }else if(change==='target'){
      const header=mutant[0];assert.ok(header?.kind==='index-start'&&header.target);header.target.name='other';
    }else{
      observation.subjects=[];const footer=mutant.at(-1);assert.ok(footer?.kind==='index-complete');footer.counts.observations=0;
    }
    const path=join(root,change+'.gz');put(path,mutant);
    await readInputTraceIndex(path,()=>{}); // Each mutant remains schema-valid.
    await assert.rejects(authenticateRustInputTrace({...capture,index:path}),/differs from authoritative raw derivation/,change);
  }
  put(raw,native('/source','other-raw-input'));
  await assert.rejects(authenticateRustInputTrace(capture),/differs from authoritative raw derivation/);
});

test('authoritative raw path and Cargo target cannot be replaced by index-local metadata',async t=>{
  const root=testScratch(t,'input-authentication-handoff'),raw=join(root,'raw.gz'),index=join(root,'index.gz');put(raw,native('/source'));
  const capture:RustInputCapture={raw,index,cwd:'/source',root:'/source',target,observer:null};
  await publishInputTrace({...capture,output:index,observer:undefined});
  await assert.rejects(authenticateRustInputTrace({...capture,target:{...target,name:'different'}}),/differs from authoritative raw derivation/);
  const alias=join(root,'same-bytes.gz');writeFileSync(alias,readFileSync(raw));
  await assert.rejects(authenticateRustInputTrace({...capture,raw:alias}),/differs from authoritative raw derivation/);
});

test('provisional matching is bound to consumed rows rather than a changed later index read',async t=>{
  const root=testScratch(t,'input-authentication-consumed'),raw=join(root,'raw.gz'),index=join(root,'index.gz');put(raw,native('/source'));
  const capture:RustInputCapture={raw,index,cwd:'/source',root:'/source',target,observer:null};
  await publishInputTrace({...capture,output:index,observer:undefined});
  const original=rows(index),mutated=structuredClone(original),observation=mutated.find(row=>row.kind==='observation');
  assert.ok(observation?.kind==='observation');const subject=observation.subjects[0];assert.ok(subject?.kind==='path');
  subject.name='replacement';subject.raw=Buffer.from(subject.name).toString('hex');
  const consumed:string[]=[];
  const receipt=await authenticateRustInputTrace(capture,row=>{
    if(row.kind==='observation')for(const subject of row.subjects)if(subject.kind==='path')consumed.push(subject.name);
    if(row.kind==='index-complete')put(index,mutated);
  });
  assert.deepEqual(consumed,['input']);assert.match(receipt.indexRowsSha256,/^[0-9a-f]{64}$/);
  await assert.rejects(authenticateRustInputTrace(capture),/differs from authoritative raw derivation/);
});
