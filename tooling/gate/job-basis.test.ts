import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {bindJobBasis,caseHistoryFile,caseMemoryKey,COST_HISTORY_VERSION,historyFile,jobReservation,readCostHistory,writeCaseHistory,writeCostHistory} from './step-scheduling.ts';
import {jobSizing,readLedger} from './memory-ledger.ts';
import {STEP_CPU_MEASURE} from './step-time.ts';
import {ownMemory} from './test-memory.ts';
import {testScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {spawnTest} from './test-wait.ts';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {generatedJavaScript} from './generated-javascript.ts';

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

test('concurrent first callers bind exactly one meaning under the shared flock',async t=>{
 const f=fixture(t),script=generatedJavaScript(`
import {bindJobBasis} from ${JSON.stringify(new URL('./step-scheduling.ts',import.meta.url).href)};
process.stdin.once('data',()=>{
 try{bindJobBasis(process.argv[1],'concurrent-key',process.argv[2]);console.log('bound '+process.argv[2]);}
 catch(error){console.error(String(error));process.exitCode=2;}
});
`);
 const children=['job','worker'].map(basis=>{
  const child=spawn(process.execPath,['--input-type=module','-e',script,f.file,basis],{env:fixtureEnvironment(t),stdio:['pipe','pipe','pipe']});
  const closed=once(child,'close');let output='';
  child.stdout.on('data',bytes=>{output+=bytes;});child.stderr.on('data',bytes=>{output+=bytes;});
  return {child,closed,output:()=>output};
 });
 for(const run of children)run.child.stdin.end('enter');
 const exits=await Promise.all(children.map(run=>run.closed));assert.deepEqual(exits.map(row=>row[0]).sort(),[0,2]);
 const basis=readCostHistory(f.file).jobs.get('concurrent-key')!.basis;
 assert.match(children.map(run=>run.output()).join('\n'),new RegExp('bound '+basis));
 assert.match(children.map(run=>run.output()).join('\n'),/concurrent-key is bound to .* sizing; .* sizing disagrees/);
});

test('a case-sized key names its per-case route, and a case outside the tree or on another key is refused, before reserving or executing',t=>{
 const f=fixture(t),admit=new URL('./admit.ts',import.meta.url).pathname;
 const cases:[string[],RegExp][]=[
  [['--key','hir-compare'],/job key hir-compare is sized per case, so --case is required; wrap each project: admit\.ts --key hir-compare --case <project> -- <your per-project command>, or run node tooling\/conformance\/refusal-diff\.ts/],
  [['--key','hir-compare','--workers','2','--case','runtime/node/os'],/hir-compare is sized per case, so --workers does not apply/],
  [['--key','perf-count','--case','runtime/node/os'],/job key perf-count is not sized per case; --case applies to hir-compare/],
  [['--key','hir-compare','--case',f.root],/hir-compare case is outside its source tree/],
  [['--case','runtime/node/os','--bytes','1G'],/--workers, --case and --at-most size a --key/],
 ];
 for(const [args,refusal] of cases){
  const result=spawnTest(process.execPath,[admit,...args,'--',process.execPath,'-e',"console.log('command entered')"],{env:fixtureEnvironment(t,f.env),encoding:'utf8'});
  assert.equal(result.status,125,args.join(' ')+': '+result.stdout+result.stderr);assert.match(result.stderr,refusal);
  assert.doesNotMatch(result.stdout,/command entered/);
  assert.deepEqual(readLedger(f.env.NTS_MEMORY_LEDGER),{waiting:[],admitted:[]});
  assert.equal(readCostHistory(f.file).jobs.size,0,'a refused case binds nothing');
 }
 assert.throws(()=>bindJobBasis(f.file,'hir-compare','job'),/hir-compare is sized per case/);
 assert.match(writeCostHistory(f.file,{jobs:[{key:'hir-compare',basis:'job',peak:GiB,width:1}]})??'',/hir-compare is sized per case/,'no writer can add a whole-job sample to a case key');
});

test('a case key sizes by its own case peaks, capped by --at-most, and live without them',t=>{
 const f=fixture(t);mkdirSync(f.env.NTS_GATE_COSTS_DIR,{recursive:true});
 const file=caseHistoryFile('hir-compare',f.env),key=caseMemoryKey({step:'hir-compare',backend:'',path:'runtime/node/zlib'});
 assert.equal(writeCaseHistory(file,[{key,peak:GiB}]),undefined);
 const sized=jobSizing({key:'hir-compare',case:'runtime/node/zlib'},f.env);
 assert.deepEqual([sized.bytes,sized.basis,sized.sampleBasis,sized.case],[1.25*GiB,'measured','case',{path:'runtime/node/zlib',history:file,key}]);
 assert.equal(jobSizing({key:'hir-compare',case:'runtime/node/zlib',atMostBytes:GiB},f.env).bytes,GiB);
 assert.equal(jobSizing({key:'hir-compare',case:'runtime/node/fs'},f.env).basis,'live');
});
