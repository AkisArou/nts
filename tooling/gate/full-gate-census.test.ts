import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {collectFullGateCensus,FULL_GATE_RECORD,fullGateProblems,parseFullGateRecord,runFullGateCensus} from './full-gate-census.ts';
import {testScratch} from './test-scratch.ts';

test('the full-gate inventory counts tracked subjects once and retains directory breadth',()=>{
  const directories=[{reader:'tooling/reader.ts',directory:'tests/data',files:3,steps:['tooling']}];
  const census=collectFullGateCensus(['z','a','z'],path=>({full:path==='z',reasons:['no declared reader']}),directories);
  const full=[{path:'z',reasons:['no declared reader']}];
  assert.deepEqual(census,{version:2,tracked:2,full,unplaced:full,policy:[],directories});
  assert.deepEqual(fullGateProblems({version:1,files:['z']},census),[]);
  assert.match(fullGateProblems({version:1,files:['a']},census)[0]!,/z newly owes the full gate/);
});
test('the tool-owned ceiling can only fall, including when the total count stays the same',t=>{
  const root=testScratch(t,'full-gate-census');
  const census=(files:string[])=>collectFullGateCensus(files,()=>({full:true,reasons:['untraced']}),[]);
  runFullGateCensus(root,()=>census(['a','b']),{record:true,initialize:true});
  assert.deepEqual(parseFullGateRecord(JSON.parse(readFileSync(join(root,FULL_GATE_RECORD),'utf8'))),{version:2,files:['a','b'],policy:[]});
  const changed=runFullGateCensus(root,()=>census(['a','c']),{record:true});
  assert.match(changed.problems[0]!,/c newly owes/);
  assert.deepEqual(JSON.parse(readFileSync(join(root,FULL_GATE_RECORD),'utf8')).files,['a','b']);
  assert.deepEqual(runFullGateCensus(root,()=>census(['a']),{record:true}).problems,[]);
  assert.deepEqual(JSON.parse(readFileSync(join(root,FULL_GATE_RECORD),'utf8')).files,['a']);
  assert.throws(()=>runFullGateCensus(root,()=>census([]),{record:true,initialize:true}),/already exists/);
});
test('an incomplete initialization leaves no record, and malformed records fail closed',t=>{
  const root=testScratch(t,'full-gate-census-failure');
  assert.throws(()=>runFullGateCensus(root,()=>{throw Error('reader unavailable');},{record:true,initialize:true}),/reader unavailable/);
  assert.equal(existsSync(join(root,FULL_GATE_RECORD)),false);
  for(const value of [{version:1,files:['../outside']},{version:1,files:['a','a']},{version:1,files:['z','a']},{version:2,files:[]}])assert.throws(()=>parseFullGateRecord(value),/full-gate census record/);
});

test('a policy file rename retains its full rule without permitting a new unplaced path',t=>{
  const root=testScratch(t,'full-gate-policy');
  const census=(policy:string,unknown:string)=>collectFullGateCensus([policy,unknown],path=>({full:true,reasons:[path===policy?'shared scheduler':'unplaced'],...(path===policy?{policyReasons:['shared scheduler']}:{})}),[]);
  runFullGateCensus(root,()=>census('old.mjs','unknown'),{record:true,initialize:true});
  const moved=runFullGateCensus(root,()=>census('new.ts','unknown'),{record:true});
  assert.deepEqual(moved.problems,[]);
  const record=parseFullGateRecord(JSON.parse(readFileSync(join(root,FULL_GATE_RECORD),'utf8')));
  assert.deepEqual(record,{version:2,files:['unknown'],policy:[{path:'new.ts',reasons:['shared scheduler']}]});
  assert.match(runFullGateCensus(root,()=>census('new.ts','new-unknown'),{record:true}).problems[0]!,/new-unknown newly owes/);
  assert.match(runFullGateCensus(root,()=>collectFullGateCensus(['new.ts','unknown'],()=>({full:true,reasons:['unplaced']}),[]),{record:true}).problems[0]!,/new.ts newly owes/);
});
