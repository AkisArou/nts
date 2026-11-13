import assert from 'node:assert/strict';
import {test} from 'node:test';
import {testArtifactTargets,RustInputPhases} from './rust-test-inputs.ts';
import type {InputAttempt,ByteFact} from './file-input-observer.ts';

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
  binary.observe(image(1,0,'/observer'));binary.observe(image(2,1,'/bin/rustc'));
  assert.ok(binary.images.every(row=>row.phase.phase==='test-runtime'&&row.phase.source===target.source));
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
