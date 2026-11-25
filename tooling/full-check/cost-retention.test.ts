import assert from 'node:assert/strict';
import {test,type TestContext} from 'node:test';
import {existsSync,mkdirSync,readFileSync,renameSync,symlinkSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {testScratch} from '../gate/test-scratch.ts';
import {ownMemory} from '../gate/test-memory.ts';
import {hostObservations} from '../gate/host-observations.ts';
import {GateResource} from '../gate/gate-resource.ts';
import {pruneRawCosts} from './cost-retention.ts';
import {declaredRunRoots,readKeep} from './keep.ts';

function fixture(t:TestContext){
  const root=testScratch(t,'cost-retention'),runs=join(root,'runs');mkdirSync(runs);
  const observations=hostObservations(ownMemory(join(root,'observations')));
  const host={...observations,allocatedBytes:()=>4096};
  const make=(name:string,verdict='green')=>{
    const run=join(runs,name);mkdirSync(join(run,'costs'),{recursive:true});
    writeFileSync(join(run,'costs','events.jsonl'),'raw events\n');writeFileSync(join(run,'step.log'),'kept log\n');
    writeFileSync(join(run,'summary.json'),JSON.stringify({schema:1,started:'2026-11-25T00:00:00Z',wall_s:Number(name),
      verdict,environment:{canonical:true},interrupted:null,scope_cleanup:{state:'complete'},case_costs:{version:1,status:'complete',error_count:0,errors:[],steps:{example:{checks:3}}}}));
    writeFileSync(join(run,'run-lifecycle.json'),JSON.stringify({version:1,events:2,running:[]}));
    return run;
  };
  const newer=()=>{for(const name of ['10','11','12'])make(name);};
  const options={roots:[runs],host,ownership:()=>{}};
  return {root,runs,make,newer,options};
}

test('the fourth completed green run loses raw bytes, keeping summaries and logs byte for byte',t=>{
  const f=fixture(t),old=f.make('1');f.newer();
  const summary=readFileSync(join(old,'summary.json')),log=readFileSync(join(old,'step.log'));
  const report=pruneRawCosts(f.options);
  assert.deepEqual(report.removed.map(row=>row.run),[old]);assert.ok(report.removed[0]!.allocatedBytes>0);
  assert.equal(existsSync(join(old,'costs')),false);
  assert.deepEqual(readFileSync(join(old,'summary.json')),summary);assert.deepEqual(readFileSync(join(old,'step.log')),log);
  for(const name of ['10','11','12'])assert.ok(existsSync(join(f.runs,name,'costs')));
  assert.deepEqual(pruneRawCosts(f.options).removed,[],'idempotent collection');
});

for(const control of ['red','held','missing summary','unreadable summary','future summary','missing terminal','unreadable terminal','future terminal',
  'running terminal','missing case_costs','errored case_costs','future case_costs','live measurement','future measurement','unreadable measurement','interrupted','unfinished cleanup'])
test('retains '+control,t=>{
  const f=fixture(t),run=f.make('1',control==='red'?'red':'green');f.newer();
  const summary=join(run,'summary.json'),lifecycle=join(run,'run-lifecycle.json');
  if(control==='held')writeFileSync(join(run,'measurement-hold.txt'),'outer supervisor held this run');
  if(control.startsWith('missing ')&&control!=='missing case_costs')rmSync(control==='missing summary'?summary:lifecycle);
  if(control.startsWith('unreadable ')){
    const file=control==='unreadable summary'?summary:control==='unreadable terminal'?lifecycle:join(run,'measurement-progress.json');
    rmSync(file,{force:true});mkdirSync(file); // deterministic unreadable-record shape, even when run as root
  }
  if(control==='future summary')writeFileSync(summary,JSON.stringify({schema:99}));
  if(control==='future terminal')writeFileSync(lifecycle,JSON.stringify({version:99,events:2,running:[]}));
  if(control==='running terminal')writeFileSync(lifecycle,JSON.stringify({version:1,events:1,running:['example']}));
  if(control.endsWith('case_costs')||control==='interrupted'||control==='unfinished cleanup'){
    const row=JSON.parse(readFileSync(summary,'utf8'));
    if(control==='missing case_costs')delete row.case_costs;
    if(control==='errored case_costs'){row.case_costs.status='partial';row.case_costs.error_count=1;row.case_costs.errors=['partial JSON'];}
    if(control==='future case_costs')row.case_costs.version=99;
    if(control==='interrupted')row.interrupted='signal SIGTERM';
    if(control==='unfinished cleanup')row.scope_cleanup.state='error';
    writeFileSync(summary,JSON.stringify(row));
  }
  if(control==='live measurement'||control==='future measurement')writeFileSync(join(run,'measurement-progress.json'),JSON.stringify({version:control==='future measurement'?99:1,live:control==='live measurement'}));
  assert.deepEqual(pruneRawCosts(f.options).removed,[]);assert.ok(existsSync(join(run,'costs','events.jsonl')));
});

for(const guard of ['holder','replacement','summary change','symlink','lock'])test('retains raw costs at '+guard+' boundary',t=>{
  const f=fixture(t),run=f.make('1');f.newer();
  const path=join(run,'costs');let lock:GateResource|null=null;
  if(guard==='lock')lock=GateResource.tryAcquire(f.runs+'.cost-retention.lock');
  if(guard==='symlink'){renameSync(path,join(f.root,'saved'));symlinkSync(join(f.root,'saved'),path);}
  try{
    const result=pruneRawCosts({...f.options,ownership:()=>{
      if(guard==='holder')throw Error('unit writer.service owns costs');
      if(guard==='replacement'){renameSync(path,join(f.root,'original'));mkdirSync(path);writeFileSync(join(path,'new'),'new owner');}
      if(guard==='summary change')writeFileSync(join(run,'summary.json'),'{}');
    }});
    assert.deepEqual(result.removed,[]);assert.ok(existsSync(path));assert.ok(result.kept.some(row=>/writer.service|identity changed|schema|physical directory|lock held/.test(row.reason)),JSON.stringify(result));
  }finally{lock?.close();}
});

test('run roots come from the same keep declarations as the count',()=>{
  const roots=declaredRunRoots('/private/cache',readKeep());
  for(const name of ['nts-full-check/runs','nts-landing/runs','nts-gate/runs'])assert.ok(roots.includes('/private/cache/'+name));
  assert.ok(!roots.some(root=>root.includes('nts-scratch')));
});


test('interrupted detached deletion resumes only the receipt-bound raw directory',t=>{
  const f=fixture(t),run=f.make('1');f.newer();let detached='';
  const first=pruneRawCosts({...f.options,removePayload:(path)=>{detached=path;throw Error('fixture interruption');}});
  assert.deepEqual(first.removed,[]);assert.ok(existsSync(join(detached,'events.jsonl')));
  // A new producer at the old name is outside the old deletion grant.
  mkdirSync(join(run,'costs'));writeFileSync(join(run,'costs/new'),'new producer');
  const resumed=pruneRawCosts(f.options);
  assert.deepEqual(resumed.removed.map(row=>row.run),[run]);assert.equal(existsSync(detached),false);
  assert.equal(readFileSync(join(run,'costs/new'),'utf8'),'new producer');
});


test('partial coverage without reader errors has a materialized summary and is prunable',t=>{
  const f=fixture(t),run=f.make('1');f.newer();
  const file=join(run,'summary.json'),row=JSON.parse(readFileSync(file,'utf8'));row.case_costs.status='partial';
  row.case_costs.steps={example:{coverage:{missing_program_checks:['absent'],incomplete:1},cases:[{complete:false,phases:[]}]}};
  writeFileSync(file,JSON.stringify(row));
  assert.deepEqual(pruneRawCosts(f.options).removed.map(row=>row.run),[run]);
});
