import assert from 'node:assert/strict';
import {test} from 'node:test';
import {testArtifactTargets,tracePhases} from './rust-test-inputs.ts';
import type {TraceResult} from './rust-input-trace.ts';

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

test('rustdoc setup, its compiler and entered test programs retain distinct phases',()=>{
  const command=(id:number,parent:number,path:string,args:string[]=[])=>({id,parent,pid:id,path,cwd:'/source/crate',args,order:id});
  const trace:TraceResult={observations:[],executions:[
    command(1,0,'/bin/cargo'),command(2,1,'/toolchain/rustdoc',['rustdoc','--test','src/lib.rs']),
    command(3,2,'/toolchain/rustc'),command(4,3,'/bin/ld'),command(5,2,'/private/doctest/rust_out'),
    command(6,5,'/bin/node'),
  ]};
  const phases=tracePhases(trace,'/source');
  assert.equal(phases.get(1)?.phase,'cargo-setup');
  for(const id of [2,3,4])assert.deepEqual(phases.get(id),{phase:'rustdoc-setup',source:'crate/src/lib.rs'});
  for(const id of [5,6])assert.deepEqual(phases.get(id),{phase:'doctest-runtime',source:'crate/src/lib.rs'});
  const binary=testArtifactTargets(evidence(),'/source').get(artifact.executable)!;
  assert.ok([...tracePhases(trace,'/source',binary).values()].every(row=>row.phase==='test-runtime'&&row.source===binary.source));
  assert.throws(()=>tracePhases({observations:[],executions:[command(1,0,'/bin/rustdoc',['rustdoc','--test'])]},'/source'),/no unique source entry/);
});
