import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {createContext,runInContext} from 'node:vm';
import {SourceFacts} from './source-facts.ts';
import {testEnvironment} from './test-environment.ts';

const GiB=2**30;
const {API}=createRequire(import.meta.url)('typescript/sync') as typeof import('typescript/sync');

// Execute the production policy with supplied observations and a controlled
// reservation transport. No subprocess, elapsed time or host memory decides it.
function policy(name='adjustMemory'){
  const source=readFileSync(new URL('./run.mjs',import.meta.url),'utf8'),api=new API();
  const lease=api.createSourceFile('run.mjs',source);
  try{
    const facts=new SourceFacts('tooling/gate/run.mjs',source,lease.sourceFile);
    const node=facts.ofKind(facts.ast.SyntaxKind.FunctionDeclaration).find(node=>facts.ast.isFunctionDeclaration(node)&&node.name?.text===name);
    if(node)return facts.code(node);
    const value=facts.ofKind(facts.ast.SyntaxKind.VariableDeclaration).find(node=>facts.ast.isVariableDeclaration(node)&&facts.ast.isIdentifier(node.name)&&node.name.text===name);
    if(value&&facts.ast.isVariableDeclaration(value)&&value.initializer)return facts.code(value.initializer);
    const field=facts.ofKind(facts.ast.SyntaxKind.PropertyAssignment).find(node=>facts.ast.isPropertyAssignment(node)&&facts.ast.isIdentifier(node.name)&&node.name.text===name);
    assert.ok(field&&facts.ast.isPropertyAssignment(field));return facts.code(field.initializer);
  }finally{lease.dispose();api.close();}
}

function controlledGrowth({grantAtCancellation=false,allocated:initial=10*GiB,deferAll=false,backfill=false}={}){
  let allocated=initial,drained=0,active=0,maximumActive=0,reschedules=0;
  const calls:number[]=[],kinds:boolean[]=[],cancelled:number[]=[],reports:string[]=[];
  const closed=Promise.withResolvers<void>();
  const pending:{bytes:number;draining:boolean;answer:ReturnType<typeof Promise.withResolvers<void>>;done:boolean}[]=[];
  void closed.promise.catch(()=>{});
  const state={
    stopping:false,summaryWritten:false,yielding:false,outrankedNow:false,drainReturn:null as Promise<void>|null,withholdBytes:0,memoryWanted:21*GiB,
    capacity:32*GiB,BLOCK:GiB,running:new Map<string,{draining:boolean;want:number}>(),growth:null as null|{bytes:number;draining:boolean;controller:AbortController;withdrawn:boolean},
    memoryRecord:{shrinks:0,growths:0,withdrawn:0,waited_s:0},
    used:()=>({bytes:0}),outranked:():boolean=>state.yielding,reserved:()=>allocated,tokenShort:()=>0,
    tokenDemand:(u:{bytes:number})=>u.bytes,
    gib:(bytes:number)=>String(bytes),AbortController,Date:{now:()=>0},
    process:{stderr:{write:(message:string)=>reports.push(message)}},
    stop:(message:string):void=>{state.stopping=true;closed.reject(Error(message));},noteSize:()=>{},schedule:():void=>{},
    setImmediate:(callback:()=>void):NodeJS.Immediate=>{reschedules++;return setImmediate(callback);},
    reservation:{
      get drained(){return drained;},
      shrink:async(bytes:number)=>{allocated-=bytes;drained=Math.max(0,drained-bytes);},
      grow:(bytes:number,{signal,draining}:{signal:AbortSignal;draining:boolean}):Promise<void>=>{
        if(calls.length>=8)return Promise.reject(Error('controlled ledger operation loop'));
        assert.equal(active,0,'the old request settles before replacement');active++;maximumActive=Math.max(maximumActive,active);calls.push(bytes);kinds.push(draining);
        const answer=Promise.withResolvers<void>();
        if(calls.length===1||deferAll){
          const flight={bytes,draining,answer,done:false};pending.push(flight);
          signal.addEventListener('abort',()=>{
            if(flight.done)return;flight.done=true;
            cancelled.push(bytes);active--;
            if(grantAtCancellation){allocated+=bytes;if(draining&&(backfill||state.yielding))drained+=bytes;answer.resolve();}
            else answer.reject(Error('controlled cancellation'));
          },{once:true});
        }else{allocated+=bytes;if(draining&&(backfill||state.yielding))drained+=bytes;active--;answer.resolve();}
        return answer.promise;
      },
    },
  };
  const adjust=runInContext('('+policy()+')',createContext(state)) as ()=>void;
  state.schedule=()=>{if(state.stopping)return;adjust();if(!state.growth)closed.resolve();};
  return {state,adjust,closed:closed.promise,calls,kinds,cancelled,reports,
    allocated:()=>allocated,maximumActive:()=>maximumActive,reschedules:()=>reschedules,
    grantFirst(){const first=pending.find(flight=>!flight.done);assert.ok(first);first.done=true;allocated+=first.bytes;if(first.draining&&(backfill||state.yielding))drained+=first.bytes;active--;first.answer.resolve();}};
}

test('an excessive ticket settles before its replacement can request the current gap',async()=>{
  const run=controlledGrowth();run.adjust();
  assert.deepEqual(run.calls,[11*GiB]);
  run.state.memoryWanted=11*GiB;run.adjust();
  assert.deepEqual(run.calls,[11*GiB],'abort starts synchronously but replacement awaits finally');
  assert.equal(run.state.growth?.withdrawn,true);
  await run.closed;
  assert.deepEqual(run.calls,[11*GiB,GiB]);assert.deepEqual(run.cancelled,[11*GiB]);
  assert.equal(run.allocated(),11*GiB);assert.equal(run.maximumActive(),1);assert.equal(run.state.growth,null);
  assert.equal(run.state.memoryRecord.withdrawn,1);assert.deepEqual(run.reports,[]);
});

test('a grant racing cancellation is retained once and excess memory is returned',async()=>{
  const run=controlledGrowth({grantAtCancellation:true});run.adjust();run.state.memoryWanted=11*GiB;run.adjust();
  await run.closed;
  assert.deepEqual(run.calls,[11*GiB]);assert.deepEqual(run.cancelled,[11*GiB]);
  assert.equal(run.allocated(),11*GiB);assert.equal(run.state.growth,null);
  assert.equal(run.state.memoryRecord.growths,1);assert.equal(run.state.memoryRecord.shrinks,1);assert.deepEqual(run.reports,[]);
});

test('a smaller useful ticket completes as a partial grant without cancellation',async()=>{
  const run=controlledGrowth();run.state.memoryWanted=11*GiB;run.adjust();
  run.state.memoryWanted=12*GiB;run.adjust();
  assert.deepEqual(run.calls,[GiB]);assert.deepEqual(run.cancelled,[]);
  assert.equal(run.state.growth?.withdrawn,false);run.grantFirst();await run.closed;
  assert.deepEqual(run.calls,[GiB,GiB]);assert.equal(run.allocated(),12*GiB);
  assert.equal(run.state.memoryRecord.withdrawn,0);assert.equal(run.maximumActive(),1);assert.deepEqual(run.reports,[]);
});

test('pending step demand greater than slack settles without giving its growth back',async()=>{
  const run=controlledGrowth({allocated:15*GiB});
  run.state.memoryWanted=0;run.state.used=()=>({bytes:15_951_986_688});
  run.state.running.set('tooling',{draining:false,want:4*GiB});
  run.adjust();assert.deepEqual(run.calls,[4*GiB]);run.grantFirst();await run.closed;
  assert.equal(run.allocated(),19*GiB);assert.equal(run.state.memoryRecord.shrinks,0);
  assert.equal(run.reschedules(),1,'a completed growth re-evaluates on the next macrotask');
  for(let i=0;i<12;i++)run.adjust();
  assert.deepEqual(run.calls,[4*GiB]);assert.equal(run.maximumActive(),1);
  assert.equal(run.state.growth,null);assert.deepEqual(run.reports,[]);
});

test('yielding grows only the started cohort and retains its unmet drain demand',async()=>{
  const run=controlledGrowth({allocated:4*GiB});
  run.state.yielding=true;run.state.used=()=>({bytes:4*GiB});
  run.state.memoryWanted=28*GiB;run.state.withholdBytes=8*GiB;
  run.state.running.set('started',{draining:false,want:2*GiB});
  run.adjust();assert.deepEqual(run.calls,[2*GiB]);assert.deepEqual(run.kinds,[true]);
  run.grantFirst();await run.closed;
  assert.equal(run.allocated(),6*GiB);
  for(let i=0;i<12;i++)run.adjust();
  assert.deepEqual(run.calls,[2*GiB]);assert.equal(run.state.memoryRecord.shrinks,0);
  assert.equal(run.reschedules(),1);assert.deepEqual(run.reports,[]);
});

test('yielding joins a mixed ticket before replacing it with a drain-only growth',async()=>{
  const run=controlledGrowth();run.adjust();
  assert.deepEqual(run.calls,[11*GiB]);assert.deepEqual(run.kinds,[false]);
  run.state.yielding=true;run.state.used=()=>({bytes:10*GiB});
  run.state.running.set('started',{draining:false,want:GiB});
  run.adjust();assert.deepEqual(run.calls,[11*GiB]);
  await run.closed;
  assert.deepEqual(run.calls,[11*GiB,GiB]);assert.deepEqual(run.kinds,[false,true]);
  assert.deepEqual(run.cancelled,[11*GiB]);assert.equal(run.maximumActive(),1);
  assert.equal(run.allocated(),11*GiB);assert.deepEqual(run.reports,[]);
});

test('yielding forbids a new step while keeping the started cohort eligible for case leases',()=>{
  const running=new Map([['started',{draining:false}]]),calls:string[]=[];
  const row={name:'new',fe:false};
  const state={preparing:false,stopping:false,summaryWritten:false,drainReturn:null,reservation:{drained:0},outranked:()=>true,outrankedNow:true,
    pending:['new'],running,BY_NAME:new Map([['new',row],['started',{name:'started',fe:false}]]),
    withhold:0,withholdBytes:0,memoryWanted:0,blockedBy:()=>null,preflight:()=>null,
    used:()=>({bytes:0,slots:0,fe:0,locks:new Set()}),admit:()=>({slots:1,rider:false}),
    start:(step:{name:string})=>{calls.push(step.name);},grant:()=>{},adjustMemory:()=>{},done:()=>{},lookAgain:()=>{},
    SLOTS:24,FRONTENDS:4,reserved:()=>GiB,tokenBytes:()=>GiB,wantMemory:()=>calls.push('memory'),
  };
  const context=createContext(state),schedule=runInContext('('+policy('schedule')+')',context) as ()=>void;
  schedule();assert.deepEqual(calls,[]);assert.deepEqual(state.pending,['new']);
  const eligible=runInContext('('+policy('eligible')+')',context) as (step:string,bytes?:number)=>boolean;
  assert.equal(eligible('new'),false);assert.equal(eligible('started'),true);
  running.get('started')!.draining=true;assert.equal(eligible('started'),false);
  state.outranked=()=>false;schedule();assert.deepEqual(calls,['new']);
});

async function equalRankDrain(){
  const run=controlledGrowth({allocated:4*GiB,backfill:true});
  run.state.memoryWanted=0;run.state.used=()=>({bytes:4*GiB});
  run.state.running.set('started',{draining:false,want:2*GiB});
  run.adjust();run.grantFirst();await run.closed;
  assert.deepEqual(run.kinds,[true]);assert.equal(run.state.reservation.drained,2*GiB);
  let usedBytes=4*GiB;
  const starts:string[]=[],row={name:'pending',slots:1,min:1,fe:false,elastic:false};
  const state={...run.state,preparing:false,pending:['pending'],withhold:0,
    get drainReturn(){return run.state.drainReturn;},set drainReturn(value:Promise<void>|null){run.state.drainReturn=value;},
    BY_NAME:new Map([['pending',row]]),SLOTS:24,FRONTENDS:4,ELASTIC_CAP:6,tokenAddr:null,
    used:()=>({bytes:usedBytes,slots:1,fe:0,locks:new Set(),elastic:0,riding:0}),
    admit:(_step:typeof row,_u:unknown):{slots:number;short?:number;bytes?:number;rider?:boolean}=>({slots:0}),
    reservedForStarts:()=>0,stepBytes:()=>2*GiB,tiny:()=>false,
    blockedBy:()=>null,preflight:()=>null,fixedReservation:()=>0,
    start:(step:typeof row):void=>{starts.push(step.name);state.running.set(step.name,{draining:false,want:0});},
    grant:()=>{},adjustMemory:()=>{},done:()=>{},lookAgain:()=>{},
  };
  const context=createContext(state);
  state.admit=runInContext('('+policy('admit')+')',context) as typeof state.admit;
  state.reservedForStarts=runInContext('('+policy('reservedForStarts')+')',context) as typeof state.reservedForStarts;
  const schedule=runInContext('('+policy('schedule')+')',context) as ()=>void;
  return {run,state,starts,schedule,clearCohort(){state.running.clear();usedBytes=0;}};
}

test('an equal-rank drain grant cannot fund a new pending step before its running want consumes it',async()=>{
  const {run,state,starts,schedule}=await equalRankDrain();
  assert.equal(state.outranked(),false,'equal-rank work has no higher-priority yield');
  schedule();assert.deepEqual(starts,[]);assert.deepEqual(state.pending,['pending']);
  assert.equal(state.memoryWanted,8*GiB,'new work must ask for ordinary capacity beyond the protected grant');
  assert.equal(run.allocated(),6*GiB);assert.equal(state.reservedForStarts(),4*GiB);
});

test('an unresolved cohort return owns repeated scheduling until its rewrite and the next turn complete',async()=>{
  const {run,state,starts,schedule,clearCohort}=await equalRankDrain(),resumed=Promise.withResolvers<void>();
  const writing=Promise.withResolvers<void>(),persisted=Promise.withResolvers<void>();
  const shrink=run.state.reservation.shrink;let returns=0;
  run.state.reservation.shrink=(bytes:number)=>{
    returns++;const changed=shrink(bytes);writing.resolve();return changed.then(()=>persisted.promise);
  };
  clearCohort();state.adjustMemory=run.adjust;
  run.state.schedule=()=>{schedule();resumed.resolve();};
  schedule();assert.deepEqual(starts,[],'return completion cannot launch a new cohort synchronously');
  assert.ok(state.drainReturn);await writing.promise;
  assert.equal(run.state.reservation.drained,0);assert.equal(run.allocated(),4*GiB);
  schedule();run.adjust();
  assert.equal(returns,1,'all competing schedule and adjustment calls join the existing return');
  assert.deepEqual(starts,[],'a local zero marker does not prove the locked rewrite settled');
  persisted.resolve();
  await resumed.promise;
  assert.deepEqual(starts,['pending']);assert.equal(run.reschedules(),2);
  assert.equal(state.drainReturn,null);
  assert.deepEqual(run.reports,[]);
});

test('token demand comes only from live started steps and excludes pending-step withhold when draining',()=>{
  const state={tokenAddr:'owned',SLOTS:24,FRONTENDS:4,withhold:20,withholdBytes:8*GiB,
    running:new Map([['started',{draining:false}],['closing',{draining:true}]]),
    tok:{waiting:[{step:'new',bytes:12*GiB},{step:'closing',bytes:10*GiB},{step:'started',bytes:2*GiB}]},
    BY_NAME:new Map(['new','closing','started'].map(name=>[name,{name,fe:false}])),tokenBytes:()=>GiB};
  const demand=runInContext('('+policy('tokenDemand')+')',createContext(state)) as (u:{bytes:number;slots:number;fe:number},withheld?:number,slots?:number)=>number;
  const used={bytes:4*GiB,slots:4,fe:0};
  assert.equal(demand(used),4*GiB,'the pending fixed step withholds all free slots');
  assert.equal(demand(used,0,0),6*GiB,'only the running step case is completion demand');
});

for(const yielding of [false,true])test(`sampling and child close run while a following ${yielding?'draining ':''}growth remains pending`,async()=>{
  const run=controlledGrowth({deferAll:true}),following=Promise.withResolvers<void>();
  if(yielding){
    run.state.yielding=true;run.state.used=()=>({bytes:10*GiB});
    run.state.running.set('started',{draining:false,want:11*GiB});
  }
  const schedule=run.state.schedule;
  run.state.schedule=()=>{schedule();following.resolve();};
  run.adjust();run.state.memoryWanted=22*GiB;
  if(yielding)run.state.running.get('started')!.want=12*GiB;
  run.grantFirst();await following.promise;
  assert.deepEqual(run.calls,[11*GiB,GiB]);assert.ok(run.state.growth);
  const sampled=Promise.withResolvers<void>();
  const sampler=setInterval(()=>sampled.resolve(),1);
  const child=spawn(process.execPath,['--version'],{env:testEnvironment(),stdio:'ignore'});
  const reaped=new Promise<void>((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',(code,signal)=>{
      try{assert.equal(code,0);assert.equal(signal,null);assert.ok(run.state.growth);resolve();}catch(error){reject(error);}
    });
  });
  try{await Promise.all([sampled.promise,reaped]);assert.ok(run.state.growth);}
  finally{clearInterval(sampler);run.grantFirst();await run.closed;}
  assert.equal(run.reschedules(),2);assert.equal(run.maximumActive(),1);
  assert.equal(run.allocated(),22*GiB);assert.deepEqual(run.reports,[]);
  assert.deepEqual(run.kinds,[yielding,yielding]);
});
