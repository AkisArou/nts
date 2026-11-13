import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,writeFileSync,statSync,symlinkSync,utimesSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {OracleFilesystem,validateHostObservations} from '../differential/oracle-filesystem.ts';
import {projectInputs} from './project-inputs.ts';
import {testScratch} from './test-scratch.ts';

test('project discovery retains failed probes, inherited bytes and parser enumerations as distinct facts',t=>{
  const root=testScratch(t,'project-input-facts');
  const write=(path:string,value:string)=>writeFileSync(join(root,path),value);
  mkdirSync(join(root,'src'));mkdirSync(join(root,'reference'));
  write('base.json','{"compilerOptions":{"strict":true}}');
  write('tsconfig.json','{"extends":"./base.json","include":["src/**/*.ts"],"references":[{"path":"./reference"}]}');
  write('src/main.ts','export const value=1;');write('reference/tsconfig.json','{"files":["ref.ts"]}');write('reference/ref.ts','export {};');
  const result=projectInputs([{kind:'entry',path:'src/main.ts'}],root);
  assert.deepEqual(result.configs.sort(),['base.json','reference/tsconfig.json','tsconfig.json']);
  assert.deepEqual(result.roots.sort(),['reference/ref.ts','src/main.ts']);
  assert.ok(result.observations.some(row=>row.kind==='fileExists'&&row.path===join(root,'src/tsconfig.json')&&row.value===false));
  assert.ok(result.observations.some(row=>row.kind==='file'&&row.path===join(root,'base.json')&&typeof row.value==='string'));
  assert.ok(result.observations.some(row=>row.kind==='entries'&&row.path===join(root,'src')));
  assert.ok(result.observations.some(row=>row.kind==='runtimeKind'&&row.path===join(root,'reference')&&row.value==='directory'));
  validateHostObservations(result.observations);
  write('src/tsconfig.json','{"files":["main.ts"]}');
  assert.throws(()=>validateHostObservations(result.observations.filter(row=>row.kind==='fileExists'&&row.path===join(root,'src/tsconfig.json'))),/fileExists changed: .*src\/tsconfig.json/);
  assert.throws(()=>validateHostObservations(result.observations.filter(row=>row.kind==='entries'&&row.path===join(root,'src'))),/entries changed: .*src/);
  const changed=projectInputs([{kind:'entry',path:'src/main.ts'}],root);
  assert.deepEqual(changed.configs,['src/tsconfig.json']);
});

test('captured SDK stat preserves real fields and absence without granting file bytes',t=>{
  const root=testScratch(t,'project-stat-facts'),path=join(root,'value.txt'),missing=join(root,'missing.txt'),link=join(root,'link');
  writeFileSync(path,'value');
  symlinkSync(path,link);
  const fs=new OracleFilesystem();
  for(const candidate of [root,path,link,missing,join(path,'not-a-directory')]){
    let expected:ReturnType<typeof statSync>|undefined;
    try{expected=statSync(candidate);}catch(error){assert.ok(['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''));}
    const actual=fs.stat(candidate);
    if(!expected){assert.equal(actual,undefined);continue;}
    assert.ok(actual);assert.equal(actual.mode,expected.mode);assert.equal(actual.size,expected.size);assert.equal(actual.mtime.getTime(),expected.mtime.getTime());
  }
  const rows=fs.captured();
  assert.deepEqual(rows.map(row=>row.kind),Array(5).fill('stat'));
  assert.ok(rows.some(row=>row.path===missing&&row.value===null));
  validateHostObservations(rows);
  writeFileSync(path,'a different size');
  for(const candidate of [path,link])
    assert.throws(()=>validateHostObservations(rows.filter(row=>row.path===candidate)),/stat changed:/);
  for(const change of [()=>chmodSync(path,statSync(path).mode^0o100),()=>{
    const current=statSync(path);utimesSync(path,current.atime,new Date(current.mtime.getTime()+1000));
  }]){
    fs.clear();fs.stat(path);const previous=fs.captured();change();
    assert.throws(()=>validateHostObservations(previous),/stat changed: .*value.txt/);
  }
  const cycle=join(root,'cycle');symlinkSync(cycle,cycle);
  assert.throws(()=>fs.stat(cycle),(error:unknown)=>(error as NodeJS.ErrnoException).code==='ELOOP');
  for(const value of [{mode:2**32,size:0,mtimeMs:0},{mode:1,size:0.5,mtimeMs:0},{mode:1,size:2**53,mtimeMs:0},{mode:1,size:0,mtimeMs:8_640_000_000_000_001}])
    assert.throws(()=>validateHostObservations([{kind:'stat',path,value}]),/invalid oracle filesystem stat observation/);
});

test('captured project callbacks match the prior OS parser for symlink includes and cycles',t=>{
  const root=testScratch(t,'project-link-parity');
  mkdirSync(join(root,'src'));mkdirSync(join(root,'shared'));
  writeFileSync(join(root,'tsconfig.json'),'{"include":["src/**/*.ts"]}');
  writeFileSync(join(root,'src/main.ts'),'export {};');writeFileSync(join(root,'shared/helper.ts'),'export {};');
  symlinkSync(join(root,'src/main.ts'),join(root,'src/alias.ts'));
  symlinkSync(join(root,'shared'),join(root,'src/shared'));
  symlinkSync(join(root,'src'),join(root,'src/cycle'));
  const require=createRequire(import.meta.url),{API}=require('typescript/sync') as typeof import('typescript/sync');
  const {serverFS}=require('typescript/fs') as typeof import('typescript/fs');
  const api=new API({cwd:root,fs:{readFile:serverFS.useOS,fileExists:serverFS.useOS,directoryExists:serverFS.useOS,
    getAccessibleEntries:serverFS.useOS,realpath:serverFS.useOS,stat:serverFS.useOS,writeFile:serverFS.error,removeFile:serverFS.error}});
  let expected:string[];
  try{const parsed=api.parseConfigFile(join(root,'tsconfig.json'));assert.deepEqual(parsed.errors,[]);expected=parsed.fileNames.slice().sort();}
  finally{api.close();}
  const actual=projectInputs([{kind:'config',path:'tsconfig.json'}],root);
  assert.deepEqual(actual.roots.map(path=>join(root,path)).sort(),expected);
});
