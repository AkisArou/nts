import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {bindJobBasis,COST_HISTORY_VERSION,historyFile,jobReservation,readCostHistory,writeCostHistory} from './step-scheduling.ts';
import {jobSizing,readLedger} from './memory-ledger.ts';
import {STEP_CPU_MEASURE} from './step-time.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {spawnTest} from './test-wait.ts';

const GiB=2**30;
function fixture(t:TestContext){
 const root=testScratch(t,'job-basis'),env=ownMemory(root,{totalKiB:64*2**20,availableKiB:32*2**20}),file=historyFile(env);
 return {root,env,file};
}

test('a key binds its basis before its first measurement and mismatches change nothing',t=>{
 const f=fixture(t);
 assert.equal(jobSizing({key:'inner-build',units:4},f.env).basis,'live');
 assert.deepEqual(readCostHistory(f.file).jobs.get('inner-build'),{basis:'worker',observations:[]});
 const before=readFileSync(f.file,'utf8');
 assert.throws(()=>jobSizing({key:'inner-build'},f.env),/inner-build is bound to worker sizing; job sizing disagrees.*no --workers/);
 assert.equal(readFileSync(f.file,'utf8'),before);
 assert.deepEqual(readLedger(f.env.NTS_MEMORY_LEDGER),{waiting:[],admitted:[]});
 assert.equal(jobSizing({key:'inner-build',units:1},f.env).basis,'live','an explicit width of one still means worker sizing');
});

test('width is retained with the whole peak and matching calls normalize by that measured width',t=>{
 const f=fixture(t);bindJobBasis(f.file,'inner-build','worker');
 assert.equal(writeCostHistory(f.file,{jobs:[{key:'inner-build',basis:'worker',peak:8*GiB,width:4}]}),undefined);
 assert.deepEqual(readCostHistory(f.file).jobs.get('inner-build'),{basis:'worker',observations:[{peak:8*GiB,width:4}]});
 assert.equal(jobSizing({key:'inner-build',units:4},f.env).bytes,10*GiB);
 assert.equal(jobSizing({key:'inner-build',units:8},f.env).bytes,20*GiB);
 assert.equal(writeCostHistory(f.file,{jobs:[{key:'inner-build',basis:'worker',peak:12*GiB,width:6}]}),undefined);
 assert.equal(jobSizing({key:'inner-build',units:4},f.env).bytes,10*GiB);
 const before=readFileSync(f.file,'utf8');
 assert.match(writeCostHistory(f.file,{jobs:[{key:'inner-build',basis:'job',peak:GiB,width:1}]})??'',/bound to worker sizing/);
 assert.equal(readFileSync(f.file,'utf8'),before,'the locked writer cannot change the basis');
});

test('whole-job keys refuse a worker meaning and require width one in every observation',t=>{
 const f=fixture(t);assert.equal(jobSizing({key:'tooling-focused'},f.env).basis,'live');
 assert.equal(writeCostHistory(f.file,{jobs:[{key:'tooling-focused',basis:'job',peak:2*GiB,width:1}]}),undefined);
 assert.equal(jobSizing({key:'tooling-focused'},f.env).bytes,2.5*GiB);
 const before=readFileSync(f.file,'utf8');
 assert.throws(()=>jobSizing({key:'tooling-focused',units:1},f.env),/bound to job sizing; worker sizing disagrees/);
 assert.match(writeCostHistory(f.file,{jobs:[{key:'tooling-focused',basis:'job',peak:GiB,width:2}]})??'',/invalid memory observation/);
 assert.equal(readFileSync(f.file,'utf8'),before);
});

test('admit refuses a basis mismatch before reserving, recording or executing',t=>{
 const f=fixture(t),admit=new URL('./admit.ts',import.meta.url).pathname;
 for(const [key,basis,args] of [['worker-control','worker',[]],['job-control','job',['--workers','2']]] as const){
  bindJobBasis(f.file,key,basis);const before=readFileSync(f.file,'utf8');
  const result=spawnTest(process.execPath,[admit,'--key',key,...args,'--',process.execPath,'-e',"console.log('command entered')"],{env:fixtureEnvironment(t,f.env),encoding:'utf8'});
  assert.equal(result.status,125,result.stdout+result.stderr);assert.match(result.stderr,new RegExp('job key '+key+' is bound to '+basis+' sizing'));
  assert.doesNotMatch(result.stdout,/command entered/);assert.equal(readFileSync(f.file,'utf8'),before);
  assert.deepEqual(readLedger(f.env.NTS_MEMORY_LEDGER),{waiting:[],admitted:[]});
 }
});

test('v5 imports step rows once, names the rejected legacy jobs and isolates older writers',t=>{
 const f=fixture(t),legacy=join(f.env.NTS_GATE_COSTS_DIR,'steps.json');mkdirSync(f.env.NTS_GATE_COSTS_DIR,{recursive:true});
 const memory={unit:'step',peaks:[200*2**20]},steps={tests:{cpu:71,memory}};
 const original=JSON.stringify({version:4,cpu_measure:STEP_CPU_MEASURE,steps,jobs:{'inner-build':{unit:'worker',peaks:[1410588672]},'old-job':{unit:'worker',peaks:[GiB]}}})+'\n';
 writeFileSync(legacy,original);const reports:string[]=[];
 const view=bindJobBasis(f.file,'inner-build','worker',line=>reports.push(line));
 assert.deepEqual(view.steps.get('tests'),steps.tests);assert.equal(jobReservation(view,'inner-build','worker').basis,'live');
 assert.match(reports.join('\n'),/dropped 2 ambiguous job key/);assert.equal(readFileSync(legacy,'utf8'),original);
 assert.equal(JSON.parse(readFileSync(f.file,'utf8')).version,COST_HISTORY_VERSION);
 const retained=readFileSync(f.file,'utf8');writeFileSync(legacy,JSON.stringify({version:4,cpu_measure:STEP_CPU_MEASURE,steps:{},jobs:{}}));
 assert.deepEqual(readCostHistory(f.file).steps.get('tests'),steps.tests);
 assert.equal(readFileSync(f.file,'utf8'),retained);
});
