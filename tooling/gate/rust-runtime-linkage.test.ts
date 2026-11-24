import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {testScratch} from './test-scratch.ts';
import {rustRuntimeInputGraph} from './rust-runtime-inputs.ts';
import {rustSelectorRoles} from './rust-selector-roles.ts';
import type {RustRuntimeManifest,RustRuntimeTarget} from './rust-runtime-declarations.ts';
import type {CargoRuntimeLinkage} from './cargo-inputs.ts';

test('dependent targets compose linked library and binary readers in the canonical graph',t=>{
  const root=testScratch(t,'runtime-linked-readers');
  const put=(path:string,body:string)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),body);};
  for(const source of ['app/tests.rs','app/lib.rs','app/main.rs','normal/lib.rs','normal/unit.rs','dev/lib.rs','nested/lib.rs'])put(source,source==='normal/lib.rs'?'#[cfg(test)] mod unit;':'');
  for(const path of ['app/input.txt','app/bin.txt','normal/input.txt','normal/unit.txt','dev/input.txt','nested/input.txt'])put(path,path);
  const target:RustRuntimeTarget={source:'app/tests.rs',name:'integration',kind:['test'],unitTests:true,doctests:false};
  const manifest:RustRuntimeManifest={version:1,targets:[{target,declarations:{imports:[],assets:[]}}],readers:[
    {source:'app/lib.rs',declarations:{imports:[],assets:[{kind:'file',path:'./input.txt'}]}},
    {source:'app/main.rs',declarations:{imports:[],assets:[{kind:'file',path:'./bin.txt'}]}},
    {source:'normal/lib.rs',declarations:{imports:[],assets:[{kind:'file',path:'./input.txt'},{kind:'optional-file',path:'./later.txt'}]}},
    {source:'normal/unit.rs',declarations:{imports:[],assets:[{kind:'file',path:'./unit.txt'}]}},
    {source:'dev/lib.rs',declarations:{imports:[],assets:[{kind:'file',path:'./input.txt'}]}},
    {source:'nested/lib.rs',declarations:{imports:[],assets:[{kind:'file',path:'./input.txt'}]}},
  ]};
  const linkage:CargoRuntimeLinkage={packages:[
    {directory:'app',name:'app',targets:[target,{source:'app/lib.rs',name:'app',kind:['lib']},{source:'app/main.rs',name:'app-bin',kind:['bin']}],dependencies:[{directory:'normal',name:'normal',kind:'normal',rename:'alias'},{directory:'dev',name:'dev',kind:'dev'}]},
    {directory:'normal',name:'normal',targets:[{source:'normal/lib.rs',name:'normal',kind:['lib']}],dependencies:[{directory:'nested',name:'nested',kind:'normal'}]},
    ...['dev','nested'].map(name=>({directory:name,name,targets:[{source:name+'/lib.rs',name,kind:['lib']}],dependencies:[]})),
  ]};
  const owner=rustRuntimeInputGraph({sourceRoot:root,manifest,inventory:[target],linkage});
  try{
    const first=owner.describe(target.source),files=first.snapshot.runtimeFiles!;
    for(const path of ['app/input.txt','app/bin.txt','normal/input.txt','normal/unit.txt','dev/input.txt','nested/input.txt'])assert.ok(files.includes(path),path);
    assert.ok(!files.includes('normal/lib.rs'),'compiled library source is not a runtime byte claim');
    assert.deepEqual(first.snapshot.hostFiles,[]);
    assert.equal(first.composition.readerCount,7);assert.equal(first.composition.structuralPolicy,'including-cfg-test');
    assert.ok(first.composition.roots.some(row=>row.reason==='test-binary'&&row.target.source==='app/main.rs'));
    assert.ok(first.composition.roots.some(row=>row.target.source==='normal/lib.rs'&&row.readerCount===2));
    assert.equal(first.snapshot.optionalFiles.find(row=>row.path==='normal/later.txt')!.present,false);
    put('normal/later.txt','new inherited input');
    const next=owner.describe(target.source);assert.equal(next.snapshot.optionalFiles.find(row=>row.path==='normal/later.txt')!.present,true);
    assert.ok(next.snapshot.runtimeFiles!.includes('normal/later.txt'));owner.assertComplete();
    first.composition.roots[0]!.target.kind.push('mutated');assert.deepEqual(owner.describe(target.source).target.kind,['test']);
  }finally{owner.close();}
  manifest.readers=manifest.readers!.filter(row=>row.source!=='app/lib.rs');
  const missing=rustRuntimeInputGraph({sourceRoot:root,manifest,inventory:[target],linkage});
  try{assert.throws(()=>missing.describe(target.source),/traversed Rust reader has no declaration: app\/lib.rs/);}finally{missing.close();}
});

test('all-target batches preserve composed roles and read changed roots on the next call',t=>{
  const root=testScratch(t,'runtime-linked-batch');
  const put=(path:string,body:string)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),body);};
  const targets=['first','second'].map(name=>({source:'app/'+name+'.rs',name,kind:['test'],unitTests:true,doctests:false}));
  for(const target of targets)put(target.source,'');put('shared/lib.rs','mod child;');put('shared/child.rs','');put('shared/value.txt','old');
  const manifest:RustRuntimeManifest={version:1,targets:targets.map(target=>({target,declarations:{imports:[],assets:[]}})),readers:[
    {source:'shared/lib.rs',declarations:{imports:[],assets:[{kind:'file',path:'./value.txt'},{kind:'optional-file',path:'./later.txt'}]}},
    {source:'shared/child.rs',declarations:{imports:[],assets:[]}},
  ]};
  const linkage:CargoRuntimeLinkage={packages:[
    {directory:'app',name:'app',targets,dependencies:[{directory:'shared',name:'shared',kind:'normal'}]},
    {directory:'shared',name:'shared',targets:[{source:'shared/lib.rs',name:'shared',kind:['lib']}],dependencies:[]},
  ]};
  const separate=rustRuntimeInputGraph({sourceRoot:root,manifest,inventory:targets,linkage});
  let expected;
  try{expected=targets.map(target=>separate.describe(target.source));}finally{separate.close();}
  const owner=rustRuntimeInputGraph({sourceRoot:root,manifest,inventory:targets,linkage});
  try{
    const actual=owner.describeAll();
    assert.equal(actual.length,2);
    for(const [index,row]of actual.entries()){
      assert.deepEqual(row.snapshot,expected[index]!.snapshot);assert.deepEqual(row.byteInputs,expected[index]!.byteInputs);
      assert.deepEqual(row.candidates,expected[index]!.candidates);assert.deepEqual(row.composition,expected[index]!.composition);
      assert.equal(row.composition.readerCount,3);
    }
    const consume=(row:ReturnType<typeof owner.describe>)=>({target:row.target,roles:rustSelectorRoles(root,row.snapshot,row.byteInputs),candidates:row.candidates,composition:row.composition});
    const sources=new Map<string,string>();
    const projected=owner.mapAll(row=>{for(const input of row.sourceInputs)sources.set(input.path,input.sha256);return consume(row);});
    assert.deepEqual(projected,actual.map(consume),'all roles, target provenance, module candidates and composition agree with the full canonical batch');
    const expectedSources=new Map(expected.flatMap(row=>row.sourceInputs.map(input=>[input.path,input.sha256] as const)));
    assert.deepEqual([...sources].sort(),[...expectedSources].sort(),'projection retains every captured source identity');
    owner.assertComplete();
    const source=join(root,'shared/lib.rs'),before=readFileSync(source,'utf8');let staged=0,published=false;
    try{
      assert.throws(()=>{
        owner.mapAll(row=>{if(++staged===1)writeFileSync(source,before+'\n// concurrent source edit\n');return consume(row);});
        published=true;
      },/changed/,'structural source identities are revalidated after the projecting body');
      assert.ok(staged>0);assert.equal(published,false);
    }finally{writeFileSync(source,before);}
    put('shared/later.txt','new');put('shared/lib.rs','mod child; mod added;');put('shared/added.rs','');
    // A genuinely new reader still needs a row: the earlier batch is not a
    // source/result cache which could silently keep the old module graph.
    assert.throws(()=>owner.describeAll(),/traversed Rust reader has no declaration: shared\/added.rs/);
    put('shared/lib.rs','mod child;');
    const next=owner.describeAll();assert.ok(next.every(row=>row.snapshot.optionalFiles[0]!.present));
    actual[0]!.composition.roots[0]!.target.kind.push('mutated');
    assert.deepEqual(next.map(row=>row.target.kind),[['test'],['test']]);
  }finally{owner.close();}
});
