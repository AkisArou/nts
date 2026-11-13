import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,readFileSync,rmSync,symlinkSync,utimesSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {test,type TestContext} from 'node:test';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';
import {moduleGraph,type InputSnapshot} from './module-closure.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {projectInput,projectConfig} from './reader-inputs/main.ts';
import {validateReaderSourceObservations,replayFixtureReaderObservations,NonPortableReaderObservation} from './reader-observations.ts';
import {testScratch} from './test-scratch.ts';
import {spawnTest} from './test-wait.ts';
import {gitArguments} from './git-arguments/main.ts';

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

test('private and production host visits retain their separate contexts in either order',t=>{
  const f=fixture(t);f.write('data/tool.ts','export {};');f.write('data/value.txt','production');
  f.write('child.ts',"import './data/tool.ts';");f.write('private.ts','export {};');f.write('production.ts',"import './child.ts';");
  for(const args of [['init','--quiet'],['add','.']]){
    const result=spawnTest('git',gitArguments(args),{cwd:f.source,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }
  const declarations=new Map([
    ['private.ts',{imports:[],assets:[{kind:'fixture' as const,path:'./child.ts',dataNamespaces:{data:'private fixture'}}]}],
    ['child.ts',{imports:['./data/tool.ts'],assets:[{kind:'data' as const,path:'./data/'}]}],
  ]);
  for(const entries of [['private.ts','production.ts'],['production.ts','private.ts']]){
    const graph=moduleGraph({sourceRoot:f.source,nodeMajor:26,declarations});
    try{
      const value=graph.describe(entries),rows=value.observations.filter(row=>row.reader==='child.ts'&&row.observation.kind==='realpath');
      assert.deepEqual(rows.map(row=>row.context.entry).sort(),['<entry>','child.ts']);
      assert.ok(rows.some(row=>row.context.dataNamespaces.data==='private fixture'));
      assert.ok(value.files.includes('data/value.txt'),'the later production reader retains real data');
    }finally{graph.close();}
  }
});

test('Node facts retain logical and physical scopes while strict staging refuses an aliased ancestor',t=>{
  const f=fixture(t);f.write('physical/main.ts','export {};');f.write('physical/package.json','{"type":"module"}');
  symlinkSync(join(f.source,'physical'),join(f.source,'alias'));
  const value=snapshot(f.source,['alias/main.ts'],true);
  for(const name of ['alias/package.json','physical/package.json'])
    assert.ok(value.observations.some(row=>row.protocol==='node26'&&row.observation.path===join(f.source,name)));
  assert.ok(value.observations.some(row=>row.observation.kind==='realpath'&&row.observation.path===join(f.source,'alias/main.ts')&&row.observation.value===join(f.source,'physical/main.ts')));
  assert.throws(()=>copyModuleClosure(['alias/main.ts'],f.destination,{sourceRoot:f.source,nodeMajor:26}),/reader observation ancestor is not an owned directory: .*alias/);
  assert.throws(()=>moduleGraph({sourceRoot:f.source,nodeMajor:99 as 26}),/unsupported host module Node recipe: 99/);
});
