import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {collectFullGateCensus,FULL_GATE_RECORD,fullGateProblems,parseFullGateRecord,runFullGateCensus} from './full-gate-census.ts';
import {testScratch} from './test-scratch.ts';

test('the full-gate inventory counts tracked subjects once and retains directory breadth',()=>{
  const directories=[{reader:'tooling/reader.ts',directory:'tests/data',files:3,steps:['tooling']}];
  const census=collectFullGateCensus(['z','a','z'],path=>({full:path==='z',reasons:['no declared reader']}),directories);
  assert.deepEqual(census,{version:1,tracked:2,full:[{path:'z',reasons:['no declared reader']}],directories});
  assert.deepEqual(fullGateProblems({version:1,files:['z']},census),[]);
  assert.match(fullGateProblems({version:1,files:['a']},census)[0]!,/z newly owes the full gate/);
});
test('the tool-owned ceiling can only fall, including when the total count stays the same',t=>{
  const root=testScratch(t,'full-gate-census');
  const census=(files:string[])=>collectFullGateCensus(files,()=>({full:true,reasons:['untraced']}),[]);
  runFullGateCensus(root,()=>census(['a','b']),{record:true,initialize:true});
  assert.deepEqual(parseFullGateRecord(JSON.parse(readFileSync(join(root,FULL_GATE_RECORD),'utf8'))),{version:1,files:['a','b']});
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
