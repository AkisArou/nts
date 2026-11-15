import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,readFileSync,rmSync,symlinkSync,utimesSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {test,type TestContext} from 'node:test';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';
import {moduleGraph,type InputSnapshot,type ModuleDeclarations} from './module-closure.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {projectConfig} from './reader-inputs/main.ts';
import {captureReaderObservations,validateReaderSourceObservations,replayFixtureReaderObservations,NonPortableReaderObservation,readerObservationDependency,readerObservationIndex,readerObservationProjection,readerDependencyIndex} from './reader-observations.ts';
import type {ReaderObservation} from './module-closure.ts';
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

test('an exact non-directory negative replays only with its own unchanged regular blocking component',t=>{
  const f=fixture(t),blocker=join(f.source,'blocked'),path=join(blocker,'tsconfig.json');writeFileSync(blocker,'regular blocker');
  const filesystem=new OracleFilesystem();assert.equal(filesystem.fileExists(path),false);
  const facts=captureReaderObservations(f.source,filesystem.captured());
  const base=snapshot(f.source,['src/main.ts']),observations:ReaderObservation[]=facts.map(fact=>({reader:'src/main.ts',protocol:'project',context:{entry:'<entry>',dataNamespaces:{}},...fact}));
  const captured={...base,observations};validateReaderSourceObservations(captured,f.source);
  writeFileSync(blocker,'different bytes still block traversal');validateReaderSourceObservations(captured,f.source);
  const positive=structuredClone(captured);positive.observations.find(row=>row.observation.kind==='fileExists')!.observation.value=true;
  assert.throws(()=>validateReaderSourceObservations(positive,f.source),/ancestor is not an owned directory/);
  for(const change of ['reader','context'] as const){
    const foreign=structuredClone(captured),witness=foreign.observations.find(row=>row.observation.kind==='runtimeKind'&&row.observation.path===blocker)!;
    if(change==='reader')witness.reader='another.ts';else witness.context.entry='another.ts';
    assert.throws(()=>validateReaderSourceObservations(foreign,f.source),/ancestor is not an owned directory/,change+' cannot lend a blocker');
  }
  rmSync(blocker);mkdirSync(blocker);
  assert.throws(()=>validateReaderSourceObservations(captured,f.source),/runtimeKind changed/,'a directory invalidates the captured blocker even while the child stays absent');
  rmSync(blocker,{recursive:true});mkdirSync(join(f.source,'target'));symlinkSync('target',blocker);
  assert.throws(()=>validateReaderSourceObservations(captured,f.source),/ancestor is not an owned directory/,'a link cannot borrow the regular blocker fact');
});

test('explicit Node capture retains nearer package candidates without entering type-only modules',t=>{
  const f=fixture(t),first=snapshot(f.source,['src/main.ts'],true);
  assert.deepEqual(first.hostFiles,['src/helper.ts','src/main.ts']);
  assert.ok(!first.moduleFiles.includes('types.ts'),'erased types belong to the explicit compiler project');
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
  const f=fixture(t),project=projectConfig(pathToFileURL(join(f.source,'tsconfig.json')));
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
  const copied=copyModuleClosure([project],f.destination,{sourceRoot:f.source});
  assert.ok(copied.includes('tsconfig.json'));
});

test('source stat facts validate before copying and retain both non-portable destination values',t=>{
  const f=fixture(t),file=join(f.source,'src/main.ts');
  chmodSync(file,0o751);utimesSync(file,1234,1234);utimesSync(f.source,1234,1234);
  const base=snapshot(f.source,['src/main.ts']),filesystem=new OracleFilesystem();filesystem.stat(file);filesystem.stat(f.source);
  for(const observation of filesystem.captured()){
    const facts:InputSnapshot={...base,observations:[{reader:'src/main.ts',protocol:'project',context:{entry:'<entry>',dataNamespaces:{src:'a prefix is not data ownership'}},observation,causes:[]}]};
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
  const declarations=new Map<string,ModuleDeclarations>([
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

test('nested fixture contexts inherit compiled/type-only roles and promote on a later host visit',t=>{
  const f=fixture(t);f.write('compiled.ts','export type Value=number;');f.write('child.ts','export {};');f.write('grandchild.ts','export {};');
  f.write('entry.ts',"import type {Value} from './compiled.ts';export type Other=Value;");
  f.write('tsconfig.json','{"files":["compiled.ts"]}');
  const declarations=new Map<string,ModuleDeclarations>([
    ['compiled.ts',{imports:[],assets:[{kind:'fixture',path:'./child.ts',dataNamespaces:{}}]}],
    ['child.ts',{imports:[],assets:[{kind:'fixture',path:'./grandchild.ts',dataNamespaces:{}}]}],
  ]);
  const project=projectConfig(pathToFileURL(join(f.source,'tsconfig.json'))),graph=moduleGraph({sourceRoot:f.source,nodeMajor:26,declarations});
  try{
    const compiled=graph.describe([project]);assert.deepEqual(compiled.hostFiles,[]);
    assert.ok(compiled.observations.every(row=>row.protocol!=='node26'));
    const typeOnly=graph.describe(['entry.ts']);assert.deepEqual(typeOnly.hostFiles,['entry.ts']);
    assert.ok(typeOnly.observations.filter(row=>row.protocol==='node26').every(row=>row.reader==='entry.ts'));
    for(const entries of [[project,'compiled.ts'],['compiled.ts',project],['entry.ts','compiled.ts'],['compiled.ts','entry.ts']]){
      const value=graph.describe(entries);
      for(const name of ['compiled.ts','child.ts','grandchild.ts']){
        assert.ok(value.hostFiles.includes(name));
        assert.ok(value.observations.some(row=>row.protocol==='node26'&&row.reader===name));
      }
    }
  }finally{graph.close();}
});

test('typed selection distinguishes bytes, shallow names, existence and real directory stats',()=>{
  const fact=(kind:ReaderObservation['observation']['kind'],path:string,value:ReaderObservation['observation']['value']):ReaderObservation=>({reader:'reader.ts',protocol:'project',context:{entry:'child.ts',dataNamespaces:{data:'not authority for these facts'}},observation:{kind,path:'/source/'+path,value},causes:[]});
  const entries=fact('entries','data',{files:['plain.md'],directories:['nested']}),directory=fact('directoryExists','data/nested',true);
  const optional=fact('fileExists','data/optional.json',false),stat=fact('stat','data',{mode:0o40755,size:4096,mtimeMs:0});
  const bytes=fact('file','data/plain.md','0'.repeat(64)),identity=fact('readlink','data/alias','target');
  const paths=['data/plain.md','data/nested/one.ts','data/nested/two.ts'],index=readerObservationIndex('/source',[entries,directory,optional,stat,bytes,identity],paths);
  assert.equal(readerObservationDependency('/source',stat)?.bytes,false);
  assert.equal(readerObservationDependency('/source',bytes)?.bytes,true);
  assert.equal(readerObservationDependency('/source',fact('file','../outside',null)),undefined);
  assert.equal(index.affected([{path:'data/plain.md',sameMode:true}]).has(entries),false);
  assert.equal(index.affected([{path:'data/plain.md',sameMode:true}]).has(stat),true,'a recreated direct child may change directory stat');
  assert.equal(index.affected([{path:'data/nested/one.ts',sameMode:true}]).has(stat),false);
  assert.equal(index.affected([{path:'data/new.md',added:true}]).has(entries),true);
  assert.equal(index.affected([{path:'data/nested/new.md',added:true}]).has(entries),false);
  const removed=[{path:'data/nested/one.ts',deleted:true},{path:'data/nested/two.ts',deleted:true}];
  assert.equal(index.affected(removed).has(directory),true);assert.equal(index.affected(removed).has(entries),true);
  assert.equal(index.affected([{path:'data/nested/one.ts',deleted:true}]).has(directory),false);
  assert.equal(index.affected([{path:'data/optional.json',added:true}]).has(optional),true);
  assert.equal(index.affected([{path:'data/optional.json/child.ts',added:true}]).has(optional),false,'an absent file becoming a directory remains fileExists false');
  assert.equal(index.affected([{path:'data/alias',sameMode:true}]).has(identity),true);
  assert.equal(index.affected([{path:'data/nested/one.ts',sameMode:true}]).has(identity),false);
  const rename=[{path:'data/plain.md',deleted:true},{path:'data/renamed.md',added:true}];
  assert.equal(index.affected(rename).has(entries),true);
  const after=readerObservationIndex('/source',[directory],['data/plain.md']);
  assert.equal(after.affected(removed).has(directory),true,'both endpoint inventories reconstruct the same disappearance');
});

function captured(root:string,filesystem:OracleFilesystem):ReaderObservation[]{
  return captureReaderObservations(root,filesystem.captured()).map(row=>({...row,reader:'reader.ts',protocol:'project',context:{entry:'<entry>',dataNamespaces:{}}}));
}

test('followed entries retain link type and target presence without child content sensitivity',t=>{
  const f=fixture(t);f.write('data/plain.md','ordinary');f.write('target.md','target');f.write('directory/child.md','child');
  const link=join(f.source,'data/link');symlinkSync('../target.md',link);
  const filesystem=new OracleFilesystem(),runtime=new OracleFilesystem();
  filesystem.getAccessibleEntries(join(f.source,'data'));runtime.runtimeEntries(join(f.source,'data'));
  const rows=captured(f.source,filesystem),paths=['data/plain.md','data/link','target.md','directory/child.md'];
  const index=readerObservationIndex(f.source,rows,paths);
  for(const path of ['data/plain.md','target.md'])assert.equal(index.affected([{path,sameMode:true}]).size,0,path+' bytes do not change followed entries');
  assert.ok(index.affected([{path:'data/link',sameMode:true}]).size>0,'changed link text may change the followed type');
  assert.ok(index.affected([{path:'target.md',deleted:true}]).size>0,'a dangling child disappears from followed entries');
  const physical=readerObservationIndex(f.source,captured(f.source,runtime),paths);
  assert.equal(physical.affected([{path:'data/link',sameMode:true}]).size,0,'raw runtime names do not follow a child link');
  rmSync(link);symlinkSync('../directory',link);
  assert.deepEqual(new OracleFilesystem().getAccessibleEntries(join(f.source,'data')),{files:['plain.md'],directories:['link']});
  assert.throws(()=>validateReaderSourceObservations({...snapshot(f.source,['src/main.ts']),observations:rows},f.source),/filesystem (entries|readlink) changed/);
});

test('followed identities retain every alias and target while file/stat retain physical byte sensitivity',t=>{
  const f=fixture(t);f.write('target.md','target');
  symlinkSync('../relay',join(f.source,'data-alias')); // An unused dangling sibling is not an observation.
  symlinkSync('target.md',join(f.source,'relay'));symlinkSync('../relay',join(f.source,'src/alias'));
  const alias=join(f.source,'src/alias'),filesystem=new OracleFilesystem();filesystem.realpath(alias);filesystem.fileExists(alias);
  const rows=captured(f.source,filesystem),index=readerObservationIndex(f.source,rows,['src/alias','relay','target.md']);
  assert.equal(index.affected([{path:'target.md',sameMode:true}]).size,0,'identity/presence ignore target prose');
  for(const path of ['src/alias','relay'])assert.ok(index.affected([{path,sameMode:true}]).size>0,path+' link text remains an identity input');
  const deleted=[...index.affected([{path:'target.md',deleted:true}]).keys()];
  for(const kind of ['realpath','fileExists'])assert.ok(deleted.some(row=>row.causes.some(cause=>cause.kind===kind&&cause.path===alias)),kind+' retains target deletion provenance');
  const bytes=new OracleFilesystem();bytes.readFile(alias);bytes.stat(alias);
  const byteRows=captured(f.source,bytes);
  for(const kind of ['file','stat'])assert.ok(byteRows.some(row=>row.observation.kind===kind&&row.observation.path===join(f.source,'target.md')&&readerObservationDependency(f.source,row)?.bytes),kind+' retains physical byte sensitivity');
  rmSync(join(f.source,'target.md'));
  for(const observation of filesystem.captured())assert.throws(()=>validateReaderSourceObservations({...snapshot(f.source,['src/main.ts']),observations:rows.filter(row=>row.observation.kind===observation.kind&&row.observation.path===observation.path)},f.source),/filesystem .* changed/);
});

test('missing and non-directory alias components retain negative facts and preserve loop errors',t=>{
  const f=fixture(t);mkdirSync(join(f.source,'data'));symlinkSync('../relay',join(f.source,'data/alias'));symlinkSync('missing/child.md',join(f.source,'relay'));
  const filesystem=new OracleFilesystem();filesystem.fileExists(join(f.source,'data/alias'));
  const rows=captured(f.source,filesystem),index=readerObservationIndex(f.source,rows,['data/alias','relay']);
  assert.ok(rows.some(row=>row.observation.kind==='runtimeKind'&&row.observation.path===join(f.source,'missing')&&row.observation.value===null));
  assert.ok(index.affected([{path:'missing/child.md',added:true}]).size>0,'creating a missing intermediate subtree changes presence');
  f.write('missing','not a directory');
  const blocked=new OracleFilesystem();blocked.fileExists(join(f.source,'data/alias'));
  const blockedRows=captured(f.source,blocked),blockedIndex=readerObservationIndex(f.source,blockedRows,['data/alias','relay','missing']);
  const absentStat:ReaderObservation={reader:'reader.ts',protocol:'project',context:{entry:'<entry>',dataNamespaces:{}},observation:{kind:'stat',path:join(f.source,'missing/child.md'),value:null},causes:[]};
  assert.equal(readerObservationDependency(f.source,absentStat)?.bytes,false);
  assert.equal(readerObservationIndex(f.source,[absentStat],['missing']).affected([{path:'missing',sameMode:true}]).size,0,'a negative stat under an ordinary file has no content dependency');
  assert.equal(blockedIndex.affected([{path:'missing',sameMode:true}]).size,0,'ENOTDIR remains false after a content edit');
  assert.ok(blockedIndex.affected([{path:'missing',deleted:true},{path:'missing/child.md',added:true}]).size>0);
  symlinkSync('cycle-b',join(f.source,'cycle-a'));symlinkSync('cycle-a',join(f.source,'cycle-b'));
  assert.throws(()=>new OracleFilesystem().fileExists(join(f.source,'cycle-a')),{code:'ELOOP'});
  assert.throws(()=>new OracleFilesystem().inputIdentity(join(f.source,'cycle-a'),f.source),/alias cycle/);
});

test('identity walks resolve parent components after following the preceding link',t=>{
  const f=fixture(t);f.write('physical/inner/member.md','member');f.write('physical/target.md','target');
  mkdirSync(join(f.source,'logical'));symlinkSync('../physical/inner',join(f.source,'logical/jump'));
  symlinkSync('logical/jump/../target.md',join(f.source,'alias'));
  const filesystem=new OracleFilesystem();assert.equal(filesystem.readFile(join(f.source,'alias')),'target');
  const rows=captured(f.source,filesystem);
  assert.ok(rows.some(row=>row.observation.kind==='readlink'&&row.observation.path===join(f.source,'logical/jump')));
  assert.ok(rows.some(row=>row.observation.kind==='file'&&row.observation.path===join(f.source,'physical/target.md')));
  assert.ok(!rows.some(row=>row.observation.kind==='file'&&row.observation.path===join(f.source,'logical/target.md')));
});

test('source ownership reuse stays inside a graph while captured answers and fresh graphs remain live',t=>{
  const f=fixture(t);f.write('owned.ts','export {};');f.write('entry.ts',"import './owned.ts';");
  const graph=moduleGraph({sourceRoot:f.source,nodeMajor:26});
  try{
    const first=graph.describe(['entry.ts']);assert.ok(first.moduleFiles.includes('owned.ts'));
    first.ownedFiles.length=0;first.hostFiles.length=0;
    assert.ok(graph.describe(['entry.ts','owned.ts']).ownedFiles.includes('owned.ts'));
    f.write('package.json','{"type":"module","changed":true}');
    const freshAnswer=graph.describe(['entry.ts']);
    assert.notDeepEqual(first.observations.filter(row=>row.observation.kind==='file'),freshAnswer.observations.filter(row=>row.observation.kind==='file'),'actual Node observations are read again');
  }finally{graph.close();}
  const outside=join(dirname(f.source),'outside.ts');writeFileSync(outside,'export {};');
  rmSync(join(f.source,'owned.ts'));symlinkSync(outside,join(f.source,'owned.ts'));
  assert.throws(()=>snapshot(f.source,['entry.ts']),/module is not an owned source file: owned.ts/);
});


test('portable selector dependencies use exactly the live typed-fact decision algorithm',t=>{
  const f=fixture(t);f.write('target.md','target');mkdirSync(join(f.source,'data'));symlinkSync('../target.md',join(f.source,'data/alias'));
  const filesystem=new OracleFilesystem();filesystem.getAccessibleEntries(join(f.source,'data'));filesystem.fileExists(join(f.source,'missing.json'));filesystem.stat(join(f.source,'target.md'));
  const rows=captured(f.source,filesystem),paths=['target.md','data/alias'];
  const projected=rows.map(row=>({reader:row.reader,dependency:readerObservationProjection(f.source,row)}));
  const live=readerObservationIndex(f.source,rows,paths),recorded=readerDependencyIndex(projected,row=>row.dependency,paths);
  for(const changes of [[{path:'target.md',sameMode:true}],[{path:'target.md',deleted:true}],[{path:'data/alias',sameMode:true}],[{path:'missing.json',added:true}]]){
    assert.deepEqual([...live.affected(changes).keys()].map(row=>rows.indexOf(row)),[...recorded.affected(changes).keys()].map(row=>projected.indexOf(row)));
  }
  const dependency=projected.find(row=>row.dependency)?.dependency;assert.ok(dependency);dependency.context.entry='mutated';
  assert.ok(rows.every(row=>row.context.entry==='<entry>'),'reported dependency contexts are detached');
  const supplied={path:'watched.txt',kind:'readlink' as const,bytes:false,directoryStat:false,context:{entry:'entry.ts',dataNamespaces:{}}};
  const indexed=readerDependencyIndex([supplied],row=>row,['watched.txt']);
  supplied.path='elsewhere.txt';supplied.context.entry='changed';
  assert.equal(indexed.affected([{path:'watched.txt',sameMode:true}]).size,1,'index snapshots its decision fields');
});
