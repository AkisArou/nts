import assert from 'node:assert/strict';
import {test} from 'node:test';
import {censusPhaseSummary} from './census-phase-summary.ts';
import {CensusPhaseCosts,readCensusPhaseFrame,type PhaseSample} from '../census/phase-costs.ts';

test('supplied disjoint phases reconcile to scope CPU with an explicit remainder',()=>{
  const frame=readCensusPhaseFrame({version:1,project:'fixture',backend:'c',step:'typescript-c',compiler_observations:[],unmeasured:[],phases:[
    {phase:'materialization',wall_s:2,self_cpu_s:2,child_cpu_s:0},
    {phase:'host_compile_link',wall_s:8,self_cpu_s:1,child_cpu_s:9},
    {phase:'execution',wall_s:4,self_cpu_s:1,child_cpu_s:7},
    {phase:'comparison',wall_s:1,self_cpu_s:1,child_cpu_s:0},
  ]});
  const summary=censusPhaseSummary([frame],[{complete:true,phases:[
    {phase:'capture',wall_s:10,self_cpu_s:20,child_cpu_s:0},
    {phase:'lower',wall_s:4,self_cpu_s:7,child_cpu_s:0},
    {phase:'prepare',wall_s:2,self_cpu_s:3,child_cpu_s:0},
    {phase:'c.emit',wall_s:3,self_cpu_s:5,child_cpu_s:0},
  ]}],60);
  assert.equal(summary.status,'complete');assert.equal(summary.attributed_cpu_s,56);assert.equal(summary.unattributed_cpu_s,4);
  assert.equal(summary.rows.reduce((sum,row)=>sum+(row.cpu_s??0),0),60);
  assert.equal(summary.rows.find(row=>row.phase==='lowering')?.cases,1,'lower and prepare belong to one compiler attempt');
  assert.equal(summary.rows.at(-1)?.wall_s,null,'summed worker wall cannot be subtracted from concurrent step wall');
});

test('over-attribution stays signed and fails reconciliation instead of being clamped',()=>{
  const summary=censusPhaseSummary([],[{complete:true,phases:[{phase:'capture',wall_s:1,self_cpu_s:20,child_cpu_s:0}]}],10);
  assert.equal(summary.status,'inconsistent');assert.equal(summary.unattributed_cpu_s,-10);
});

test('missing CPU remains unknown and measured scope CPU never substitutes a legacy basis',()=>{
  const checks=[{complete:false,phases:[{phase:'capture',wall_s:2,self_cpu_s:null,child_cpu_s:null}]}];
  const summary=censusPhaseSummary([],checks,5);
  assert.equal(summary.status,'partial');assert.equal(summary.rows.find(row=>row.phase==='native_capture_check')?.cpu_s,null);
  assert.equal(censusPhaseSummary([],checks,undefined).status,'unmeasured');
  assert.throws(()=>readCensusPhaseFrame({version:1,phases:[{phase:'execution',wall_s:1,self_cpu_s:-1,child_cpu_s:0}]}),/invalid census/);
});

test('nested worker phases pause the enclosing phase at supplied CPU and clock readings',()=>{
  let time=0;
  const clock=():PhaseSample=>({wall:time,user:time,sys:0});
  const costs=new CensusPhaseCosts('fixture','c','typescript-c',clock);
  const comparison=costs.span('comparison');time=2;
  const host=costs.span('host_compile_link');time=5;host();
  time=7;comparison();
  const rows=costs.finish().phases;
  assert.equal(rows.find(row=>row.phase==='comparison')?.self_cpu_s,4);
  assert.equal(rows.find(row=>row.phase==='host_compile_link')?.self_cpu_s,3);
  assert.equal(rows.reduce((sum,row)=>sum+row.self_cpu_s,0),7);
});

test('a missing compiler record or worker frame stays visibly unmeasured',()=>{
  const costs=new CensusPhaseCosts('fixture','c','typescript-c',()=>({wall:0,user:0,sys:0}));
  const id=costs.compilerEnvironment().NTS_GATE_COMPILER_OBSERVATION!;
  const summary=censusPhaseSummary([costs.finish()],[],5,['fixture','other']);
  assert.equal(summary.status,'partial');assert.ok(summary.unmeasured.some(error=>error.endsWith('missing complete compiler phase record for '+id)));
  assert.match(summary.unmeasured.join('\n'),/missing census phase frame: other/);
});

test('equal nonzero CPU snapshots do not acquire a negative roundoff delta',()=>{
  const costs=new CensusPhaseCosts('fixture','c','typescript-c',()=>({wall:1,user:0.000123,sys:0.000045}));
  const close=costs.span('comparison');close();
  assert.deepEqual(costs.finish().unmeasured,[]);assert.equal(costs.frame.phases[0]?.self_cpu_s,0);
});

test('a control lease may contain several compiler observations without hiding a missing case frame',()=>{
  const costs=new CensusPhaseCosts('controls','c','typescript-c',()=>({wall:0,user:0,sys:0}));
  const a=costs.compilerEnvironment().NTS_GATE_COMPILER_OBSERVATION,b=costs.compilerEnvironment().NTS_GATE_COMPILER_OBSERVATION;
  const summary=censusPhaseSummary([costs.finish()],[a,b].map(observation=>({observation,complete:true,phases:[{phase:'capture',wall_s:1,self_cpu_s:1,child_cpu_s:0}]})),4,['controls','case']);
  assert.equal(summary.rows.find(row=>row.phase==='native_capture_check')?.cases,1);
  assert.match(summary.unmeasured.join('\n'),/missing census phase frame: case/);
});
