import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {moduleGraph} from './module-closure.ts';
import {rustRuntimeInputGraph} from './rust-runtime-inputs.ts';
import {bindRustRuntimeDeclarations,type RustRuntimeManifest,type RustRuntimeTarget} from './rust-runtime-declarations.ts';
import {pathToFileURL} from 'node:url';
import {projectCatalogue,projectMembers,projectChoice} from './reader-inputs/main.ts';
import {readerObservationIndex} from './reader-observations.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {rustBuildModules} from './rust-modules.ts';
import {membershipIndex} from './reader-metadata.ts';
import {testScratch} from './test-scratch.ts';

test('runtime and selector snapshots use the same graph and shared project/file/host roles',t=>{
  const root=testScratch(t,'rust-runtime-input-graph');mkdirSync(join(root,'crate'));mkdirSync(join(root,'project'));
  writeFileSync(join(root,'crate/lib.rs'),'// Rust source is declared by Cargo, never parsed as TypeScript\n');
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  writeFileSync(join(root,'tool.ts'),'export {};');writeFileSync(join(root,'data.txt'),'immutable');
  writeFileSync(join(root,'project/main.ts'),'export const value=1;');
  writeFileSync(join(root,'project/tsconfig.json'),'{"files":["main.ts"]}');
  const target:RustRuntimeTarget={source:'crate/lib.rs',name:'crate',kind:['lib'],unitTests:false,doctests:true};
  const manifest:RustRuntimeManifest={version:1,targets:[{target,declarations:{imports:['../tool.ts'],assets:[
    {kind:'file',path:'../data.txt'},{kind:'project-config',path:'../project/tsconfig.json'},
  ]}}]};
  const owner=rustRuntimeInputGraph({sourceRoot:root,manifest,inventory:[target],linkage:{packages:[{directory:'',name:'supplied',targets:[target],dependencies:[]}]},nodeMajor:26});
  const direct=moduleGraph({sourceRoot:root,declarations:bindRustRuntimeDeclarations(manifest,[target]),nodeMajor:26});
  try{
    const first=owner.describe(target.source);assert.deepEqual(first.snapshot,direct.describe([target.source],undefined,undefined,rustBuildModules(root,target.source,path=>bindRustRuntimeDeclarations(manifest,[target]).has(path))));
    assert.equal(first.target.unitTests,false);assert.equal(first.target.doctests,true);
    assert.ok(first.snapshot.hostFiles.includes('tool.ts'));assert.ok(!first.snapshot.hostFiles.includes('project/main.ts'));
    assert.ok(first.snapshot.ownedFiles.includes('data.txt'));assert.ok(first.snapshot.placingFiles.includes('project/tsconfig.json'));
    first.target.kind.push('mutated');first.snapshot.files.push('mutated');
    const repeated=owner.describe(target.source);assert.deepEqual(repeated.target.kind,['lib']);assert.ok(!repeated.snapshot.files.includes('mutated'));
    writeFileSync(join(root,'crate/package.json'),'{"type":"commonjs"}');
    // A Rust root is not a Node module. The entered tool's scopes remain the
    // same; project discovery still captures fresh facts in each describe.
    assert.ok(owner.describe(target.source).snapshot.observations.every(row=>row.protocol!=='node26'||row.reader==='tool.ts'));
    assert.throws(()=>owner.describe('missing.rs'),/no Cargo owner/);
  }finally{owner.close();direct.close();}
  assert.throws(()=>rustRuntimeInputGraph({sourceRoot:root,manifest:{version:1,targets:[]},inventory:[target],linkage:{packages:[{directory:'',name:'supplied',targets:[target],dependencies:[]}]},}),/lacks runtime declarations/);
});

test('shared readers require a real traversed Cargo owner and every traversed Rust reader has a row',t=>{
  const root=testScratch(t,'rust-runtime-reader-ownership');mkdirSync(join(root,'crate'));
  for(const file of ['lib.rs','case.rs','other.rs','bytes.rs'])writeFileSync(join(root,'crate',file),'// supplied Rust reader\n');
  writeFileSync(join(root,'input.txt'),'immutable input');
  writeFileSync(join(root,'crate/lib.rs'),'mod case;');
  const target:RustRuntimeTarget={source:'crate/lib.rs',name:'crate',kind:['lib'],unitTests:true,doctests:false};
  const manifest:RustRuntimeManifest={version:1,targets:[{target,declarations:{imports:[],assets:[{kind:'file',path:'./bytes.rs'}]}}],
    readers:[{source:'crate/case.rs',declarations:{imports:[],assets:[{kind:'file',path:'../input.txt'}]}},{source:'crate/other.rs',declarations:{imports:[],assets:[]}}]};
  const owner=rustRuntimeInputGraph({sourceRoot:root,manifest,inventory:[target],linkage:{packages:[{directory:'',name:'supplied',targets:[target],dependencies:[]}]},});
  try{
    assert.throws(()=>owner.assertComplete(),/Cargo target was not described/);
    const value=owner.describe(target.source);
    assert.ok(value.snapshot.files.includes('input.txt'));assert.ok(!value.snapshot.runtimeFiles!.includes('crate/case.rs'));assert.ok(value.snapshot.runtimeFiles!.includes('crate/bytes.rs'));assert.ok(value.snapshot.ownedFiles.includes('crate/bytes.rs'));
    assert.ok(!value.snapshot.moduleFiles.includes('crate/bytes.rs'),'fileInput Rust bytes are leaves');
    assert.throws(()=>owner.assertComplete(),/shared reader has no traversed Cargo owner: crate\/other.rs/);
  }finally{owner.close();}
  manifest.readers!.pop();
  const complete=rustRuntimeInputGraph({sourceRoot:root,manifest,inventory:[target],linkage:{packages:[{directory:'',name:'supplied',targets:[target],dependencies:[]}]},});
  try{complete.describe(target.source);assert.doesNotThrow(()=>complete.assertComplete());}finally{complete.close();}
  manifest.readers=[];
  const missing=rustRuntimeInputGraph({sourceRoot:root,manifest,inventory:[target],linkage:{packages:[{directory:'',name:'supplied',targets:[target],dependencies:[]}]},});
  try{assert.throws(()=>missing.describe(target.source),/traversed Rust reader has no declaration: crate\/case.rs/);}finally{missing.close();}
});


test('project catalogues and shallow enumerators share fresh compiled snapshots with staging',t=>{
  const root=testScratch(t,'runtime-project-collections');mkdirSync(join(root,'projects'));
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  const add=(name:string)=>{mkdirSync(join(root,'projects',name));writeFileSync(join(root,'projects',name,'main.ts'),'export const value=1;');
    writeFileSync(join(root,'projects',name,'tsconfig.json'),'{"compilerOptions":{"types":[]},"files":["main.ts"]}');};
  add('chosen-one');add('other');
  const catalogue=join(root,'projects.tsv');writeFileSync(catalogue,'# header\nchosen-one\tcontrol\tsubject\tlowers\tNTS1\n');
  const graph=moduleGraph({sourceRoot:root,nodeMajor:26}),catalogueEntry=projectCatalogue(pathToFileURL(catalogue),'./projects/'),membersEntry=projectMembers(pathToFileURL(join(root,'projects/')),'chosen-');
  try{
    const first=graph.describe([catalogueEntry]),members=graph.describe([membersEntry]);
    for(const snapshot of [first,members]){
      assert.ok(snapshot.moduleFiles.includes('projects/chosen-one/main.ts'));
      assert.ok(!snapshot.files.includes('projects/other/main.ts'));assert.deepEqual(snapshot.hostFiles,[]);
    }
    assert.ok(first.ownedFiles.includes('projects.tsv'));assert.equal(first.memberships.length,0);
    assert.equal(members.memberships.length,1);assert.equal(members.directories.length,0);
    const index=membershipIndex(members.files);
    assert.ok(index.affected(members.memberships[0]!,[{path:'projects/chosen-two/main.ts',added:true}]));
    assert.ok(!index.affected(members.memberships[0]!,[{path:'projects/other/main.ts',sameMode:true}]));
    const destination=testScratch(t,'runtime-project-collection-copy');
    assert.deepEqual(copyModuleClosure([catalogueEntry],destination,{sourceRoot:root}),first.files);
    assert.equal(readFileSync(join(destination,'projects/chosen-one/main.ts'),'utf8'),'export const value=1;');
    add('chosen-two');writeFileSync(catalogue,'chosen-two\tcontrol\tsubject\tlowers\tNTS1\n');
    const changed=graph.describe([catalogueEntry]);assert.ok(changed.files.includes('projects/chosen-two/main.ts'));
    assert.ok(!changed.files.includes('projects/chosen-one/main.ts'));
    assert.ok(graph.describe([membersEntry]).files.includes('projects/chosen-two/main.ts'));
    writeFileSync(catalogue,'../escape\tcontrol\tsubject\tlowers\tNTS1\n');
    assert.throws(()=>graph.describe([catalogueEntry]),/literal basename/);
    writeFileSync(catalogue,'wrong\tcolumns\n');assert.throws(()=>graph.describe([catalogueEntry]),/five columns/);
  }finally{graph.close();}
});


test('ordered project choices retain checked absence and switch to a newly present earlier project',t=>{
  const root=testScratch(t,'runtime-project-choices');writeFileSync(join(root,'package.json'),'{"type":"module"}');
  const add=(directory:string)=>{mkdirSync(join(root,directory));writeFileSync(join(root,directory,'main.ts'),'export const value=1;');
    writeFileSync(join(root,directory,'tsconfig.json'),'{"compilerOptions":{"types":[]},"files":["main.ts"]}');};
  add('fallback');
  const entry=projectChoice(pathToFileURL(join(root,'primary/tsconfig.json')),['..//fallback/tsconfig.json','../unvisited/tsconfig.json']);
  const graph=moduleGraph({sourceRoot:root});
  try{
    const snapshot=graph.describe([entry]);assert.ok(snapshot.files.includes('fallback/main.ts'));assert.ok(!snapshot.files.includes('primary/main.ts'));
    assert.deepEqual(snapshot.optionalFiles.map(row=>[row.path,row.present]),[['primary/tsconfig.json',false],['fallback/tsconfig.json',true]]);
    assert.deepEqual(snapshot.hostFiles,[]);
    const destination=testScratch(t,'runtime-project-choice-copy');assert.deepEqual(copyModuleClosure([entry],destination,{sourceRoot:root}),snapshot.files);
    add('primary');const preferred=graph.describe([entry]);assert.ok(preferred.files.includes('primary/main.ts'));
    assert.ok(!preferred.files.includes('fallback/main.ts'));assert.deepEqual(preferred.optionalFiles.map(row=>row.path),['primary/tsconfig.json']);
    assert.throws(()=>graph.describe([projectChoice(entry.url,['../../../outside.json'])]),/escapes source root/);
    assert.throws(()=>graph.describe([projectChoice(pathToFileURL(join(root,'absent.json')),[])]),/no present config/);
    assert.throws(()=>projectChoice(entry.url,['file:///outside.json']),/literal relative/);
  }finally{graph.close();}
});


test('optional project members preserve shallow enumeration and actual ENOTDIR candidate answers',t=>{
  const root=testScratch(t,'runtime-optional-project-members');writeFileSync(join(root,'package.json'),'{}');
  mkdirSync(join(root,'projects'));mkdirSync(join(root,'projects','empty'));
  writeFileSync(join(root,'projects','ordinary.txt'),'metadata-only ancestor');
  const add=(name:string)=>{mkdirSync(join(root,'projects',name),{recursive:true});writeFileSync(join(root,'projects',name,'main.ts'),'export const value=1;');
    writeFileSync(join(root,'projects',name,'tsconfig.json'),'{"compilerOptions":{"types":[]},"files":["main.ts"]}');};
  add('present');
  const entry=projectMembers(pathToFileURL(join(root,'projects/')),'',{optional:true}),graph=moduleGraph({sourceRoot:root});
  try{
    const snapshot=graph.describe([entry]),negative=snapshot.observations.filter(row=>row.observation.kind==='fileExists'&&row.observation.value===false);
    assert.deepEqual(negative.map(row=>row.observation.path).filter(path=>path.endsWith('/tsconfig.json')).sort(),[join(root,'projects/empty/tsconfig.json'),join(root,'projects/ordinary.txt/tsconfig.json')]);
    assert.equal(snapshot.memberships.length,1);assert.deepEqual(snapshot.hostFiles,[]);
    assert.ok(snapshot.moduleFiles.includes('projects/present/main.ts'));assert.ok(!snapshot.ownedFiles.includes('projects/ordinary.txt'));
    const paths=['projects/ordinary.txt','projects/present/main.ts','projects/present/tsconfig.json'],index=readerObservationIndex(root,snapshot.observations,paths);
    assert.equal(index.affected([{path:'projects/ordinary.txt',sameMode:true}]).size,0,'ordinary-file bytes cannot alter ENOTDIR');
    assert.ok(index.affected([{path:'projects/empty/tsconfig.json',added:true}]).size>0,'a missing config becomes a present project');
    add('empty');assert.ok(graph.describe([entry]).moduleFiles.includes('projects/empty/main.ts'));
    assert.throws(()=>graph.describe([projectMembers(entry.url,'')]),/not a file|missing|ENOENT|ENOTDIR/,'required-member mode still refuses the ordinary child');
  }finally{graph.close();}
});
