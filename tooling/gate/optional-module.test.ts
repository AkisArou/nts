import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,existsSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {moduleGraph} from './module-closure.ts';
import {rustRuntimeInputGraph} from './rust-runtime-inputs.ts';
import type {RustRuntimeTarget} from './rust-runtime-declarations.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {testScratch} from './test-scratch.ts';
import {projectConfig} from './reader-inputs/main.ts';
import {pathToFileURL} from 'node:url';

test('a future optional driver enters a pre-existing helper through its actual host closure',t=>{
  const base=testScratch(t,'optional-host-module'),source=join(base,'source');mkdirSync(source);
  writeFileSync(join(source,'package.json'),'{"type":"module"}');writeFileSync(join(source,'reader.rs'),'');
  writeFileSync(join(source,'helper.mjs'),'export const helper=1;');
  const declarations=new Map([['reader.rs',{imports:[],assets:[{kind:'optional-module' as const,path:'./driver.mjs'}]}]]);
  const target:RustRuntimeTarget={source:'reader.rs',name:'reader',kind:['test'],unitTests:true,doctests:false};
  const describe=()=>{
    const graph=rustRuntimeInputGraph({sourceRoot:source,manifest:{version:1,targets:[{target,declarations:declarations.get('reader.rs')!}]},inventory:[target],linkage:{packages:[{directory:'',name:'supplied',targets:[target],dependencies:[]}]},nodeMajor:26});
    try{const result=graph.describe(target.source);graph.assertComplete();return result.snapshot;}finally{graph.close();}
  };
  const absent=describe();assert.deepEqual(absent.files,['reader.rs']);assert.ok(absent.optionalFiles.some(row=>row.path==='driver.mjs'&&!row.present));
  writeFileSync(join(source,'driver.mjs'),"export {helper} from './helper.mjs';");
  const selected=describe();assert.ok(selected.optionalFiles.some(row=>row.path==='driver.mjs'&&row.present));
  assert.ok(selected.moduleFiles.includes('driver.mjs'));assert.ok(selected.moduleFiles.includes('helper.mjs'));
  assert.ok(selected.hostFiles.includes('driver.mjs'));assert.ok(selected.hostFiles.includes('helper.mjs'));
  assert.ok(selected.placingFiles.includes('helper.mjs'));
  const destination=join(base,'destination');
  assert.ok(copyModuleClosure(['reader.rs'],destination,{sourceRoot:source,declarations,nodeMajor:26}).includes('helper.mjs'));
  assert.equal(existsSync(join(destination,'helper.mjs')),true);
});

test('optional modules preserve compiled-only host roles and later promotion in both entry orders',t=>{
  const source=testScratch(t,'optional-module-promotion');
  writeFileSync(join(source,'package.json'),'{"type":"module"}');
  writeFileSync(join(source,'tsconfig.json'),'{"files":["compiled.ts"]}');
  writeFileSync(join(source,'compiled.ts'),'export type Value=number;');
  writeFileSync(join(source,'driver.mjs'),"export {helper} from './helper.mjs';");writeFileSync(join(source,'helper.mjs'),'export const helper=1;');
  const declarations=new Map([['compiled.ts',{imports:[],assets:[{kind:'optional-module' as const,path:'./driver.mjs'}]}]]);
  const graph=moduleGraph({sourceRoot:source,declarations,nodeMajor:26});
  try{
    const project=projectConfig(pathToFileURL(join(source,'tsconfig.json')));
    const compiled=graph.describe([project]);assert.deepEqual(compiled.hostFiles,[]);assert.ok(compiled.files.includes('helper.mjs'));
    for(const entries of [[project,'driver.mjs'],['driver.mjs',project]]){
      const promoted=graph.describe(entries);assert.ok(promoted.hostFiles.includes('driver.mjs'));assert.ok(promoted.hostFiles.includes('helper.mjs'));
    }
  }finally{graph.close();}
});

test('an optional module retains regular-file and owned-parent refusal',t=>{
  for(const shape of ['directory','link','parent-link'] as const){
    const base=testScratch(t,'optional-module-refusal'),source=join(base,'source');mkdirSync(source);writeFileSync(join(source,'reader.rs'),'');
    const path=shape==='parent-link'?'nested/driver.mjs':'driver.mjs';
    if(shape==='directory')mkdirSync(join(source,path));
    else if(shape==='link'){writeFileSync(join(base,'outside.mjs'),'');symlinkSync(join(base,'outside.mjs'),join(source,path));}
    else{mkdirSync(join(base,'outside'));symlinkSync(join(base,'outside'),join(source,'nested'));}
    const graph=moduleGraph({sourceRoot:source,declarations:new Map([['reader.rs',{imports:[],assets:[{kind:'optional-module',path:'./'+path}]}]])});
    try{assert.throws(()=>graph.describe(['reader.rs']),/not a regular file|ancestor is not an owned directory/);}finally{graph.close();}
  }
});
