import assert from 'node:assert/strict';
import {test} from 'node:test';
import {testArtifactTargets,RustInputPhases,publishInputTrace,readInputTraceIndex,type InputIndexObservation,type InputIndexProbe} from './rust-test-inputs.ts';
import {readCompressedRecords,type InputAttempt,type ByteFact} from './file-input-observer.ts';
import {rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {newTestScratch} from './test-scratch.ts';
import {gzipSync} from 'node:zlib';
import {constants} from 'node:buffer';
import {durableRecordStream} from './durable-record.ts';

const artifact={package_id:'pkg-id',executable:'/source/target/nts-dev/deps/arbitrary-hash',profile:{test:true},target:{name:'integration',kind:['test'],src_path:'/source/crate/tests/integration.rs'}};
const evidence=(artifacts:unknown[]= [artifact])=>({version:1,status:0,buildFinished:true,artifacts});

test('Cargo artifacts bind arbitrary binary paths to source targets without naming guesses',()=>{
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

test('descriptor-backed null paths are retained and non-filesystem dirfds never invent path anchors',async t=>{
  const root=newTestScratch('rust-input-descriptors');t.after(()=>rmSync(root,{recursive:true,force:true}));
  const nullPath=image(1,0,'/fixture');nullPath.syscall='statx';nullPath.operation='lookup';
  nullPath.paths=[{arg:1,dirfdArg:0,value:{hex:'',error:0,truncated:false,null:true}}];
  nullPath.dirfds=[{arg:0,fd:3,target:bytes('/source/crate/value')}];
  const socket=image(1,0,'/fixture');socket.syscall='openat';socket.operation='open';
  socket.paths=[{arg:1,dirfdArg:0,value:bytes('relative')}];socket.dirfds=[{arg:0,fd:4,target:bytes('socket:[123]')}];
  const raw=join(root,'raw.jsonl'),output=join(root,'decoded.index.jsonl.gz');
  writeFileSync(raw,gzipSync([{kind:'start',version:2,mechanism:'seccomp-user-notification',noNewPrivileges:true},{kind:'root-start',root:1},nullPath,socket,
    {kind:'root-exit',root:1,exit:0,signal:0},{kind:'complete',complete:true,root:1,entered:true,execErrno:0,exit:0,signal:0,attempts:2,errors:0,drainComplete:true,observerSignal:0}].map(row=>JSON.stringify(row)).join('\n')+'\n'));
  await publishInputTrace({raw,output,cwd:'/source/crate',root:'/source',target:{package:'fixture',name:'test',kind:['test'],source:'src/lib.rs'}});
  const decoded:{observations:InputIndexObservation[];descriptorProbes:InputIndexProbe[]}={observations:[],descriptorProbes:[]};
  await readInputTraceIndex(output,row=>{if(row.kind==='observation')decoded.observations.push(row);if(row.kind==='probe')decoded.descriptorProbes.push(row);});
  assert.deepEqual(decoded.observations.map(row=>[row.path,row.operation,row.outcome]),[['/source/crate/value','descriptor','unknown']]);
  assert.ok(decoded.descriptorProbes.some(row=>row.probeKind==='null-path'));
  assert.ok(decoded.descriptorProbes.some(row=>row.probeKind==='non-file-dirfd'&&row.raw===Buffer.from('socket:[123]').toString('hex')));
  const rows:unknown[]=[];await readCompressedRecords(output,row=>{rows.push(row);});
  const changed=(name:string,values:unknown[])=>{const path=join(root,name+'.gz');writeFileSync(path,gzipSync(values.map(row=>JSON.stringify(row)).join('\n')+'\n'));return path;};
  await assert.rejects(readInputTraceIndex(changed('future',[{...(rows[0] as object),version:4},...rows.slice(1)]),()=>{}),/unsupported input index version 4/);
  const footer=rows.at(-1) as {counts:{observations:number}};
  await assert.rejects(readInputTraceIndex(changed('counts',[...rows.slice(0,-1),{...footer,counts:{...footer.counts,observations:footer.counts.observations+1}}]),()=>{}),/count mismatch/);
  await assert.rejects(readInputTraceIndex(changed('missing',rows.slice(0,-1)),()=>{}),/incomplete input index/);
  await assert.rejects(readInputTraceIndex(changed('trailing',[...rows,rows[0]]),()=>{}),/after input index completion/);
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
    await put({kind:'index-start',version:3,mechanism:'seccomp-user-notification',outcomes:'unknown',target:{package:'fixture',name:'unit',kind:['test'],source:'src/lib.rs'}});
    for(let id=1;id<=repeats;id++)await put({...context,id,pid:id});
    await put({kind:'index-complete',terminal:{kind:'complete',complete:true,root:1,entered:true,execErrno:0,exit:0,signal:0,attempts:repeats,errors:0,drainComplete:true,observerSignal:0},
      counts:{images:repeats,observations:0,probes:0,terminalFacts:0,inherited:0}});
  },{gzip:true});
  let seen=0;const complete=await readInputTraceIndex(output,row=>{if(row.kind==='execution')seen++;});
  assert.ok(encodedBytes>constants.MAX_STRING_LENGTH);assert.equal(seen,repeats);assert.equal(complete.complete.counts.images,repeats);
});
