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
function policy(){
  const source=readFileSync(new URL('./run.mjs',import.meta.url),'utf8'),api=new API();
  const lease=api.createSourceFile('run.mjs',source);
  try{
    const facts=new SourceFacts('tooling/gate/run.mjs',source,lease.sourceFile);
    const node=facts.ofKind(facts.ast.SyntaxKind.FunctionDeclaration).find(node=>facts.ast.isFunctionDeclaration(node)&&node.name?.text==='adjustMemory');
    assert.ok(node);return facts.code(node);
  }finally{lease.dispose();api.close();}
}

function controlledGrowth({grantAtCancellation=false,allocated:initial=10*GiB,deferAll=false}={}){
  let allocated=initial,active=0,maximumActive=0,reschedules=0;
  const calls:number[]=[],cancelled:number[]=[],reports:string[]=[];
  const closed=Promise.withResolvers<void>();
  const pending:{bytes:number;answer:ReturnType<typeof Promise.withResolvers<void>>;done:boolean}[]=[];
  void closed.promise.catch(()=>{});
  const state={
    stopping:false,summaryWritten:false,withholdBytes:0,memoryWanted:21*GiB,
    capacity:32*GiB,BLOCK:GiB,running:new Map<string,{draining:boolean;want:number}>(),growth:null as null|{bytes:number;controller:AbortController;withdrawn:boolean},
    memoryRecord:{shrinks:0,growths:0,withdrawn:0,waited_s:0},
    used:()=>({bytes:0}),outranked:()=>false,reserved:()=>allocated,tokenShort:()=>0,
    gib:(bytes:number)=>String(bytes),AbortController,Date:{now:()=>0},
    process:{stderr:{write:(message:string)=>reports.push(message)}},
    stop:(message:string):void=>{state.stopping=true;closed.reject(Error(message));},noteSize:()=>{},schedule:():void=>{},
    setImmediate:(callback:()=>void):NodeJS.Immediate=>{reschedules++;return setImmediate(callback);},
    reservation:{
      shrink:async(bytes:number)=>{allocated-=bytes;},
      grow:(bytes:number,{signal}:{signal:AbortSignal}):Promise<void>=>{
        if(calls.length>=8)return Promise.reject(Error('controlled ledger operation loop'));
        assert.equal(active,0,'the old request settles before replacement');active++;maximumActive=Math.max(maximumActive,active);calls.push(bytes);
        const answer=Promise.withResolvers<void>();
        if(calls.length===1||deferAll){
          const flight={bytes,answer,done:false};pending.push(flight);
          signal.addEventListener('abort',()=>{
            if(flight.done)return;flight.done=true;
            cancelled.push(bytes);active--;
            if(grantAtCancellation){allocated+=bytes;answer.resolve();}
            else answer.reject(Error('controlled cancellation'));
          },{once:true});
        }else{allocated+=bytes;active--;answer.resolve();}
        return answer.promise;
      },
    },
  };
  const adjust=runInContext('('+policy()+')',createContext(state)) as ()=>void;
  state.schedule=()=>{if(state.stopping)return;adjust();if(!state.growth)closed.resolve();};
  return {state,adjust,closed:closed.promise,calls,cancelled,reports,
    allocated:()=>allocated,maximumActive:()=>maximumActive,reschedules:()=>reschedules,
    grantFirst(){const first=pending.find(flight=>!flight.done);assert.ok(first);first.done=true;allocated+=first.bytes;active--;first.answer.resolve();}};
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

test('sampling and child close run while a following growth remains pending',async()=>{
  const run=controlledGrowth({deferAll:true}),following=Promise.withResolvers<void>();
  const schedule=run.state.schedule;
  run.state.schedule=()=>{schedule();following.resolve();};
  run.adjust();run.state.memoryWanted=22*GiB;run.grantFirst();await following.promise;
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
});
