import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCensusCommand} from './reader-census.ts';
import {firstLosses,classifyLosses,readClassifications,encodeIndex,sliceBudgets,type Capture,type Disposition} from './reader-census-analysis.ts';

const header='id\treader\tkind\tliteral\trole\tsteps\treason\n';
const capture=():Capture=>({sites:[
  {reader:'tooling/census/entry.ts',kind:'named',literal:'tooling/gate/child.ts',targets:['tooling/gate/child.ts'],steps:['tooling'],retainedSteps:['tooling'],lost:2},
  {reader:'tooling/gate/child.ts',kind:'named',literal:'tests/control',targets:['tests/control'],steps:['tooling'],retainedSteps:[],lost:1},
],lost:[{path:'tooling/gate/child.ts',step:'tooling',sources:[0]},{path:'tests/control/main.ts',step:'tooling',sources:[1]}],missing:[]});

test('reader losses name the first retained reader instead of downstream copies',()=>{
  const frontiers=firstLosses(capture());
  assert.deepEqual(frontiers.sites.map(site=>site.id),[0]);
  assert.deepEqual(frontiers.edges.map(edge=>edge.frontiers),[[0],[0]]);
  assert.throws(()=>classifyLosses(frontiers,new Map()),/unclassified first loss: tooling\/census\/entry.ts tooling\/gate\/child.ts/);
  const review=readClassifications(header+'0\ttooling/census/entry.ts\tnamed\ttooling/gate/child.ts\treader\ttooling\tExecutes its child\n');
  const classified=classifyLosses(frontiers,review);
  assert.ok(classified.edges.every(edge=>edge.disposition==='preserve-or-resolve'));
  const plan=sliceBudgets(classified);
  assert.equal(plan[0]!.assignedEdges,2);
  assert.equal(plan.reduce((sum,row)=>sum+row.assignedEdges,0),2,'a shared reader never doubles the edge budget');
});

test('the index retains every path, step, provenance set and disposition byte for byte',()=>{
  const value=classifyLosses(firstLosses(capture()),readClassifications(header+'0\ttooling/census/entry.ts\tnamed\ttooling/gate/child.ts\tdata\ttooling\tPrivate fixture text\n'));
  const first=encodeIndex(value,'a'.repeat(40),'v26.13.0'),second=encodeIndex(value,'a'.repeat(40),'v26.13.0');
  assert.equal(first.bytes,second.bytes);assert.equal(first.sha256,second.sha256);
  const index=JSON.parse(first.bytes) as {paths:string[];steps:string[];frontierSets:number[][];dispositions:Disposition[];edges:[number,number,number,number][]};
  assert.equal(index.frontierSets.length,1);
  assert.deepEqual(index.edges.map(([path,step,set,role])=>({path:index.paths[path],step:index.steps[step],frontiers:index.frontierSets[set],disposition:index.dispositions[role]})),value.edges);
  assert.notEqual(encodeIndex(value,'b'.repeat(40),'v26.13.0').sha256,first.sha256,'the source identity participates in the digest');
});

test('evidence rows retain observation order while edge references are sorted',()=>{
  const value=capture();
  value.sites[1]!.retainedSteps=['tooling'];
  value.lost=[{path:'tests/control/main.ts',step:'tooling',sources:[1,0]}];
  const frontiers=firstLosses(value);
  assert.deepEqual(frontiers.sites.map(site=>site.id),[1,0]);
  assert.deepEqual(frontiers.edges[0]!.frontiers,[0,1]);
});

test('the census refuses conflicting review rows, missing provenance and malformed CLI requests',()=>{
  const line='0\tentry.ts\tnamed\tinput.json\tdata\ttooling\tPrivate text\n';
  assert.throws(()=>readClassifications(header+line+line.replace('\tdata\t','\treader\t')),/conflicting reader census classification/);
  const absent=capture();absent.lost[1]!.sources=[];
  assert.throws(()=>firstLosses(absent),/no first-loss provenance: tests\/control\/main.ts tooling/);
  for(const args of [[],['--no-such-flag'],['reproduce'],['inspect','tree'],['reproduce','out','extra']])assert.throws(()=>parseCensusCommand(args),/usage: reader-census/);
  assert.equal(parseCensusCommand(['reproduce','out']).kind,'reproduce');
});
