import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {createContext,runInContext} from 'node:vm';
import {SourceFacts} from './source-facts.ts';

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

function controlledGrowth(grantAtCancellation=false){
  let allocated=10*GiB,active=0,maximumActive=0;
  const calls:number[]=[],cancelled:number[]=[],reports:string[]=[];
  const closed=Promise.withResolvers<void>();
  let first:{bytes:number;answer:ReturnType<typeof Promise.withResolvers<void>>}|undefined;
  const state={
    stopping:false,summaryWritten:false,withholdBytes:0,memoryWanted:21*GiB,
    capacity:32*GiB,BLOCK:GiB,running:new Map(),growth:null as null|{bytes:number;controller:AbortController;withdrawn:boolean},
    memoryRecord:{shrinks:0,growths:0,withdrawn:0,waited_s:0},
    used:()=>({bytes:0}),outranked:()=>false,reserved:()=>allocated,tokenShort:()=>0,
    gib:(bytes:number)=>String(bytes),AbortController,Date:{now:()=>0},
    process:{stderr:{write:(message:string)=>reports.push(message)}},
    stop:(message:string)=>{throw Error(message);},noteSize:()=>{},schedule:()=>{},
    reservation:{
      shrink:async(bytes:number)=>{allocated-=bytes;},
      grow:(bytes:number,{signal}:{signal:AbortSignal})=>{
        assert.equal(active,0,'the old request settles before replacement');active++;maximumActive=Math.max(maximumActive,active);calls.push(bytes);
        const answer=Promise.withResolvers<void>();
        if(calls.length===1){
          first={bytes,answer};
          signal.addEventListener('abort',()=>{
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
  state.schedule=()=>{adjust();if(!state.growth)closed.resolve();};
  return {state,adjust,closed:closed.promise,calls,cancelled,reports,
    allocated:()=>allocated,maximumActive:()=>maximumActive,
    grantFirst(){assert.ok(first);allocated+=first.bytes;active--;first.answer.resolve();}};
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
  const run=controlledGrowth(true);run.adjust();run.state.memoryWanted=11*GiB;run.adjust();
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
