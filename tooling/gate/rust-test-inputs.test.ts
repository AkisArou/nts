import assert from 'node:assert/strict';
import {test} from 'node:test';
import {testArtifactTargets,testBuildStatus,RustInputPhases,publishInputTrace,readInputTraceIndex,classifyInputOpen,type InputIndexObservation,type InputIndexProbe} from './rust-test-inputs.ts';
import {readCompressedRecords,type InputAttempt,type ByteFact,type FileObserverReceipt} from './file-input-observer.ts';
import {rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {newTestScratch} from './test-scratch.ts';
import {gzipSync} from 'node:zlib';
import {constants} from 'node:buffer';
import {durableRecordStream} from './durable-record.ts';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const artifact={package_id:'pkg-id',executable:'/source/target/nts-dev/deps/arbitrary-hash',profile:{test:true},target:{name:'integration',kind:['test'],src_path:'/source/crate/tests/integration.rs'}};
const evidence=(artifacts:unknown[]= [artifact])=>({version:1,status:0,buildFinished:true,artifacts});

test('Cargo artifacts bind arbitrary binary paths to source targets without naming guesses',()=>{
  assert.equal(testBuildStatus({...evidence(),status:101}),101);
  for(const value of [{...evidence(),version:2},{...evidence(),status:-1},{...evidence(),status:256},{...evidence(),status:null}])
    assert.throws(()=>testBuildStatus(value),/invalid Cargo completion/);
  const targets=testArtifactTargets(evidence(),'/source');
  assert.deepEqual(targets.get(artifact.executable),{package:'pkg-id',name:'integration',kind:['test'],source:'crate/tests/integration.rs'});
  assert.throws(()=>testArtifactTargets({...evidence(),status:7},'/source'),/incomplete Cargo/);
  assert.throws(()=>testArtifactTargets({...evidence(),buildFinished:false},'/source'),/incomplete Cargo/);
  assert.throws(()=>testArtifactTargets(evidence([{...artifact,target:{...artifact.target,src_path:'/other/source.rs'}}]),'/source'),/invalid test target/);
  assert.throws(()=>testArtifactTargets(evidence([artifact,{...artifact,target:{...artifact.target,name:'another'}}]),'/source'),/conflicting target/);
  assert.throws(()=>testArtifactTargets(evidence([{...artifact,profile:{test:false}}]),'/source'),/no test executable/);
});

const bytes=(text:string):ByteFact=>({hex:Buffer.from(text).toString('hex'),error:0,truncated:false,null:false});
const image=(pid:number,parent:number,path:string,args:string[]=[],birth=String(pid)):InputAttempt=>({kind:'attempt',id:String(pid),tid:pid,tgid:pid,ppid:parent,birth,parentBirth:String(parent),
  syscall:'exit_group',operation:'lifetime',outcome:'unknown',canceled:false,factsComplete:true,args:['0','0','0','0','0','0'],cwd:bytes('/source/crate'),image:bytes(path),
  argvRead:path==='/toolchain/rustdoc',argv:bytes(args.join('\0')+'\0'),paths:[],dirfds:[]});

test('open request classes retain their ABI and never confuse temporary creation with a directory read',()=>{
  const basis:FileObserverReceipt={version:1,observedPath:'/observer',artifactPath:'/retained/observer',sha256:'0'.repeat(64),sourceSha256:'1'.repeat(64),abi:'linux-x86_64-v1'};
  const request=(flags:string,syscall='openat')=>({operation:'open',syscall,args:['0',syscall==='open'?flags:'0',syscall==='openat'?flags:'10000','0','0','0']});
  for(const [flags,kind]of [
    ['0','content-read'],['1','write'],['2','write'],['40','write'],['200','write'],['241','write'],
    ['10000','directory'],['90000','directory'],['220000','path'],['2b0000','path'],
    ['410002','write'],['410000','write'],['20','unknown'],['80000000','unknown'],['3','unknown'],['220200','unknown'],
  ] as const){
    for(const syscall of ['open','openat']){
      const result=classifyInputOpen(request(flags,syscall),basis);
      assert.equal(result.kind,kind,syscall+' flags '+flags);assert.equal(result.flags,flags);assert.equal(result.abi,basis.abi);
    }
  }
  assert.equal(classifyInputOpen(request('10000'),null).kind,'unknown','unproved capture ABI grants no metadata interpretation');
  assert.equal(classifyInputOpen(request('10000'),{...basis,abi:'linux-aarch64-v1'}).kind,'unknown');
  assert.equal(classifyInputOpen(request('10000','openat2'),basis).flags,null,'a pointer to open_how is not scalar flags');
  assert.equal(classifyInputOpen({...request('10000'),operation:'lookup',syscall:'statx'},basis).kind,'unknown','stat flags have their own operation contract');
});

test('actual task images and identity-bound commands separate rustdoc setup from test runtime',()=>{
  const phases=new RustInputPhases('/source',undefined,[{version:1,pid:5,birth:'5',cwd:'/source/crate',argv:['/private/temporary']}]);
  phases.start(1);
  assert.equal(phases.observe(image(1,0,'/observer')).phase.phase,'cargo-setup');
  phases.observe(image(1,0,'/bin/cargo'));
  const rustdoc=['rustdoc','--test','src/lib.rs'];
  assert.deepEqual(phases.observe(image(2,1,'/toolchain/rustdoc',rustdoc)).phase,{phase:'rustdoc-setup',source:'crate/src/lib.rs'});
  phases.observe(image(3,2,'/toolchain/rustdoc',rustdoc));
  assert.equal(phases.observe(image(3,2,'/toolchain/rustc')).phase.phase,'rustdoc-setup');
  assert.equal(phases.observe(image(4,3,'/bin/ld')).phase.phase,'rustdoc-setup');
  phases.observe(image(5,2,'/toolchain/rustdoc',rustdoc));
  assert.equal(phases.observe(image(5,2,'/bin/sh')).phase.phase,'rustdoc-setup','a recorder wrapper is not the test program');
  assert.deepEqual(phases.observe(image(5,2,'/private/temporary')).phase,{phase:'doctest-runtime',source:'crate/src/lib.rs'});
  assert.equal(phases.observe(image(6,5,'/bin/node')).phase.phase,'doctest-runtime');
  phases.finish();
  const target=testArtifactTargets(evidence(),'/source').get(artifact.executable)!;
  const binary=new RustInputPhases('/source',target);binary.start(1);
  const entered=[binary.observe(image(1,0,'/observer')),binary.observe(image(2,1,'/bin/rustc'))];
  assert.ok(entered.every(row=>row.phase.phase==='test-runtime'&&row.phase.source===target.source));
});

test('exec intentions, reused paths and reused PIDs cannot invent a doctest entry',()=>{
  const call={version:1 as const,pid:5,birth:'5',cwd:'/source/crate',argv:['/private/program']};
  for(const [pid,birth] of [[6,'6'],[5,'later']] as const){
    const phases=new RustInputPhases('/source',undefined,[call]);phases.start(1);
    phases.observe(image(1,0,'/observer'));
    phases.observe(image(2,1,'/toolchain/rustdoc',['rustdoc','--test','src/lib.rs']));
    assert.equal(phases.observe(image(pid,2,'/private/program',[],birth)).phase.phase,'rustdoc-setup');
    assert.throws(()=>phases.finish(),/no matching entered image/);
  }
  const phases=new RustInputPhases('/source');phases.start(1);phases.observe(image(1,0,'/observer'));
  assert.throws(()=>phases.observe(image(5,9,'/unknown')),/unattributed task/);
  assert.throws(()=>phases.observe(image(2,1,'/toolchain/rustdoc',['rustdoc','--test'])),/no unique source entry/);
  const requested=image(2,1,'/bin/cargo');requested.syscall='execve';requested.operation='execute';requested.paths=[{arg:0,dirfdArg:-1,value:bytes('/toolchain/rustdoc')}];
  assert.equal(phases.observe(requested).phase.phase,'cargo-setup','an exec argument is not a successful image transition');
});

test('same-image rustdoc facts with different actual source arguments update the attributed context',()=>{
  const phases=new RustInputPhases('/source');phases.start(1);phases.observe(image(1,0,'/observer'));
  const first=phases.observe(image(2,1,'/toolchain/rustdoc',['rustdoc','--test','src/first.rs']));
  const next=phases.observe(image(2,1,'/toolchain/rustdoc',['rustdoc','--test','src/second.rs']));
  assert.notEqual(next.id,first.id);assert.equal(next.reason,'actual-argv');
  assert.deepEqual(first.phase,{phase:'rustdoc-setup',source:'crate/src/first.rs'});
  assert.deepEqual(next.phase,{phase:'rustdoc-setup',source:'crate/src/second.rs'});
  assert.equal(phases.observe(image(2,1,'/toolchain/rustdoc',['rustdoc','--test','src/second.rs'])).id,next.id);
});

test('same-image cwd changes preserve the bound invocation source while updating the attempt anchor',()=>{
  const phases=new RustInputPhases('/source');phases.start(1);phases.observe(image(1,0,'/observer'));
  const first=phases.observe(image(2,1,'/toolchain/rustdoc',['rustdoc','--test','src/lib.rs']));
  const changed={...image(2,1,'/toolchain/rustdoc',['rustdoc','--test','src/lib.rs']),cwd:bytes('/source/moved')};
  const next=phases.observe(changed);
  assert.notEqual(next.id,first.id);assert.equal(next.reason,'actual-cwd');
  assert.equal(next.cwd,'/source/moved');assert.deepEqual(next.phase,first.phase);
  const changedArgv={...changed,argv:bytes(['rustdoc','--test','src/second.rs'].join('\0')+'\0')};
  const rebound=phases.observe(changedArgv);
  assert.equal(rebound.reason,'actual-argv');assert.equal(rebound.phase.source,'moved/src/second.rs');
});

test('an entered doctest can change cwd without entering its recorded command again',()=>{
  const phases=new RustInputPhases('/source',undefined,[{version:1,pid:5,birth:'5',cwd:'/source/crate',argv:['/private/program']}]);
  phases.start(1);phases.observe(image(1,0,'/observer'));
  phases.observe(image(2,1,'/toolchain/rustdoc',['rustdoc','--test','src/lib.rs']));
  const first=phases.observe(image(5,2,'/private/program'));
  const changed={...image(5,2,'/private/program'),cwd:bytes('/source/moved')};
  const next=phases.observe(changed);
  assert.equal(next.reason,'actual-cwd');assert.equal(next.cwd,'/source/moved');
  assert.deepEqual(next.phase,{phase:'doctest-runtime',source:'crate/src/lib.rs'});
  assert.equal(phases.observe(changed).id,next.id);assert.notEqual(next.id,first.id);
  phases.finish();
});

test('attempt groups retain kernel path order, two-path positions and actual changing anchors',async t=>{
  const root=newTestScratch('rust-input-anchors');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const rename=image(1,0,'/fixture');rename.id='41';rename.operation='rename';rename.syscall='renameat2';
  rename.args=['3','0','4','0','0','0'];
  rename.paths=[{arg:1,dirfdArg:0,value:bytes('link/../value')},{arg:3,dirfdArg:2,value:bytes('../destination')}];
  rename.dirfds=[{arg:0,fd:3,target:bytes('/source/first')},{arg:2,fd:4,target:bytes('/source/second')}];
  const after={...image(1,0,'/fixture'),id:'42',cwd:bytes('/source/moved'),syscall:'openat',operation:'open',
    args:['ffffffffffffff9c','0','0','0','0','0'],paths:[{arg:1,dirfdArg:0,value:bytes('other/../input')}],
    dirfds:[{arg:0,fd:-100,target:bytes('/source/moved')}]};
  const raw=join(root,'raw.gz'),output=join(root,'index.gz');
  writeFileSync(raw,gzipSync([{kind:'start',version:2,mechanism:'seccomp-user-notification',noNewPrivileges:true},{kind:'root-start',root:1},rename,after,
    {kind:'root-exit',root:1,exit:0,signal:0},{kind:'complete',complete:true,root:1,entered:true,execErrno:0,exit:0,signal:0,attempts:2,errors:0,drainComplete:true,observerSignal:0}].map(row=>JSON.stringify(row)).join('\n')+'\n'));
  await publishInputTrace({raw,output,cwd:'/source/ignored',root:'/source',target:{package:'fixture',name:'test',kind:['test'],source:'src/lib.rs'}});
  const rows:InputIndexObservation[]=[];
  const result=await readInputTraceIndex(output,row=>{if(row.kind==='observation')rows.push(row);});
  assert.equal(result.header.version,4);assert.equal(result.header.observer,null,'absence of capture ABI evidence remains explicit');
  assert.deepEqual(rows.map(row=>row.attempt.id),['41','42']);
  assert.deepEqual(rows[0]!.subjects,[
    {kind:'path',arg:1,dirfdArg:0,name:'link/../value',raw:bytes('link/../value').hex,anchor:{kind:'dirfd',fd:3,path:'/source/first',raw:bytes('/source/first').hex}},
    {kind:'path',arg:3,dirfdArg:2,name:'../destination',raw:bytes('../destination').hex,anchor:{kind:'dirfd',fd:4,path:'/source/second',raw:bytes('/source/second').hex}},
  ]);
  assert.deepEqual(rows[1]!.subjects,[{kind:'path',arg:1,dirfdArg:0,name:'other/../input',raw:bytes('other/../input').hex,anchor:{kind:'cwd',path:'/source/moved'}}]);
  assert.deepEqual(rows[1]!.args,after.args);assert.equal(rows[1]!.cwd,'/source/moved');
  assert.equal(result.complete.raw.sha256,createHash('sha256').update(readFileSync(raw)).digest('hex'));
  assert.equal(result.complete.raw.bytes,readFileSync(raw).length);
});

test('descriptor-backed null paths are retained and non-filesystem dirfds never invent path anchors',async t=>{
  const root=newTestScratch('rust-input-descriptors');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const nullPath=image(1,0,'/fixture');nullPath.syscall='statx';nullPath.operation='lookup';
  nullPath.args=['3','0','1000','0','0','0'];
  nullPath.paths=[{arg:1,dirfdArg:0,value:{hex:'',error:0,truncated:false,null:true}}];
  nullPath.dirfds=[{arg:0,fd:3,target:bytes('/source/crate/value')}];
  const socket=image(1,0,'/fixture');socket.syscall='openat';socket.operation='open';
  socket.paths=[{arg:1,dirfdArg:0,value:bytes('relative')}];socket.dirfds=[{arg:0,fd:4,target:bytes('socket:[123]')}];
  const raw=join(root,'raw.jsonl'),output=join(root,'decoded.index.jsonl.gz');
  writeFileSync(raw,gzipSync([{kind:'start',version:2,mechanism:'seccomp-user-notification',noNewPrivileges:true},{kind:'root-start',root:1},nullPath,socket,
    {kind:'root-exit',root:1,exit:0,signal:0},{kind:'complete',complete:true,root:1,entered:true,execErrno:0,exit:0,signal:0,attempts:2,errors:0,drainComplete:true,observerSignal:0}].map(row=>JSON.stringify(row)).join('\n')+'\n'));
  await publishInputTrace({raw,output,cwd:'/source/crate',root:'/source',target:{package:'fixture',name:'test',kind:['test'],source:'src/lib.rs'}});
  const decoded:{observations:InputIndexObservation[];descriptorProbes:InputIndexProbe[]}={observations:[],descriptorProbes:[]};
  await readInputTraceIndex(output,row=>{if(row.kind==='observation')decoded.observations.push(row);if(row.kind==='observation')decoded.descriptorProbes.push(...row.probes);});
  assert.deepEqual(decoded.observations.flatMap(row=>row.subjects.map(subject=>[subject.kind==='descriptor'?subject.target:subject.name,row.operation,row.outcome])),[['/source/crate/value','lookup','unknown']]);
  assert.ok(decoded.descriptorProbes.some(row=>row.probeKind==='null-path'));
  assert.ok(decoded.descriptorProbes.some(row=>row.probeKind==='non-file-dirfd'&&row.raw===Buffer.from('socket:[123]').toString('hex')));
  const rows:unknown[]=[];await readCompressedRecords(output,row=>{rows.push(row);});
  const changed=(name:string,values:unknown[])=>{const path=join(root,name+'.gz');writeFileSync(path,gzipSync(values.map(row=>JSON.stringify(row)).join('\n')+'\n'));return path;};
  await assert.rejects(readInputTraceIndex(changed('future',[{...(rows[0] as object),version:5},...rows.slice(1)]),()=>{}),/unsupported input index version 5/);
  await assert.rejects(readInputTraceIndex(changed('legacy',[{...(rows[0] as object),version:3},...rows.slice(1)]),()=>{}),/rederive legacy normalized indices/);
  const footer=rows.at(-1) as {counts:{observations:number}};
  await assert.rejects(readInputTraceIndex(changed('counts',[...rows.slice(0,-1),{...footer,counts:{...footer.counts,observations:footer.counts.observations+1}}]),()=>{}),/count mismatch/);
  await assert.rejects(readInputTraceIndex(changed('missing',rows.slice(0,-1)),()=>{}),/incomplete input index/);
  await assert.rejects(readInputTraceIndex(changed('trailing',[...rows,rows[0]]),()=>{}),/after input index completion/);
  await assert.rejects(readInputTraceIndex(changed('raw-binding',[...rows.slice(0,-1),{...footer,raw:undefined}]),()=>{}),/malformed input index record/);
  const descriptorRow=rows.find(row=>(row as {kind:string}).kind==='observation') as InputIndexObservation;
  const wrongFd={...descriptorRow,subjects:descriptorRow.subjects.map(subject=>subject.kind==='descriptor'?{...subject,fd:4}:subject)};
  await assert.rejects(readInputTraceIndex(changed('wrong-fd',rows.map(row=>row===descriptorRow?wrongFd:row)),()=>{}),/malformed descriptor subject/);
});

test('only canceled input-free lifetime facts can remain unattributed',async t=>{
  const root=newTestScratch('rust-input-canceled');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const canceled=image(1,0,'/vanished');canceled.canceled=true;canceled.factsComplete=false;canceled.tgid=0;canceled.birth='0';
  canceled.cwd={hex:'',error:2,truncated:false,null:false};canceled.image={...canceled.cwd};
  const produce=(name:string,row:InputAttempt)=>{
    const raw=join(root,name+'.raw.gz');
    writeFileSync(raw,gzipSync([{kind:'start',version:2,mechanism:'seccomp-user-notification',noNewPrivileges:true},{kind:'root-start',root:1},row,
      {kind:'root-exit',root:1,exit:0,signal:0},{kind:'complete',complete:true,root:1,entered:true,execErrno:0,exit:0,signal:0,attempts:1,errors:0,drainComplete:true,observerSignal:0}].map(value=>JSON.stringify(value)).join('\n')+'\n'));
    return {raw,output:join(root,name+'.index.gz'),cwd:'/source',root:'/source',target:{package:'fixture',name:'unit',kind:['test'],source:'src/lib.rs'}};
  };
  const valid=produce('canceled',canceled);await publishInputTrace(valid);
  const indexed:unknown[]=[];const complete=await readInputTraceIndex(valid.output,row=>{indexed.push(row);});
  assert.equal(complete.complete.counts.terminalFacts,1);assert.equal(complete.complete.counts.images,0);assert.equal(complete.complete.counts.observations,0);
  await assert.rejects(publishInputTrace(produce('live',{...canceled,canceled:false})),/unreadable or truncated/);
  await assert.rejects(publishInputTrace(produce('file',{...canceled,syscall:'openat',operation:'open',paths:[{arg:1,dirfdArg:0,value:bytes('file')}]})),/unreadable or truncated/);
});


test('input index publication and its typed reader exceed one string with bounded records',async t=>{
  const root=newTestScratch('rust-input-index-scale');t.after(()=>rmSync(root,{recursive:true,force:true}));
  assert.throws(()=>'x'.repeat(constants.MAX_STRING_LENGTH+1),RangeError);
  const output=join(root,'scale.index.gz'),argvRaw='61'.repeat(60*1024);
  const context={kind:'execution',id:1,parent:0,pid:1,birth:'1',path:'/fixture',cwd:'/source',phase:{phase:'test-runtime',source:'src/lib.rs'},reason:'first-observation',argvRaw};
  const repeats=Math.ceil(constants.MAX_STRING_LENGTH/Buffer.byteLength(JSON.stringify(context)))+1;
  let encodedBytes=0;
  await durableRecordStream(output,async append=>{
    const put=async(row:unknown)=>{const line=JSON.stringify(row)+'\n';encodedBytes+=Buffer.byteLength(line);await append(line);};
    await put({kind:'index-start',version:4,mechanism:'seccomp-user-notification',outcomes:'unknown',observer:null,target:{package:'fixture',name:'unit',kind:['test'],source:'src/lib.rs'}});
    for(let id=1;id<=repeats;id++){await put({...context,id,pid:id});await put({kind:'observation',image:id,attempt:{id:String(id),tid:id,tgid:id,ppid:0,birth:String(id),parentBirth:'0'},cwd:'/source',args:['0','0','0','0','0','0'],operation:'lifetime',syscall:'exit',outcome:'unknown',canceled:false,phase:'test-runtime',source:'src/lib.rs',subjects:[],probes:[]});}
    await put({kind:'index-complete',terminal:{kind:'complete',complete:true,root:1,entered:true,execErrno:0,exit:0,signal:0,attempts:repeats,errors:0,drainComplete:true,observerSignal:0},
      raw:{path:'/private/raw.gz',sha256:'0'.repeat(64),bytes:1},counts:{images:repeats,attempts:repeats,observations:0,probes:0,terminalFacts:0,inherited:0}});
  },{gzip:true});
  let seen=0;const complete=await readInputTraceIndex(output,row=>{if(row.kind==='execution')seen++;});
  assert.ok(encodedBytes>constants.MAX_STRING_LENGTH);assert.equal(seen,repeats);assert.equal(complete.complete.counts.images,repeats);
});
