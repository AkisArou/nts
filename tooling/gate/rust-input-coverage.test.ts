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
import {coverageOfCaptures,coverageOfReports,decide,describeCoverage,trackedFrom,trackedPaths,committedIgnores,MEMBERSHIP_PROBE,type TestReach,type ReachChange} from './rust-input-coverage.ts';
import {spawnTest} from './test-wait.ts';
import {gitArguments} from './git-arguments/main.ts';

const snapshot=(files:string[]):InputSnapshot=>({files,ownedFiles:files,moduleFiles:[],hostFiles:[],placingFiles:files,stagingFiles:files,directories:[],optionalFiles:[],memberships:[],projectMatches:[],observations:[]});
const bytes=(text:string)=>({hex:Buffer.from(text).toString('hex'),error:0,truncated:false,null:false});

/** One test binary that opens each named file relative to the repository;
 * those in `byChild` are opened only by a process the test binary started. */
async function opened(t:Parameters<typeof testScratch>[0],name:string,declared:string[],reads:string[],byChild:readonly string[]=[]){
  const root=testScratch(t,name),trace=join(root,'.trace');mkdirSync(trace);
  for(const file of [...declared,...reads])writeFileSync(join(root,file),file);
  const observer:FileObserverReceipt={version:1,observedPath:process.execPath,artifactPath:process.execPath,abi:'linux-x86_64-v1',
    sourceSha256:'1'.repeat(64),sha256:createHash('sha256').update(readFileSync(process.execPath)).digest('hex')};
  const attempts=reads.map((file,i)=>({kind:'attempt',id:String(i+1),...(byChild.includes(file)?{tid:2,tgid:2,ppid:1,birth:'2',parentBirth:'1'}:{tid:1,tgid:1,ppid:0,birth:'1',parentBirth:'0'}),
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
/** A reach that answers each change on its own: a commit owes what any of its changes does. */
const each=(rules:(change:ReachChange)=>string[]):TestReach=>changes=>[...new Set(changes.flatMap(rules))];
const reachOf=(owing:string[]):TestReach=>each(change=>owing.includes(change.path)?['a declared reader']:[]);

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

test('a read made only by a process the test started is the test\'s: undeclared, it fails by name',async t=>{
  const tracked=trackedFrom(['fixture.ts','child.json'],none);
  const undeclared=await opened(t,'coverage-child-undeclared',['fixture.ts'],['fixture.ts','child.json'],['child.json']);
  const result=await coverageOfCaptures({root:undeclared.root,captures:[{file:'binary-0.raw.gz',capture:undeclared.capture}],
    reports:join(undeclared.trace,'reports'),targets:undeclared.targets,tracked,reach:reachOf(['fixture.ts'])});
  assert.deepEqual(result.missed.map(gap=>[gap.path,gap.phase,gap.source]),[['child.json','test-runtime','crate/tests/integration.rs']]);
  assert.match(describeCoverage(result).join('\n'),/child\.json \(file, content, test-runtime of crate\/tests\/integration\.rs/);
  // The control differs only in declaring the file the child reads.
  const declared=await opened(t,'coverage-child-declared',['fixture.ts','child.json'],['fixture.ts','child.json'],['child.json']);
  const control=await coverageOfCaptures({root:declared.root,captures:[{file:'binary-0.raw.gz',capture:declared.capture}],
    reports:join(declared.trace,'reports'),targets:declared.targets,tracked,reach:reachOf(['fixture.ts','child.json'])});
  assert.deepEqual(control.missed,[]);assert.deepEqual(control.untracked,[]);
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

test('a listed directory is reached only when adding and removing its entries owe the tests; a stat of one by a file beneath it',()=>{
  const tracked=trackedFrom(['cases/a/case.ts','cases/b/case.ts'],none);
  const candidate=(path:string,requirements:string[])=>({path,tracked:tracked.kind(path),kind:'endpoint' as const,source:'crate/src/lib.rs',phase:'test-runtime',requirements,reason:null});
  const owing=each(change=>change.path==='cases/a/case.ts'?['a declared file']:[]);
  const listed=decide([candidate('cases',['enumeration'])],tracked,owing);
  assert.deepEqual(listed.missed.map(gap=>gap.path),['cases'],'reading one member does not declare the listing');
  const membership=each(change=>change.added&&change.path==='cases/'+MEMBERSHIP_PROBE||change.deleted&&change.path.startsWith('cases/')?['a directory membership']:[]);
  assert.deepEqual(decide([candidate('cases',['enumeration'])],tracked,membership).missed,[]);
  // An addition alone is not the listing: removing an entry changes it too.
  const additions=each(change=>change.added&&change.path==='cases/'+MEMBERSHIP_PROBE?['a new member of the cases']:[]);
  const removal=decide([candidate('cases',['enumeration'])],tracked,additions);
  assert.deepEqual(removal.missed.map(gap=>[gap.path,gap.removal]),[['cases','cases/a']]);
  assert.match(describeCoverage({...removal,captures:[]}).join('\n'),/cases \(directory, enumeration, .*; removing cases\/a owes nothing\)/);
  // Removing an entry is one commit deleting everything under it: a rule that
  // the whole removal reaches answers it, though no single file's deletion does.
  const deep=trackedFrom(['cases/a/case.ts','cases/a/expect.txt'],none);
  const whole:TestReach=changes=>changes.some(change=>change.added)||changes.filter(change=>change.deleted).length===2?['the entry is gone']:[];
  assert.deepEqual(decide([{...candidate('cases',['enumeration']),tracked:deep.kind('cases')}],deep,whole).missed,[]);
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

test('a content read is decided by the least-owing edit of the bytes; any other read by an edit in place',()=>{
  const tracked=trackedFrom(['crate/src/lib.rs'],none);
  const candidate=(requirements:string[])=>({path:'crate/src/lib.rs',tracked:'file' as const,kind:'endpoint' as const,source:'crate/tests/integration.rs',phase:'test-runtime',requirements,reason:null});
  // The crate graph owes the tests for an edit, never for a comment alone.
  const graph=each(change=>change.least?[]:['a Rust compile input through Cargo']);
  const content=decide([candidate(['content'])],tracked,graph);
  assert.deepEqual(content.missed.map(gap=>gap.path),['crate/src/lib.rs'],'a content read the crate graph alone reaches is missed');
  for(const requirement of ['metadata:stat','readlink'])
    assert.deepEqual(decide([candidate([requirement])],tracked,graph).missed,[],requirement+' is decided by an edit in place');
  assert.equal(decide([candidate(['metadata:stat','content'])],tracked,graph).missed.length,1,'a content read beside a stat is still a content read');
  // The control differs only in a declared byte reader.
  const declared=each(change=>change.least&&change.sameMode?['declared bytes read by crate/tests/integration.rs']:['a Rust compile input through Cargo']);
  assert.deepEqual(decide([candidate(['content'])],tracked,declared).reached.map(gap=>gap.reachedBy),['declared bytes read by crate/tests/integration.rs']);
});

test('a listing of the repository root is decided like any listed directory',()=>{
  const tracked=trackedFrom(['top.md','dir/a.ts'],none);
  const root={path:'',tracked:tracked.kind(''),kind:'endpoint' as const,source:'crate/src/lib.rs',phase:'test-runtime',requirements:['enumeration'],reason:null};
  assert.equal(root.tracked,'directory');
  const asked:string[]=[];
  const result=decide([root],tracked,each(change=>{asked.push((change.added?'+':change.deleted?'-':'')+change.path);return change.path==='top.md'?[]:['a rule'];}));
  assert.deepEqual(asked,['+'+MEMBERSHIP_PROBE,'-top.md']);
  assert.deepEqual(result.missed.map(gap=>[gap.path,gap.removal]),[['','top.md']]);
  assert.match(describeCoverage({...result,captures:[]}).join('\n'),/\(the repository root\) \(directory, enumeration/);
});

test('a lookup of an absent path a commit could add owes the tests on that addition; an ignored one is reported',()=>{
  const candidate=(path:string)=>({path,tracked:null,kind:'endpoint' as const,source:'crate/src/lib.rs',phase:'test-runtime',requirements:['metadata:stat'],reason:null});
  const absent={present:()=>false,ignored:(paths:readonly string[])=>new Set(paths.filter(path=>path.startsWith('node_modules/')))};
  const tracked=trackedFrom(['cases/a.ts'],absent);
  const unowed=decide([candidate('cases/a.d.ts'),candidate('node_modules/x/package.json')],tracked,()=>[]);
  assert.deepEqual(unowed.missed.map(gap=>gap.path),['cases/a.d.ts']);
  assert.deepEqual(unowed.untracked.map(gap=>[gap.path,gap.state]),[['node_modules/x/package.json','absent-ignored']]);
  const owed=decide([candidate('cases/a.d.ts')],tracked,each(change=>change.added&&change.path==='cases/a.d.ts'?['a new member of the cases']:[]));
  assert.deepEqual(owed.missed,[]);assert.equal(owed.reached[0]?.reachedBy,'a new member of the cases');
  // Crossing an absent directory toward another path is that path's question.
  const crossed=decide([{...candidate('cases/new'),kind:'component' as const,requirements:['component']}],tracked,()=>[]);
  assert.deepEqual(crossed.missed,[]);assert.deepEqual(crossed.untracked.map(gap=>gap.state),['absent-component']);
});

test('the ignored namespace is the commit\'s own tracked .gitignore rules; a host exclude never widens it',t=>{
  const root=testScratch(t,'coverage-ignores');
  const init=spawnTest('git',gitArguments(['init','-q',root]),{encoding:'utf8'});assert.equal(init.status,0,init.stderr);
  writeFileSync(join(root,'.gitignore'),'build/*\n!build/keep\n');mkdirSync(join(root,'nested'));writeFileSync(join(root,'nested','.gitignore'),'*.out\n');
  const add=spawnTest('git',gitArguments(['add','.gitignore','nested/.gitignore']),{cwd:root,encoding:'utf8'});assert.equal(add.status,0,add.stderr);
  // The repository's own excludes are this host's, not the commit's.
  writeFileSync(join(root,'.git','info','exclude'),'/local/\n');
  const ignored=trackedPaths(root).ignored(['build/x','build/keep','nested/a.out','local/y','other/z']);
  assert.deepEqual([...ignored].sort(),['build/x','nested/a.out']);
  // An untracked .gitignore is no commit's rule either, and a negation decides against.
  const output=['scratch/.gitignore','1','*','scratch/a','.gitignore','2','!keep','keep','','','','free',''].join('\0');
  assert.deepEqual([...committedIgnores(output,new Set(['.gitignore']))],[]);
  assert.throws(()=>committedIgnores('.gitignore\x001\x00x',new Set()),/unterminated/);
});
