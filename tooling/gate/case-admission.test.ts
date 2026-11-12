import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fixture} from '../landing/run-fixture.ts';
import {moduleClosure} from './module-closure-fixture.ts';
import {gateEnvironment} from './canonical-environment.ts';
import {ownMemory} from './test-memory.ts';
import {newToolingSlice,stopToolingSlice,toolingSlice} from './tooling-slice.ts';
import {caseHistoryFile,readCaseHistory,writeCaseHistory,writeCostHistory,peakReservation} from './step-scheduling.ts';
import {caseMemoryKey} from './case-memory.ts';
import {tokenCommand} from './token-command.ts';
import {gateEnvironment} from './canonical-environment.ts';
const environment=gateEnvironment(process.env,{run:process.env.NTS_GATE_RUN_DIR,owned:{NTS_GATE_TOKEN_HELD:'1'}}).env;

const ROOT=fileURLToPath(new URL('../../',import.meta.url)),GiB=2**30,MiB=2**20;
type QueueEvent={event:string;request?:number;context?:string;memory?:{reserved_bytes:number;used_bytes:number}};
type Summary={verdict:string;memory:{growths:number};steps:{name:string;verdict:string;reason?:string;instrument?:{kind:string}}[]};

function runFixture(t:TestContext,{payload,known=[],live=true}:{payload:string;known?:string[];live?:boolean}){
  const f=fixture(t),gate=join(f.tree,'tooling/gate');
  for(const path of moduleClosure(['tooling/gate/tokens.mjs','tooling/census/worker-memory.ts','tooling/gate/token-command.ts','tooling/gate/case-spawn.ts'])){
    const destination=join(f.tree,path);mkdirSync(dirname(destination),{recursive:true});copyFileSync(join(ROOT,path),destination);
  }
  const memory=ownMemory(join(f.own,'memory'),{availableKiB:4*2**20,totalKiB:4*2**20,
    resident:live?{kind:'live'}:{kind:'fixed',defaultBytes:0},scopePeak:{kind:'live'}});
  const table=join(gate,'step-table.mjs');
  writeFileSync(table,readFileSync(table,'utf8').replace('export const STEPS = [','const ORIGINAL = [')+'\nexport const STEPS=ORIGINAL.map(row=>row.name==="integrity"?{name:"integrity",slots:2,min:1,elastic:true,bound:60}:row);\n');
  const all=join(gate,'all.sh'),source=readFileSync(all,'utf8');
  const listed=source.slice(source.indexOf("cat <<'NAMES'"),source.indexOf('NAMES\nexit 0')+5);
  writeFileSync(all,'#!/bin/sh\nif [ "$1" = --list ]; then\n'+listed+'\nexit 0\nfi\nexec node '+JSON.stringify(join(gate,'payload.mjs'))+'\n');
  writeFileSync(join(gate,'payload.mjs'),`
import assert from 'node:assert/strict';
import {readFileSync,watch} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {acquireToken,runWithToken} from './tokens.mjs';
import {compileActive,memoryRun,memoryCause} from '../census/worker-memory.ts';
import {activeCommand} from './active-command.ts';
import {PressureError,publishPressure} from './step-result.ts';
import {scopedSpawn} from './case-spawn.ts';
import {tokenCommand} from './token-command.ts';
const queue=join(process.env.NTS_GATE_CASE_COSTS_DIR,'queue.jsonl');
const events=()=>readFileSync(queue,'utf8').trim().split('\\n').filter(Boolean).map(line=>JSON.parse(line));
const requested=path=>events().some(row=>row.event==='token.request'&&row.context?.startsWith('json64:')&&JSON.parse(Buffer.from(row.context.slice(7),'base64url').toString()).project===path);
const waitForRequest=path=>new Promise(resolve=>{const watcher=watch(queue,()=>{if(requested(path)){watcher.close();resolve();}});if(requested(path)){watcher.close();resolve();}});
const compile=async(lease,bytes)=>runWithToken(lease,async()=>{
  const result=await compileActive({memoryCapKb:2*2**30/1024},process.execPath,['-e','const value=Buffer.alloc('+bytes+',1);process.stdout.write(String(value.at(-1)))'],{cwd:process.cwd(),env:environment,ownCpuSeconds:30});
  assert.equal(result.status,0,JSON.stringify(result));assert.equal(result.memoryKilled,false);assert.equal(result.stdout,'1');
});
${payload}
`);
  mkdirSync(memory.NTS_GATE_COSTS_DIR,{recursive:true});
  assert.equal(writeCostHistory(join(memory.NTS_GATE_COSTS_DIR,'steps.json'),{steps:[{name:'integrity',memory:{unit:'token',peak:MiB}}]}),undefined);
  const history=caseHistoryFile('integrity',memory,f.tree);
  assert.equal(writeCaseHistory(history,known.map(path=>({key:caseMemoryKey({step:'integrity',backend:'llvm',path}),peak:1.25*GiB}))),undefined);
  const inherited=toolingSlice(),slice=inherited??newToolingSlice(true),unit='nts-test-case-admission-'+randomUUID();
  if(!inherited)t.after(()=>stopToolingSlice(slice));
  const launcher=f.options(['integrity']).env;assert.ok(launcher);
  const env=gateEnvironment(launcher,{run:f.run,owned:{...memory,NTS_GATE_TARGET:f.target,NTS_GATE_STEPS:'integrity',NTS_GATE_SLOTS:'2',NTS_TOOLING_SLICE:slice,NTS_CENSUS_MEMORY_CAP_KB:String(2*GiB/1024)},oracleRoot:f.tree}).env;
  const result=spawnSync('systemd-run',['--user','--unit='+unit,'--slice='+slice,'--collect','--wait','--pipe','--quiet',
    '--working-directory='+f.tree,'-p','Nice=19','-p','LimitCORE=0','-p','CPUAffinity=0-3 6-31','-p','RuntimeMaxSec=120s',
    ...Object.entries(env).filter(([,value])=>value!==undefined).map(([name,value])=>'--setenv='+name+'='+value),process.execPath,join(gate,'run.mjs')],{encoding:'utf8',maxBuffer:16*MiB});
  spawnSync('systemctl',['--user','stop',unit],{stdio:'ignore'});
  const output=result.stdout+result.stderr;
  assert.ok(result.status!==null,output);
  const summary=JSON.parse(readFileSync(join(f.run,'summary.json'),'utf8')) as Summary;
  const queueEvents=readFileSync(join(f.run,'costs/queue.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line) as QueueEvent);
  return {status:result.status,summary,output,events:queueEvents,history:readCaseHistory(history)};
}

test('a case larger than the initial run reservation gets admitted growth; two large cases keep separate promises',t=>{
  const a='tests/fixture/a',b='tests/fixture/b';
  const f=runFixture(t,{known:[a,b],payload:`
const first=await acquireToken({project:'${a}',backend:'llvm'});assert.ok(first);
const second=acquireToken({project:'${b}',backend:'llvm'});
await waitForRequest('${b}');
try{await compile(first,128*2**20);}finally{first();}
const next=await second;assert.ok(next);try{await compile(next,128*2**20);}finally{next();}
`});
  assert.equal(f.status,0,f.output);assert.equal(f.summary.verdict,'green',f.output);assert.ok(f.summary.memory.growths>0);
  const requests=f.events.filter(row=>row.event==='token.request');assert.equal(requests.length,2);
  const release=f.events.findIndex(row=>row.event==='token.release'&&row.request===requests[0]!.request);
  const granted=f.events.findIndex(row=>row.event==='token.grant'&&row.request===requests[1]!.request);
  assert.ok(release>=0&&granted>release,'the second large case waits for the first promise to return');
  for(const row of f.events.filter(row=>row.event==='pool.change'&&row.memory))assert.ok(row.memory!.used_bytes<=row.memory!.reserved_bytes,JSON.stringify(row));
  for(const path of [a,b]){const peaks=f.history.get(caseMemoryKey({step:'integrity',backend:'llvm',path}));assert.ok(peaks&&peaks.length===2&&peaks[1]!>100*MiB);}
});

test('an unknown case keeps its hard cap despite a much smaller step forecast',t=>{
  // Fix the admission observation to isolate cap wiring. The live kernel
  // meter separately records this worker's actual peak for the next run.
  const path='tests/fixture/unknown';
  const f=runFixture(t,{live:false,payload:`const lease=await acquireToken({project:'${path}',backend:'llvm'});assert.ok(lease);try{await compile(lease,1.3*2**30|0);}finally{lease();}`});
  assert.equal(f.status,0,f.output);assert.equal(f.summary.verdict,'green',f.output);
  const peaks=f.history.get(caseMemoryKey({step:'integrity',backend:'llvm',path}));assert.ok(peaks&&peaks[0]!>1.3*GiB);
  const requested=f.events.find(row=>row.event==='token.request');assert.ok(requested);
  assert.ok(peakReservation(peaks)>128*MiB,'the following run learns this case, rather than averaging the step');
});

test('the old unsized shape fires the ancestor cap and names both limits',t=>{
  const f=runFixture(t,{live:false,payload:`
const release=await acquireToken({});assert.ok(release);
try{
  const memory=memoryRun(),worker=memory.worker('old',2*2**30);
  // Restore the pre-fix setup only in this control: the requested worker
  // budget was left above its enclosing forecast-derived slice budget.
  assert.equal(spawnSync('systemctl',['--user','set-property','--runtime',worker.slice,'MemoryMax='+2*2**30]).status,0);
  const scope=worker.scope(process.execPath,['-e','const bytes=Buffer.alloc(1.3*2**30|0,1);process.stdout.write(String(bytes.at(-1)))']);
  scope.argv=scope.argv.map(arg=>arg.startsWith('MemoryMax=')?'MemoryMax='+2*2**30:arg);
  const before=worker.counters(),aggregate=memory.aggregateOoms();
  const result=await activeCommand('systemd-run',scope.argv,{cwd:process.cwd(),env:scope.env,boundedEntry:{startupMs:30_000,ready:()=>worker.ready(scope)},ownCpuSeconds:30});
  try{memoryCause(before,worker.counters(),aggregate,memory.aggregateOoms());throw Error('old setup unexpectedly survived');}
  catch(error){assert.ok(error instanceof PressureError);assert.match(error.message,/ancestor-cap: cgroup .* cap [0-9]+ bytes.*case cap is 2147483648 bytes/);publishPressure(error);console.error(error.message);process.exitCode=124;}
  finally{memory.close();}
}finally{release();}
`});
  assert.notEqual(f.status,0);const step=f.summary.steps.find(row=>row.name==='integrity');assert.ok(step);
  assert.equal(step.verdict,'INSTRUMENT');assert.equal(step.instrument?.kind,'memory-pressure');assert.match(step.reason??'',/ancestor-cap: cgroup/);
  assert.match(step.reason??'',/case cap is 2147483648 bytes/);
});

test('the shared shell command entry refuses an absent identity or command before starting work',async()=>{
  await assert.rejects(tokenCommand([]),/requires --case/);
  await assert.rejects(tokenCommand(['--case']),/stable case path/);
  await assert.rejects(tokenCommand(['--case','tests/fixture/x','--']),/requires a command/);
});

test('shell and stream readers share the lease while preserving command status and output',t=>{
  const f=runFixture(t,{payload:`
const release=await acquireToken({project:'tests/fixture/stream',backend:'node'});assert.ok(release);
try{await runWithToken(release,()=>new Promise((resolve,reject)=>{
  const child=scopedSpawn(process.execPath,['-e','const a=Buffer.alloc(120*2**20,1);process.stdout.write("stream "+a.at(-1));process.exitCode=7'],{cwd:process.cwd(),env:environment,stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});child.once('error',reject);
  child.once('close',status=>{try{assert.equal(status,7,err);assert.equal(out,'stream 1');resolve();}catch(error){reject(error);}});
}));}finally{release();}
const result=await tokenCommand(['--case','tests/fixture/shell','--backend','node','--',process.execPath,'-e','const a=Buffer.alloc(120*2**20,1);process.stdout.write("shell "+a.at(-1));process.exitCode=9']);
assert.equal(result.status,9);assert.equal(result.signal,null);
`});
  assert.equal(f.status,0,f.output);assert.equal(f.summary.verdict,'green',f.output);assert.match(f.output,/shell 1/);
  for(const path of ['tests/fixture/stream','tests/fixture/shell']){
    const peaks=f.history.get(caseMemoryKey({step:'integrity',backend:'node',path}));assert.ok(peaks&&peaks[0]!>120*MiB);
  }
});
