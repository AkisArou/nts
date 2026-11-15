import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,readlinkSync,symlinkSync,unlinkSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';
import type {FileObserverReceipt} from './file-input-observer.ts';
import {moduleGraph,type InputSnapshot} from './module-closure.ts';
import {captureReaderObservations} from './reader-observations.ts';
import {runtimeSubjectValidator,runtimeAssessmentScope,validateRustInputCapture} from './rust-input-validation.ts';
import {publishInputTrace,type RuntimeObservation,type InputSubject,type InputIndexRow} from './rust-test-inputs.ts';
import {gzipSync,gunzipSync} from 'node:zlib';
import {testScratch} from './test-scratch.ts';
import {readRustInputValidation,decodeRustInputSubject,rustInputReportPool} from './rust-input-report.ts';
import {durableRecordStream} from './durable-record.ts';
import type {RuntimeInputClaim} from './rust-input-claims.ts';

const basis:FileObserverReceipt={version:1,observedPath:'/observer',artifactPath:'/retained/observer',sha256:'0'.repeat(64),sourceSha256:'1'.repeat(64),abi:'linux-x86_64-v1'};
const snapshot=(files:string[]):InputSnapshot=>({files,ownedFiles:files,moduleFiles:[],hostFiles:[],placingFiles:files,directories:[],optionalFiles:[],memberships:[],observations:[]});
const request=(cwd:string):RuntimeObservation=>({phase:'test-runtime',source:'crate/src/lib.rs',attempt:{id:'1',tid:1,tgid:1,ppid:0,birth:'1',parentBirth:'0'},
  cwd,args:['ffffffffffffff9c','0','0','0','0','0'],operation:'open',syscall:'openat',outcome:'unknown',image:1,canceled:false,subjects:[],probes:[]});
const subject=(root:string,name:string):InputSubject=>({kind:'path',arg:1,dirfdArg:0,name,raw:Buffer.from(name).toString('hex'),anchor:{kind:'cwd',path:root}});

test('a declared endpoint reached through an undeclared source alias remains uncovered',t=>{
  const root=testScratch(t,'runtime-validator');mkdirSync(join(root,'data'));writeFileSync(join(root,'data/target'),'target');
  symlinkSync('data/target',join(root,'alias'));
  const inputs=snapshot(['data/target']),validator=runtimeSubjectValidator(root,inputs),row=request(root);
  const direct=validator.assess(row,subject(root,'data/target'),basis);assert.equal(direct.state,'claimed');
  const aliased=validator.assess(row,subject(root,'alias'),basis);
  assert.equal(aliased.endpoint?.kind,'claimed');assert.equal(aliased.state,'uncovered');
  assert.ok(aliased.components.some(row=>row.observation.kind==='readlink'&&row.answer.kind==='uncovered'));
  assert.equal(aliased.outcome,'unknown');assert.equal(aliased.identityBasis,'current-source');
});

test('captured alias facts retain independent authority and a changed target invalidates it',t=>{
  const root=testScratch(t,'runtime-validator-facts');mkdirSync(join(root,'data'));
  for(const name of ['first','second'])writeFileSync(join(root,'data',name),name);
  symlinkSync('data/first',join(root,'alias'));
  const inputs=snapshot(['data/first','data/second']),filesystem=new OracleFilesystem();filesystem.readlink(join(root,'alias'));
  inputs.observations=captureReaderObservations(root,filesystem.captured()).map(row=>({reader:'entry.ts',protocol:'project',context:{entry:'<entry>',dataNamespaces:{}},...row}));
  const validator=runtimeSubjectValidator(root,inputs),row=request(root);
  assert.equal(validator.assess(row,subject(root,'alias'),basis).state,'claimed');
  unlinkSync(join(root,'alias'));symlinkSync('data/second',join(root,'alias'));assert.equal(readlinkSync(join(root,'alias')),'data/second');
  const changed=validator.assess(row,subject(root,'alias'),basis);
  assert.equal(changed.endpoint?.kind,'claimed','both endpoint files are declared');assert.equal(changed.state,'uncovered');
  assert.ok(changed.components.some(row=>row.observation.kind==='readlink'&&row.answer.kind==='uncovered'));
});

test('new captures retain their source endpoint after an alias or descriptor pathname is replaced',t=>{
  const root=testScratch(t,'captured-source-identity');mkdirSync(join(root,'data'));
  const first=join(root,'data/first'),second=join(root,'data/second'),alias=join(root,'alias');
  writeFileSync(first,'first');writeFileSync(second,'second');symlinkSync('data/first',alias);
  const observed:InputSubject={...subject(root,'alias'),kind:'path',arg:1,dirfdArg:0,name:'alias',raw:Buffer.from('alias').toString('hex'),anchor:{kind:'cwd',path:root},
    resolution:{state:'resolved',path:first,finalLink:true,components:[
      {path:root,kind:'directory',dev:'1',ino:'1'},
      {path:alias,kind:'symlink',dev:'1',ino:'2',link:'data/first'},
      {path:join(root,'data'),kind:'directory',dev:'1',ino:'3'},
      {path:first,kind:'file',dev:'1',ino:'4'},
    ]}};
  unlinkSync(alias);symlinkSync('data/second',alias);
  const inputs=snapshot(['data/second']),filesystem=new OracleFilesystem();filesystem.readlink(alias);
  inputs.observations=captureReaderObservations(root,filesystem.captured()).map(row=>({reader:'entry.ts',protocol:'project',context:{entry:'<entry>',dataNamespaces:{}},...row}));
  const row=request(root),legacy=runtimeSubjectValidator(root,inputs).assess(row,subject(root,'alias'),basis);
  assert.equal(legacy.identity?.path,second);assert.equal(legacy.identityBasis,'current-source');
  const captured=runtimeSubjectValidator(root,inputs,{capturedIdentities:true}).assess(row,observed,basis);
  assert.equal(captured.identityBasis,'capture-components');assert.equal(captured.identity?.path,first);assert.equal(captured.endpoint?.kind,'uncovered');
  assert.ok(captured.components.some(part=>part.observation.kind==='readlink'&&part.observation.value==='data/first'&&part.answer.kind==='uncovered'));
  unlinkSync(first);symlinkSync('second',first);
  const descriptor:InputSubject={kind:'descriptor',arg:0,fd:3,target:first,raw:Buffer.from(first).toString('hex')};
  const stat={...row,operation:'descriptor',syscall:'fstat',args:['3','0','0','0','0','0']};
  const fd=runtimeSubjectValidator(root,inputs,{capturedIdentities:true}).assess(stat,descriptor,basis);
  assert.equal(fd.identityBasis,'capture-descriptor');assert.equal(fd.identity?.path,first);assert.equal(fd.endpoint?.kind,'uncovered');
  const missing=runtimeSubjectValidator(root,inputs,{capturedIdentities:true}).assess(row,subject(root,'alias'),basis);
  assert.equal(missing.state,'uncovered');assert.equal(missing.identity,undefined);assert.match(missing.reason!,/capture-time.*unavailable/);
});

test('conservative component checks refuse introduced aliases and captured file or directory replacement',t=>{
  const root=testScratch(t,'conservative-validator-components');mkdirSync(join(root,'types/nested'),{recursive:true});writeFileSync(join(root,'reader.rs'),'');
  for(const name of ['first','second','nested/old'])writeFileSync(join(root,'types',name),name);
  const graph=moduleGraph({sourceRoot:root,declarations:new Map([['reader.rs',{imports:[],assets:[{kind:'conservative',path:'./types/'}]}]])});
  let inputs:InputSnapshot;try{inputs=graph.describe(['reader.rs']);}finally{graph.close();}
  const validator=runtimeSubjectValidator(root,inputs),row=request(root),assess=(name:string)=>validator.assess(row,subject(root,name),basis);
  assert.equal(assess('types/first').state,'claimed');assert.equal(assess('types/absent').state,'claimed','captured parent names prove the exact missing child');
  symlinkSync('first',join(root,'types/alias'));const introduced=assess('types/alias');assert.equal(introduced.state,'uncovered');
  assert.ok(introduced.components.some(row=>row.observation.kind==='readlink'&&row.answer.kind==='uncovered'));
  unlinkSync(join(root,'types/alias'));symlinkSync('second',join(root,'types/alias'));assert.equal(assess('types/alias').state,'uncovered');
  unlinkSync(join(root,'types/first'));symlinkSync('second',join(root,'types/first'));const file=assess('types/first');
  assert.equal(file.endpoint?.kind,'claimed');assert.equal(file.state,'uncovered','generic immutable bytes do not bypass the captured kind');
  rmSync(join(root,'types/nested'),{recursive:true});symlinkSync('.',join(root,'types/nested'));const directory=assess('types/nested/second');
  assert.equal(directory.endpoint?.kind,'claimed');assert.equal(directory.state,'uncovered','generic ancestor/directory claims do not bypass the captured kind');
});

test('outside aliases resolve before classification while every external component stays explicit',t=>{
  const base=testScratch(t,'runtime-validator-outside'),root=join(base,'source'),outside=join(base,'outside');mkdirSync(root);mkdirSync(outside);
  writeFileSync(join(root,'target'),'owned');symlinkSync(join(root,'target'),join(outside,'alias'));
  const validator=runtimeSubjectValidator(root,snapshot(['target']));
  const name=join(outside,'alias'),absolute:InputSubject={kind:'path',arg:1,dirfdArg:0,name,raw:Buffer.from(name).toString('hex'),anchor:{kind:'absolute'}};
  const result=validator.assess(request(root),absolute,basis);
  assert.equal(result.identity?.path,join(root,'target'));assert.equal(result.endpoint?.kind,'claimed');assert.equal(result.state,'uncovered');
  assert.ok(result.components.some(row=>row.observation.path===outside&&row.answer.kind==='uncovered'));
  assert.ok(result.components.some(row=>row.observation.kind==='readlink'&&row.observation.path===name));
  const scope=runtimeAssessmentScope(root,result);assert.equal(scope.scope,'repository');
  assert.equal(scope.endpoint?.state,'claimed');assert.equal(scope.repositoryEndpointGaps,0);
  assert.ok(scope.externalComponentGaps>0,'external alias components remain independent of the repository endpoint');
});

test('report scope separates external endpoints, repository aliases and unresolved identities',t=>{
  const base=testScratch(t,'runtime-validation-report-scope'),root=join(base,'source'),outside=join(base,'outside');mkdirSync(root);mkdirSync(outside);
  writeFileSync(join(outside,'input'),'external bytes');symlinkSync(join(outside,'input'),join(root,'alias'));
  const validator=runtimeSubjectValidator(root,snapshot([])),assess=(name:string)=>{
    const requestSubject:InputSubject={kind:'path',arg:1,dirfdArg:0,name,raw:Buffer.from(name).toString('hex'),anchor:{kind:'absolute'}};
    return validator.assess(request(root),requestSubject,basis);
  };
  const direct=runtimeAssessmentScope(root,assess(join(outside,'input')));
  assert.equal(direct.scope,'external');assert.equal(direct.repositoryEndpointGaps,0);assert.equal(direct.repositoryComponentGaps,0);assert.equal(direct.externalEndpointGaps,1);
  const alias=runtimeAssessmentScope(root,assess(join(root,'alias')));
  assert.equal(alias.scope,'external');assert.ok(alias.repositoryComponentGaps>0,'an outside endpoint cannot hide its in-repository alias');
  const missing=runtimeAssessmentScope(root,assess(join(outside,'missing','tail')));
  assert.equal(missing.scope,'unresolved');assert.equal(missing.endpoint,undefined,'original outside spelling cannot classify a stopped identity');
  symlinkSync('loop',join(outside,'loop'));const cycle=assess(join(outside,'loop'));
  assert.match(cycle.reason!,/identity unresolved/);assert.ok(cycle.components.length>0,'partial component obligations survive identity failure');
  assert.equal(runtimeAssessmentScope(root,cycle).scope,'unresolved');
  const unknown=validator.assess(request(root),subject(root,'alias'),null);
  assert.equal(runtimeAssessmentScope(root,unknown).scope,'unresolved','unknown operation scope never defaults to external');
});

test('raw component order and current attempt cwd survive composition without lexical guessing',t=>{
  const root=testScratch(t,'runtime-validator-components');mkdirSync(join(root,'physical'));mkdirSync(join(root,'physical/child'));
  writeFileSync(join(root,'physical/target'),'physical');writeFileSync(join(root,'target'),'trap');symlinkSync('physical/child',join(root,'jump'));
  const inputs=snapshot(['physical/target']),filesystem=new OracleFilesystem();filesystem.readlink(join(root,'jump'));
  inputs.observations=captureReaderObservations(root,filesystem.captured()).map(row=>({reader:'entry.ts',protocol:'project',context:{entry:'<entry>',dataNamespaces:{}},...row}));
  const validator=runtimeSubjectValidator(root,inputs),result=validator.assess(request(root),subject(root,'jump/../target'),basis);
  assert.equal(result.spelling,root+'/jump/../target');assert.equal(result.identity?.path,join(root,'physical/target'));
  assert.equal(result.state,'uncovered','entering the alias target directory is an independent dependency before ..');
  filesystem.directoryExists(join(root,'physical/child'));
  inputs.observations=captureReaderObservations(root,filesystem.captured()).map(row=>({reader:'entry.ts',protocol:'project',context:{entry:'<entry>',dataNamespaces:{}},...row}));
  assert.equal(runtimeSubjectValidator(root,inputs).assess(request(root),subject(root,'jump/../target'),basis).state,'claimed');
  assert.equal(validator.assess(request(root),subject(root,'missing/../target'),basis).state,'uncovered');
  assert.equal(validator.assess(request(root),subject(root,'physical/target'),null).state,'uncovered');
});

test('coverage publication waits for raw authentication and preserves named unknown requirements',async t=>{
  const root=testScratch(t,'runtime-validation-publication'),raw=join(root,'raw.gz'),index=join(root,'index.gz'),output=join(root,'report.gz');
  const bytes=(text:string)=>({hex:Buffer.from(text).toString('hex'),error:0,truncated:false,null:false});
  const native=[{kind:'start',version:2,mechanism:'seccomp-user-notification',noNewPrivileges:true},{kind:'root-start',root:1},
    {kind:'attempt',id:'1',tid:1,tgid:1,ppid:0,birth:'1',parentBirth:'0',syscall:'openat',operation:'open',outcome:'unknown',
      canceled:false,factsComplete:true,args:['ffffffffffffff9c','0','0','0','0','0'],cwd:bytes(root),image:bytes('/fixture'),argvRead:false,argv:bytes(''),
      paths:[{arg:1,dirfdArg:0,value:bytes('input')}],dirfds:[{arg:0,fd:-100,target:bytes(root)}]},
    {kind:'root-exit',root:1,exit:0,signal:0},
    {kind:'complete',complete:true,root:1,entered:true,execErrno:0,exit:0,signal:0,attempts:1,errors:0,drainComplete:true,observerSignal:0}];
  writeFileSync(raw,gzipSync(native.map(row=>JSON.stringify(row)).join('\n')+'\n'));
  const target={source:'crate/src/lib.rs',name:'unit',kind:['test']},capture={raw,index,cwd:root,root,target:{package:'fixture',...target},observer:null};
  const targets=new Map([[target.source,{target:{...target,unitTests:true,doctests:false},snapshot:snapshot([])}]]);
  await publishInputTrace({...capture,output:index,observer:undefined});
  const result=await validateRustInputCapture({capture,targets,output});
  assert.equal(result.coverage,'incomplete');assert.equal(result.counts.gaps,1);
  assert.equal(result.repositoryCoverage,'unresolved');assert.equal(result.counts.unresolvedSubjects,1);
  const report:Record<string,unknown>[]=[];await readRustInputValidation(output,(row,resolve)=>{report.push(decodeRustInputSubject(row,resolve));});
  const attempt=report.find(row=>row.kind==='runtime-subject');assert.ok(attempt);assert.equal(attempt.outcome,'unknown');
  assert.equal(attempt.reason,'missing authenticated capture ABI');assert.equal(report.at(-1)?.coverage,'incomplete');
  assert.equal(report.at(-1)?.repositoryCoverage,'unresolved');assert.equal(report.at(-1)?.version,5);
  const mutant=gunzipSync(readFileSync(index)).toString().trim().split('\n').map(line=>JSON.parse(line) as InputIndexRow);
  const observation=mutant.find(row=>row.kind==='observation');assert.ok(observation?.kind==='observation');
  const input=observation.subjects[0];assert.ok(input?.kind==='path');input.name='replacement';input.raw=Buffer.from(input.name).toString('hex');
  writeFileSync(index,gzipSync(mutant.map(row=>JSON.stringify(row)).join('\n')+'\n'));
  const refused=join(root,'refused.gz');
  await assert.rejects(validateRustInputCapture({capture,targets,output:refused}),/differs from authoritative raw derivation/);
  assert.equal(existsSync(refused),false,'provisional matches cannot publish an accepted final artifact');
  await assert.rejects(validateRustInputCapture({capture,targets:new Map(),output:join(root,'missing-owner.gz')}),/runtime source has no Cargo declaration/);
  const wrongRoute=new Map([[target.source,{target:{...target,unitTests:false,doctests:true},snapshot:snapshot([])}]]);
  await assert.rejects(validateRustInputCapture({capture,targets:wrongRoute,output:join(root,'wrong-route.gz')}),/target does not own test-runtime/);
});

test('decision reports count discharged and setup attempts while retaining every unresolved subject',async t=>{
  const root=testScratch(t,'runtime-validation-retention'),raw=join(root,'raw.gz'),index=join(root,'index.gz'),output=join(root,'report.gz');
  writeFileSync(join(root,'declared'),'input');
  const bytes=(text:string)=>({hex:Buffer.from(text).toString('hex'),error:0,truncated:false,null:false});
  const observer:FileObserverReceipt={...basis,observedPath:process.execPath,artifactPath:process.execPath,
    sha256:createHash('sha256').update(readFileSync(process.execPath)).digest('hex')};
  const attempts=['declared','undeclared'].map((name,i)=>({kind:'attempt',id:String(i+1),tid:1,tgid:1,ppid:0,birth:'1',parentBirth:'0',
    syscall:'openat',operation:'open',outcome:'unknown',canceled:false,factsComplete:true,args:['ffffffffffffff9c','0','0','0','0','0'],
    cwd:bytes(root),image:bytes(process.execPath),argvRead:false,argv:bytes(''),paths:[{arg:1,dirfdArg:0,value:bytes(name)}],dirfds:[{arg:0,fd:-100,target:bytes(root)}]}));
  const native=[{kind:'start',version:2,mechanism:'seccomp-user-notification',noNewPrivileges:true},{kind:'root-start',root:1},...attempts,
    {kind:'root-exit',root:1,exit:0,signal:0},
    {kind:'complete',complete:true,root:1,entered:true,execErrno:0,exit:0,signal:0,attempts:2,errors:0,drainComplete:true,observerSignal:0}];
  writeFileSync(raw,gzipSync(native.map(row=>JSON.stringify(row)).join('\n')+'\n'));
  const target={source:'crate/src/lib.rs',name:'unit',kind:['test']},capture={raw,index,cwd:root,root,target:{package:'fixture',...target},observer};
  const targets=new Map([[target.source,{target:{...target,unitTests:true,doctests:false},snapshot:snapshot(['declared'])}]]);
  await publishInputTrace({...capture,output:index});
  const result=await validateRustInputCapture({capture,targets,output});
  assert.equal(result.counts.subjects,2);assert.equal(result.counts.claimed,1);assert.equal(result.counts.gaps,1);assert.equal(result.counts.reportedSubjects,1);
  const rows:Record<string,unknown>[]=[];
  await readRustInputValidation(output,(row,resolve)=>{rows.push(decodeRustInputSubject(row,resolve));});
  const retained=rows.filter(row=>row.kind==='runtime-subject');assert.equal(retained.length,1);
  assert.equal((retained[0]!.subject as InputSubject).kind,'path');
  assert.equal((retained[0]!.subject as Extract<InputSubject,{kind:'path'}>).name,'undeclared');
  const changed=gunzipSync(readFileSync(output)).toString().trim().split('\n').map(line=>JSON.parse(line));
  changed.at(-1).counts.claimed=0;
  const corrupt=join(root,'counts-mutant.gz');writeFileSync(corrupt,gzipSync(changed.map(row=>JSON.stringify(row)).join('\n')+'\n'));
  await assert.rejects(readRustInputValidation(corrupt,()=>{}),/discharge counts differ/);
  const setup={raw,index:join(root,'setup-index.gz'),cwd:root,root,observer};await publishInputTrace({...setup,output:setup.index});
  const setupOutput=join(root,'setup-report.gz'),setupResult=await validateRustInputCapture({capture:setup,targets:new Map(),output:setupOutput});
  assert.equal(setupResult.counts.setupAttempts,2);assert.equal(setupResult.counts.subjects,0);
  await readRustInputValidation(setupOutput,row=>{assert.notEqual(row.kind,'setup-attempt');assert.notEqual(row.kind,'runtime-subject');});
});

test('one normalized report preserves every claim and component while repeated syscalls reference it once',async t=>{
  const root=testScratch(t,'runtime-report-pool'),path=join(root,'report.gz'),rows:Record<string,unknown>[]=[];
  const claims:RuntimeInputClaim[]=Array.from({length:100},(_,index)=>({role:'bytes',reader:'reader-'+index,path:'input-'+index}));
  const base=runtimeSubjectValidator(root,snapshot([])).assess(request(root),subject(root,'absent'),basis);
  const assessment={...base,endpoint:{kind:'claimed' as const,claims},components:[
    {observation:{kind:'runtimeKind' as const,path:root,value:'directory'},answer:{kind:'claimed' as const,claims}},
    {observation:{kind:'runtimeKind' as const,path:join(root,'absent'),value:null},answer:{kind:'uncovered' as const,reason:'exact negative'}},
  ]};
  const original={kind:'runtime-subject',...assessment,scope:runtimeAssessmentScope(root,assessment)};
  const pool=rustInputReportPool(async value=>{rows.push(value as Record<string,unknown>);});
  rows.push({kind:'validation-start',version:3});
  for(let index=0;index<100;index++)rows.push({kind:'runtime-subject',...await pool.subject({...assessment,scope:original.scope})});
  rows.push({kind:'validation-complete',version:3,complete:true});
  assert.ok(rows.filter(row=>row.kind==='validation-table').length<10);
  assert.ok(Buffer.byteLength(JSON.stringify(rows))<Buffer.byteLength(JSON.stringify(Array(100).fill(original)))/2);
  const write=async(file:string,values:unknown[])=>durableRecordStream(file,async append=>{for(const value of values)await append(JSON.stringify(value)+'\n');},{gzip:true});
  await write(path,rows);let count=0;
  await readRustInputValidation(path,(row,resolve)=>{
    if(row.kind!=='runtime-subject')return;
    const decoded=decodeRustInputSubject(row,resolve);assert.deepEqual(decoded,original);count++;
    (decoded.endpoint as {claims:RuntimeInputClaim[]}).claims[0]!.reader='consumer mutation';
  });assert.equal(count,100);
  const changed=structuredClone(rows),entry=changed.find(row=>row.kind==='validation-table')!;entry.value=['tampered'];
  const corrupt=join(root,'changed-table.gz');await write(corrupt,changed);
  await assert.rejects(readRustInputValidation(corrupt,()=>{}),/table hash/);
  const missing=structuredClone(rows),attempt=missing.find(row=>row.kind==='runtime-subject')!;attempt.components={state:'claimed',ref:'0'.repeat(64)};
  const absent=join(root,'missing-reference.gz');await write(absent,missing);
  await assert.rejects(readRustInputValidation(absent,()=>{}),/missing table reference/);
});
