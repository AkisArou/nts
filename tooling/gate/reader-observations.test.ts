import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,readFileSync,rmSync,utimesSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {test,type TestContext} from 'node:test';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';
import {moduleGraph,type InputSnapshot} from './module-closure.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {projectInput,projectConfig} from './reader-inputs/main.ts';
import {validateReaderSourceObservations,replayFixtureReaderObservations,NonPortableReaderObservation} from './reader-observations.ts';
import {testScratch} from './test-scratch.ts';

function fixture(t:TestContext){
  const root=testScratch(t,'reader-observation'),source=join(root,'source'),destination=join(root,'destination');mkdirSync(source);
  const write=(path:string,text:string)=>{const file=join(source,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
  write('package.json','{"type":"module"}');write('tsconfig.json','{"files":["src/main.ts"]}');
  write('src/main.ts',"import './helper.ts';import type {Value} from '../types.ts';export const value:Value=1;");
  write('src/helper.ts','export {};');write('types.ts','export type Value=number;');
  return {source,destination,write};
}
function snapshot(source:string,entries:Parameters<ReturnType<typeof moduleGraph>['describe']>[0],node=false):InputSnapshot{
  const graph=moduleGraph({sourceRoot:source,...(node?{nodeMajor:26 as const}:{})});
  try{return graph.describe(entries);}finally{graph.close();}
}

test('explicit Node capture retains nearer package candidates without entering type-only modules',t=>{
  const f=fixture(t),first=snapshot(f.source,['src/main.ts'],true);
  assert.deepEqual(first.hostFiles,['src/helper.ts','src/main.ts']);
  assert.ok(first.moduleFiles.includes('types.ts'));
  assert.ok(first.ownedFiles.includes('package.json'));assert.ok(!first.placingFiles.includes('package.json'));
  assert.ok(first.observations.some(row=>row.protocol==='node26'&&row.observation.kind==='file'&&row.observation.path===join(f.source,'src/package.json')&&row.observation.value===null));
  assert.equal(snapshot(f.source,['src/main.ts']).observations.length,0);
  const staged=copyModuleClosure(['src/main.ts'],f.destination,{sourceRoot:f.source,nodeMajor:26});
  assert.ok(staged.includes('package.json'));assert.deepEqual(readFileSync(join(f.destination,'package.json')),readFileSync(join(f.source,'package.json')));
  assert.deepEqual(copyModuleClosure(['src/main.ts'],f.destination,{sourceRoot:f.source,nodeMajor:26}),staged);
  f.write('src/package.json','{"type":"module"}');
  assert.throws(()=>validateReaderSourceObservations(first,f.source),/filesystem file changed: .*src\/package.json/);
  const nearer=snapshot(f.source,['src/main.ts'],true);
  assert.ok(nearer.ownedFiles.includes('src/package.json'));assert.ok(!nearer.files.includes('package.json'));
  rmSync(join(f.source,'src/package.json'));
  assert.ok(snapshot(f.source,['src/main.ts'],true).ownedFiles.includes('package.json'));
});

test('compiled roots and later host imports retain both roles in either discovery order',t=>{
  const f=fixture(t),project=projectInput(pathToFileURL(join(f.source,'src/main.ts')));
  const compiled=snapshot(f.source,[project],true);
  assert.deepEqual(compiled.hostFiles,[]);assert.ok(compiled.moduleFiles.includes('src/helper.ts'));
  assert.ok(compiled.observations.some(row=>row.protocol==='project'));
  assert.ok(compiled.observations.every(row=>row.protocol!=='node26'));
  for(const entries of [[project,'src/main.ts'],['src/main.ts',project]]){
    const both=snapshot(f.source,entries,true);
    assert.deepEqual(both.hostFiles,['src/helper.ts','src/main.ts']);
    assert.ok(both.observations.some(row=>row.protocol==='project'));
    assert.ok(both.observations.some(row=>row.protocol==='node26'&&row.reader==='src/main.ts'));
  }
  const fromEntry=copyModuleClosure([project],f.destination,{sourceRoot:f.source});
  assert.deepEqual(copyModuleClosure([projectConfig(pathToFileURL(join(f.source,'tsconfig.json')))],f.destination,{sourceRoot:f.source}),fromEntry);
});

test('source stat facts validate before copying and retain both non-portable destination values',t=>{
  const f=fixture(t),file=join(f.source,'src/main.ts');
  chmodSync(file,0o751);utimesSync(file,1234,1234);utimesSync(f.source,1234,1234);
  const base=snapshot(f.source,['src/main.ts']),filesystem=new OracleFilesystem();filesystem.stat(file);filesystem.stat(f.source);
  for(const observation of filesystem.captured()){
    const facts:InputSnapshot={...base,observations:[{reader:'src/main.ts',protocol:'project',context:{entry:'<entry>',dataNamespaces:{src:'a prefix is not data ownership'}},observation}]};
    validateReaderSourceObservations(facts,f.source);
    copyModuleClosure(['src/main.ts'],f.destination,{sourceRoot:f.source});
    assert.throws(()=>replayFixtureReaderObservations(facts,f.source,f.destination,new Set()),(error:unknown)=>{
      assert.ok(error instanceof NonPortableReaderObservation);assert.deepEqual(error.source,observation);
      assert.equal(error.destination.kind,'stat');assert.notDeepEqual(error.source.value,error.destination.value);
      assert.match(error.message,/source=.*\ndestination=/);return true;
    });
  }
});
