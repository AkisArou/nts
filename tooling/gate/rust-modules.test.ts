import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {rustModuleEdges,rustChildDirectory,rustBuildModules} from './rust-modules.ts';
import {moduleGraph,type ModuleDeclarations} from './module-closure.ts';
import {runtimeRepositoryClaims} from './rust-input-claims.ts';
import {testScratch} from './test-scratch.ts';
import {spawnTest} from './test-wait.ts';
import {fixtureEnvironment} from './test-environment.ts';

test('Rust module edges retain root, normal-file, mod.rs and inline path directories',()=>{
  const source='mod child;mod inline {#[path="other.rs"] mod inner;}';
  assert.deepEqual(rustModuleEdges('src/lib.rs',source,'src'),[
    {name:'child',candidates:['src/child.rs','src/child/mod.rs'],explicitPath:false},
    {name:'inner',candidates:['src/inline/other.rs'],explicitPath:true},
  ]);
  assert.deepEqual(rustModuleEdges('src/outer.rs',source,'src/outer'),[
    {name:'child',candidates:['src/outer/child.rs','src/outer/child/mod.rs'],explicitPath:false},
    {name:'inner',candidates:['src/outer/inline/other.rs'],explicitPath:true},
  ]);
  assert.deepEqual(rustModuleEdges('src/outer.rs','#[path="custom"] mod inline {#[path="other.rs"] mod inner;}','src/outer'),
    [{name:'inner',candidates:['src/custom/other.rs'],explicitPath:true}]);
  assert.equal(rustChildDirectory('src/renamed.rs',true),'src');
  assert.equal(rustChildDirectory('src/outer.rs',false),'src/outer');
  assert.equal(rustChildDirectory('src/outer/mod.rs',false),'src/outer');
  assert.deepEqual(rustModuleEdges('src/lib.rs','const TEXT:&str="mod ignored;";fn example(){let _="mod quoted;";}','src'),[]);
  for(const source of ['macro_rules! generated {()=>{mod hidden;}}','generated!{mod hidden;}','#[path=concat!("a","b")] mod hidden;',
    '#[cfg_attr(feature="other",path="other.rs")] mod hidden;','#[path="link/../hidden.rs"] mod hidden;'])
    assert.throws(()=>rustModuleEdges('src/lib.rs',source,'src'),/Rust module|conditional Rust/);
});

test('native Rust and the shared structural owner agree on module directory contexts',t=>{
  const root=testScratch(t,'rust-module-directories');
  const cases=[
    {name:'root',files:{'entry.rs':'mod child;','child.rs':'pub const VALUE:usize=1;'},expected:['entry.rs','child.rs']},
    {name:'normal',files:{'entry.rs':'mod outer;','outer.rs':'mod child;','outer/child.rs':'pub const VALUE:usize=1;'},expected:['entry.rs','outer.rs','outer/child.rs']},
    {name:'mod-rs',files:{'entry.rs':'mod outer;','outer/mod.rs':'mod child;','outer/child.rs':'pub const VALUE:usize=1;'},expected:['entry.rs','outer/mod.rs','outer/child.rs']},
    {name:'renamed',files:{'entry.rs':'#[path="renamed.rs"] mod logical;','renamed.rs':'mod child;','child.rs':'pub const VALUE:usize=1;'},expected:['entry.rs','renamed.rs','child.rs']},
    {name:'inline',files:{'entry.rs':'mod outer;','outer.rs':'mod inline {#[path="other.rs"] mod inner;}','outer/inline/other.rs':'pub const VALUE:usize=1;'},expected:['entry.rs','outer.rs','outer/inline/other.rs']},
    {name:'inline-override',files:{'entry.rs':'mod outer;','outer.rs':'#[path="custom"] mod inline {#[path="other.rs"] mod inner;}','custom/other.rs':'pub const VALUE:usize=1;'},expected:['entry.rs','outer.rs','custom/other.rs']},
  ];
  for(const arm of cases){
    const directory=join(root,arm.name);mkdirSync(directory);
    for(const [file,source]of Object.entries(arm.files)){const path=join(directory,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,source);}
    const built=spawnTest('rustc',['--edition=2024','--crate-name','module_probe','--crate-type=lib','--emit=dep-info,metadata',join(directory,'entry.rs'),'-o',join(directory,'output.rmeta')],
      {cwd:fileURLToPath(new URL('../..',import.meta.url)),env:fixtureEnvironment(t),encoding:'utf8'},'native Rust module directory contract');
    assert.equal(built.status,0,built.stderr);
    const depinfo=readFileSync(join(directory,'output.d'),'utf8'),inputs=rustBuildModules(directory,'entry.rs',()=>true);
    assert.deepEqual([...inputs.files].sort(),arm.expected.slice().sort(),arm.name);
    for(const file of arm.expected)assert.ok(depinfo.includes(file),file+' in actual rustc dependency output');
  }
});

test('Rust traversal refuses missing reader rows, source escapes and ambiguous modules',t=>{
  const root=testScratch(t,'rust-module-refusals');
  writeFileSync(join(root,'entry.rs'),'mod child;');writeFileSync(join(root,'child.rs'),'');
  assert.throws(()=>rustBuildModules(root,'entry.rs',path=>path==='entry.rs'),/traversed Rust reader has no declaration: child.rs/);
  mkdirSync(join(root,'child'));writeFileSync(join(root,'child/mod.rs'),'');
  assert.throws(()=>rustBuildModules(root,'entry.rs',()=>true),/2 source candidates/);
  writeFileSync(join(root,'entry.rs'),'#[path="../outside.rs"] mod outside;');
  assert.throws(()=>rustBuildModules(root,'entry.rs',()=>true),/escapes source root/);
});

test('Rust discovery retains absent alternatives so a new module makes a projection stale',t=>{
  const root=testScratch(t,'rust-module-candidates');
  writeFileSync(join(root,'entry.rs'),'mod child;');writeFileSync(join(root,'child.rs'),'');
  const first=rustBuildModules(root,'entry.rs',()=>true);
  assert.deepEqual(first.candidates,[
    {reader:'entry.rs',path:'child.rs',present:true},
    {reader:'entry.rs',path:'child/mod.rs',present:false},
  ]);
  mkdirSync(join(root,'child'));writeFileSync(join(root,'child/mod.rs'),'');
  assert.throws(()=>rustBuildModules(root,'entry.rs',()=>true),/2 source candidates/);
  assert.equal(first.candidates[1]!.present,false,'the completed discovery stays detached from the new population');
});


test('build-only sources acquire runtime byte authority only from an independent reader in either order',t=>{
  const root=testScratch(t,'rust-runtime-byte-promotion');
  writeFileSync(join(root,'entry.rs'),'mod child;');writeFileSync(join(root,'child.rs'),'');writeFileSync(join(root,'reader.ts'),'export {};');
  const declarations=new Map<string,ModuleDeclarations>([
    ['entry.rs',{imports:[],assets:[]}],['child.rs',{imports:[],assets:[]}],
    ['reader.ts',{imports:[],assets:[{kind:'file',path:'./child.rs'}]}],
  ]);
  const built=rustBuildModules(root,'entry.rs',path=>declarations.has(path)),graph=moduleGraph({sourceRoot:root,declarations});
  try{
    const compiled=graph.describe(['entry.rs'],undefined,undefined,built);
    assert.deepEqual(compiled.runtimeFiles,[]);assert.deepEqual(compiled.hostFiles,[]);
    assert.equal(runtimeRepositoryClaims(root,compiled).match({kind:'content',following:'follow'},{state:'resolved',path:join(root,'child.rs')}).kind,'uncovered');
    for(const entries of [['entry.rs','reader.ts'],['reader.ts','entry.rs']]){
      const snapshot=graph.describe(entries,undefined,undefined,built);
      assert.ok(snapshot.runtimeFiles!.includes('child.rs'));assert.ok(!snapshot.runtimeFiles!.includes('entry.rs'));
      assert.equal(runtimeRepositoryClaims(root,snapshot).match({kind:'content',following:'follow'},{state:'resolved',path:join(root,'child.rs')}).kind,'claimed');
    }
  }finally{graph.close();}
});
