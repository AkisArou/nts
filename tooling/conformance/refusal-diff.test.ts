// refusal-diff.ts holds memory one project at a time: each project is its own
// `admit.ts --key hir-compare --case <project>` admission, sized by that
// project's own peaks, and its report is the one an unleased comparison of
// the same listings prints. Real CLI runs in owned units, with fake compilers
// that print fixed listings and say which reservation they ran in.
import {fixedMembersUnitCommand} from '../gate/test-cgroup-members.ts';
import {fixtureEnvironment,assignTestValues} from '../gate/test-environment.ts';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test,type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {gateEnvironment} from '../gate/canonical-environment.ts';
import {readLedger} from '../gate/memory-ledger.ts';
import {caseHistoryFile,caseMemoryKey,historyFile,peakReservation,readCaseHistory,readCostHistory,writeCaseHistory} from '../gate/step-scheduling.ts';
import {STEP_CPU_MEASURE} from '../gate/step-time.ts';
import {removable} from '../gate/run-temporary.ts';
import {ownMemory} from '../gate/test-memory.ts';
import {newTestScratch} from '../gate/test-scratch.ts';
import {toolingSliceArgs,stopToolingSlice} from '../gate/tooling-slice.ts';
import {GateScopes} from '../gate/scopes/step-scope.ts';
import {CASE_KEY,caseArms,compare,report} from './refusal-diff.ts';

const ROOT=fileURLToPath(new URL('../..',import.meta.url));
const DIFF=fileURLToPath(new URL('./refusal-diff.ts',import.meta.url));
const ADMIT=fileURLToPath(new URL('../gate/admit.ts',import.meta.url));
const MiB=2**20;
// Paths in this tree: a case lies inside the tree it is measured in. The fake
// compilers never read them.
const MEASURED='runtime/node/os',UNMEASURED='runtime/node/path';
const caseKey=(path:string)=>caseMemoryKey({step:CASE_KEY,backend:'',path});

// A case command that ends once its watcher has published a sample of it: a
// case that ends before its first sample leaves no peak to record.
const HELD_UNTIL_SAMPLED=`const fs=require('node:fs'),path=require('node:path'),dir=path.join(process.env.NTS_MEMORY_LEDGER,'admitted'),file=path.join(dir,process.env.NTS_MEMORY_RESERVATION+'.json');
const sampled=()=>{try{return (JSON.parse(fs.readFileSync(file,'utf8')).sampledPeak??0)>0;}catch{return false;}};
const done=()=>{if(!sampled())return false;watch.close();process.stdout.write('ran');return true;};
const watch=fs.watch(dir,done);done();`;

type Seen={arm:string;cmd:string;project:string;id:string|null;bytes:number|null;live:boolean};

function fixture(t:TestContext){
  const root=newTestScratch('refusal-diff'),units:string[]=[];
  const memory=ownMemory(join(root,'memory'),{availableKiB:8*2**20,totalKiB:32*2**20,resident:{kind:'live'}});
  const env=gateEnvironment(fixtureEnvironment(t,{NTS_MEMORY_RESERVATION:undefined}),{run:join(root,'canonical'),standalone:true,owned:memory}).env;
  const scopes=new GateScopes(env,{rank:'agent'});assignTestValues(env,{NTS_TOOLING_SLICE:scopes.slice});
  t.after(()=>{
    for(const unit of units)spawnSync('systemctl',['--user','stop',unit],{env:fixtureEnvironment(t),stdio:'ignore'});
    stopToolingSlice(scopes.slice);
    removable(root);rmSync(root,{recursive:true,force:true});
  });
  mkdirSync(memory.NTS_GATE_COSTS_DIR,{recursive:true});
  // Two compilers: `before` compiles `lost` and `kept`; `after` refuses `lost`
  // and newly compiles `gained`. Each records the reservation it ran in.
  const seen=join(root,'seen.jsonl'),bins=join(root,'bin');mkdirSync(bins);
  for(const arm of ['before','after'])writeFileSync(join(bins,arm),`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const [cmd,...rest]=process.argv.slice(2),project=rest.at(-1),arm=path.basename(process.argv[1]),id=process.env.NTS_MEMORY_RESERVATION??null;
const entry=id&&JSON.parse(fs.readFileSync(path.join(process.env.NTS_MEMORY_LEDGER,'admitted',id+'.json'),'utf8'));
fs.appendFileSync(${JSON.stringify(seen)},JSON.stringify({arm,cmd,project,id,bytes:entry?entry.bytes:null,live:entry?entry.liveUse===true:false})+'\\n');
const before=arm==='before';
const print=()=>{
  if(cmd==='hir')process.stdout.write(before?'2 function(s)\\nfunc kept(x: f64) -> f64 {\\nfunc lost(x: f64) -> f64 {\\n':'2 function(s)\\nfunc kept(x: f64) -> f64 {\\nfunc gained(x: f64) -> f64 {\\n');
  else process.stdout.write(before?'gained\\tnot yet\\n':'lost\\ta new reason\\n');
};
// A live case's first peak is recorded only once its watcher has sampled it.
if(!entry||!entry.liveUse)print();
else{
  const dir=path.join(process.env.NTS_MEMORY_LEDGER,'admitted'),file=path.join(dir,id+'.json');
  const sampled=()=>{try{return (JSON.parse(fs.readFileSync(file,'utf8')).sampledPeak??0)>0;}catch{return false;}};
  const done=()=>{if(!sampled())return;watch.close();print();};
  const watch=fs.watch(dir,done);done();
}
`,{mode:0o755});
  const start=(command:string[])=>{
    const unit=`nts-test-refusal-diff-${randomUUID()}`;units.push(unit);
    const setenv=Object.entries(env).filter((pair):pair is [string,string]=>pair[1]!==undefined).map(([key,value])=>`--setenv=${key}=${value}`);
    const child=spawn('systemd-run',['--user',...toolingSliceArgs(env,'agent'),`--unit=${unit}`,'--collect','--quiet','--wait','--pipe',`--working-directory=${ROOT}`,
      '--property=LimitCORE=0','--property=Nice=19','--property=CPUAffinity=0-3 6-31','--property=TimeoutStopSec=5s','--property=RuntimeMaxSec=300s',
      ...setenv,...fixedMembersUnitCommand(command)],{env:fixtureEnvironment(t),stdio:['ignore','pipe','pipe']});
    let out='',err='';
    child.stdout.setEncoding('utf8').on('data',data=>{out+=data;});child.stderr.setEncoding('utf8').on('data',data=>{err+=data;});
    return {done:once(child,'close'),get stdout(){return out;},get stderr(){return err;}};
  };
  const seenRows=()=>readFileSync(seen,'utf8').trim().split('\n').map(line=>JSON.parse(line) as Seen);
  return {root,memory,env,start,seen,seenRows,before:join(bins,'before'),after:join(bins,'after')};
}

test('each project is one case admitted at its own forecast, its peak recorded under its path, and the report is the unleased one',async t=>{
  const f=fixture(t),cases=caseHistoryFile(CASE_KEY,f.memory);
  assert.equal(writeCaseHistory(cases,[{key:caseKey(MEASURED),peak:400*MiB}]),undefined);
  const run=f.start([process.execPath,DIFF,f.before,f.after,MEASURED,UNMEASURED]);
  assert.deepEqual(await run.done,[1,null],run.stderr);
  const rows=f.seenRows(),of=(project:string)=>rows.filter(row=>row.project===project);
  // Both arms' four processes of a project ran inside that project's one reservation.
  for(const project of [MEASURED,UNMEASURED]){
    assert.equal(of(project).length,4);
    assert.equal(new Set(of(project).map(row=>row.id)).size,1,`${project} runs inside one reservation`);
    assert.ok(of(project)[0]!.id);
  }
  assert.notEqual(of(MEASURED)[0]!.id,of(UNMEASURED)[0]!.id,'each project is its own admission');
  assert.deepEqual(of(MEASURED).map(row=>[row.bytes,row.live]),Array(4).fill([peakReservation([400*MiB]),false]),'a measured case reserves its own forecast');
  assert.ok(of(UNMEASURED).every(row=>row.live),'an unmeasured case is charged live use and margin');
  assert.deepEqual(readLedger(f.memory.NTS_MEMORY_LEDGER).admitted.filter(entry=>entry.live),[],'every case reservation ended with its case');
  // The peaks went to each case, never to a whole-job row.
  const history=readCaseHistory(cases);
  assert.ok(history.get(caseKey(MEASURED))!.length>=1);
  assert.equal(history.get(caseKey(UNMEASURED))?.length,1);
  assert.ok(history.get(caseKey(UNMEASURED))![0]!>0);
  assert.equal(readCostHistory(historyFile(f.memory)).jobs.has(CASE_KEY),false);
  // The same listings compared in this process, with no lease, print the same report.
  const projects=[MEASURED,UNMEASURED],lines:string[]=[];
  const {results,unmeasured}=await compare(projects,project=>caseArms(f.before,f.after,project,f.env));
  assert.equal(report(f.before,f.after,projects,results,unmeasured,line=>lines.push(line)),1);
  assert.equal(run.stdout,lines.map(line=>line+'\n').join(''));
  assert.match(run.stdout,/STOPPED COMPILING\s+lost -- in 2 project\(s\)/);
});

test('a case that cannot run is not measured, and its neighbour still compares',async t=>{
  const f=fixture(t),outside=join(f.root,'project');
  const run=f.start([process.execPath,DIFF,f.before,f.after,MEASURED,outside]);
  assert.deepEqual(await run.done,[2,null],run.stderr);
  assert.match(run.stderr,/outside its source tree/);
  assert.ok(run.stdout.includes(`  NOT MEASURED  ${outside}: its ${CASE_KEY} case ended 125\n`),run.stdout);
  assert.match(run.stdout,/1 of 2 project\(s\) compared/);
  assert.ok(f.seenRows().every(row=>row.project===MEASURED),'the refused case never ran');
});

test('two first case admissions drop a whole-job row once, under the history lock, and both peaks reach the case',async t=>{
  const f=fixture(t),file=historyFile(f.memory),cases=caseHistoryFile(CASE_KEY,f.memory);
  const row={basis:'job',observations:[{peak:8*2**30,width:1},{peak:13*2**30,width:1}]},kept={'perf-count':{basis:'job',observations:[{peak:MiB*300,width:1}]}};
  writeFileSync(file,JSON.stringify({version:5,cpu_measure:STEP_CPU_MEASURE,steps:{},jobs:{[CASE_KEY]:row,...kept}})+'\n');
  const runs=[1,2].map(()=>f.start([process.execPath,ADMIT,'--key',CASE_KEY,'--case',MEASURED,'--',process.execPath,'-e',HELD_UNTIL_SAMPLED]));
  for(const run of runs){assert.deepEqual(await run.done,[0,null],run.stderr);assert.equal(run.stdout,'ran');}
  const reports=runs.filter(run=>/hir-compare is sized per case \(cases-v2\/hir-compare\.json\); dropped its 2 job sample\(s\)/.test(run.stderr));
  assert.equal(reports.length,1,runs.map(run=>run.stderr).join('\n---\n'));
  const history=readCostHistory(file);
  assert.equal(history.jobs.has(CASE_KEY),false,'the 13 GiB whole-job sample never sizes a case');
  assert.deepEqual(history.jobs.get('perf-count'),kept['perf-count'],'other keys are kept');
  assert.equal(readCaseHistory(cases).get(caseKey(MEASURED))?.length,2,'both concurrent peaks reach the case history');
});
