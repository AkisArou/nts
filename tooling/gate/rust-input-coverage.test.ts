import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import type {FileObserverReceipt} from './file-input-observer.ts';
import type {InputSnapshot} from './module-closure.ts';
import {publishInputTrace} from './rust-test-inputs.ts';
import {testScratch} from './test-scratch.ts';
import {coverageOfCaptures,coverageOfReports,decide,describeCoverage,trackedFrom,MEMBERSHIP_PROBE,type TestReach} from './rust-input-coverage.ts';

const snapshot=(files:string[]):InputSnapshot=>({files,ownedFiles:files,moduleFiles:[],hostFiles:[],placingFiles:files,stagingFiles:files,directories:[],optionalFiles:[],memberships:[],observations:[]});
const bytes=(text:string)=>({hex:Buffer.from(text).toString('hex'),error:0,truncated:false,null:false});

/** One test binary that opens each named file relative to the repository. */
async function opened(t:Parameters<typeof testScratch>[0],name:string,declared:string[],reads:string[]){
  const root=testScratch(t,name),trace=join(root,'.trace');mkdirSync(trace);
  for(const file of [...declared,...reads])writeFileSync(join(root,file),file);
  const observer:FileObserverReceipt={version:1,observedPath:process.execPath,artifactPath:process.execPath,abi:'linux-x86_64-v1',
    sourceSha256:'1'.repeat(64),sha256:createHash('sha256').update(readFileSync(process.execPath)).digest('hex')};
  const attempts=reads.map((file,i)=>({kind:'attempt',id:String(i+1),tid:1,tgid:1,ppid:0,birth:'1',parentBirth:'0',
    syscall:'openat',operation:'open',outcome:'unknown',canceled:false,factsComplete:true,args:['ffffffffffffff9c','0','0','0','0','0'],
    cwd:bytes(root),image:bytes(process.execPath),argvRead:false,argv:bytes(''),paths:[{arg:1,dirfdArg:0,value:bytes(file)}],dirfds:[{arg:0,fd:-100,target:bytes(root)}]}));
  const native=[{kind:'start',version:2,mechanism:'seccomp-user-notification',noNewPrivileges:true},{kind:'root-start',root:1},...attempts,
    {kind:'root-exit',root:1,exit:0,signal:0},
    {kind:'complete',complete:true,root:1,entered:true,execErrno:0,exit:0,signal:0,attempts:attempts.length,errors:0,drainComplete:true,observerSignal:0}];
  const raw=join(trace,'binary-0.raw.gz'),index=join(trace,'binary-0.index.jsonl.gz');
  writeFileSync(raw,gzipSync(native.map(row=>JSON.stringify(row)).join('\n')+'\n'));
  const target={source:'crate/tests/integration.rs',name:'integration',kind:['test']},capture={raw,index,cwd:root,root,target:{package:'fixture',...target},observer};
  await publishInputTrace({...capture,output:index});
  const targets=new Map([[target.source,{target:{...target,unitTests:true,doctests:false},snapshot:snapshot(declared)}]]);
  return {root,trace,capture,targets};
}

// Selection's answer, supplied: a change owes the tests only at these paths.
const none={present:()=>true,ignored:()=>new Set<string>()};
const reachOf=(owing:string[]):TestReach=>change=>owing.includes(change.path)?['a declared reader']:[];

test('a test that opens a tracked file no change to which owes the tests fails by name; its declared control passes',async t=>{
  const tracked=trackedFrom(['fixture.ts','data.json'],none);
  const undeclared=await opened(t,'coverage-undeclared',['fixture.ts'],['fixture.ts','data.json']);
  const result=await coverageOfCaptures({root:undeclared.root,captures:[{file:'binary-0.raw.gz',capture:undeclared.capture}],
    reports:join(undeclared.trace,'reports'),targets:undeclared.targets,tracked,reach:reachOf(['fixture.ts'])});
  assert.deepEqual(result.missed.map(gap=>[gap.path,gap.kind,gap.source]),[['data.json','endpoint','crate/tests/integration.rs']]);
  assert.match(describeCoverage(result).join('\n'),/data\.json \(file, content, test-runtime of crate\/tests\/integration\.rs/);
  // The control differs only in declaring the file it reads.
  const declared=await opened(t,'coverage-declared',['fixture.ts','data.json'],['fixture.ts','data.json']);
  const control=await coverageOfCaptures({root:declared.root,captures:[{file:'binary-0.raw.gz',capture:declared.capture}],
    reports:join(declared.trace,'reports'),targets:declared.targets,tracked,reach:reachOf(['fixture.ts','data.json'])});
  assert.deepEqual(control.missed,[]);assert.deepEqual(control.untracked,[]);
  assert.equal(control.captures[0]?.repositoryCoverage,'complete');
});

test('an operation the validator cannot claim is still covered when a change to its path owes the tests',async t=>{
  const run=await opened(t,'coverage-reached',[],['data.json']);
  const result=await coverageOfCaptures({root:run.root,captures:[{file:'binary-0.raw.gz',capture:run.capture}],
    reports:join(run.trace,'reports'),targets:run.targets,tracked:trackedFrom(['data.json'],none),reach:reachOf(['data.json'])});
  assert.deepEqual(result.missed,[]);
  assert.deepEqual(result.reached.map(gap=>[gap.path,gap.reachedBy]),[['data.json','a declared reader']]);
  const again=await coverageOfReports({root:run.root,reports:join(run.trace,'reports'),tracked:trackedFrom(['data.json'],none),reach:reachOf([])});
  assert.deepEqual(again.missed.map(gap=>gap.path),['data.json'],'deciding from saved reports asks selection afresh');
});

test('a listed directory is reached only by a change to its membership; a stat of one by a file beneath it',()=>{
  const tracked=trackedFrom(['cases/a/case.ts','cases/b/case.ts'],none);
  const candidate=(path:string,requirements:string[])=>({path,tracked:tracked.kind(path),kind:'endpoint' as const,source:'crate/src/lib.rs',phase:'test-runtime',requirements,reason:null});
  const owing:TestReach=change=>change.path==='cases/a/case.ts'?['a declared file']:[];
  const listed=decide([candidate('cases',['enumeration'])],tracked,owing);
  assert.deepEqual(listed.missed.map(gap=>gap.path),['cases'],'reading one member does not declare the listing');
  const membership:TestReach=change=>change.added&&change.path==='cases/'+MEMBERSHIP_PROBE?['a directory membership']:[];
  assert.deepEqual(decide([candidate('cases',['enumeration'])],tracked,membership).missed,[]);
  const stat=decide([candidate('cases',['metadata:stat'])],tracked,owing);
  assert.deepEqual(stat.reached.map(gap=>[gap.path,gap.via]),[['cases','cases/a/case.ts']]);
  assert.deepEqual(decide([candidate('cases/b',['metadata:stat'])],tracked,owing).missed.map(gap=>gap.path),['cases/b']);
});

test('an undeclared read of present untracked bytes is reported, never owed: no commit can change it',async t=>{
  const run=await opened(t,'coverage-untracked',[],['scratch.out']);
  const result=await coverageOfCaptures({root:run.root,captures:[{file:'binary-0.raw.gz',capture:run.capture}],
    reports:join(run.trace,'reports'),targets:run.targets,tracked:trackedFrom([],none),reach:reachOf([])});
  assert.deepEqual(result.missed,[]);
  assert.deepEqual(result.untracked.map(gap=>[gap.path,gap.state]),[['scratch.out','untracked']]);
});

test('a lookup of an absent path a commit could add owes the tests on that addition; an ignored one is reported',()=>{
  const candidate=(path:string)=>({path,tracked:null,kind:'endpoint' as const,source:'crate/src/lib.rs',phase:'test-runtime',requirements:['metadata:stat'],reason:null});
  const absent={present:()=>false,ignored:(paths:readonly string[])=>new Set(paths.filter(path=>path.startsWith('node_modules/')))};
  const tracked=trackedFrom(['cases/a.ts'],absent);
  const unowed=decide([candidate('cases/a.d.ts'),candidate('node_modules/x/package.json')],tracked,()=>[]);
  assert.deepEqual(unowed.missed.map(gap=>gap.path),['cases/a.d.ts']);
  assert.deepEqual(unowed.untracked.map(gap=>[gap.path,gap.state]),[['node_modules/x/package.json','absent-ignored']]);
  const owed=decide([candidate('cases/a.d.ts')],tracked,change=>change.added&&change.path==='cases/a.d.ts'?['a new member of the cases']:[]);
  assert.deepEqual(owed.missed,[]);assert.equal(owed.reached[0]?.reachedBy,'a new member of the cases');
  // Crossing an absent directory toward another path is that path's question.
  const crossed=decide([{...candidate('cases/new'),kind:'component' as const,requirements:['component']}],tracked,()=>[]);
  assert.deepEqual(crossed.missed,[]);assert.deepEqual(crossed.untracked.map(gap=>gap.state),['absent-component']);
});
