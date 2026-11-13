import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,writeFileSync,statSync,symlinkSync,utimesSync} from 'node:fs';
import {join} from 'node:path';
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
  assert.throws(()=>validateHostObservations(result.observations),/fileExists changed: .*src\/tsconfig.json/);
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
  assert.throws(()=>validateHostObservations(rows),/stat changed: .*value.txt/);
  for(const change of [()=>chmodSync(path,statSync(path).mode^0o100),()=>{
    const current=statSync(path);utimesSync(path,current.atime,new Date(current.mtime.getTime()+1000));
  }]){
    fs.clear();fs.stat(path);const previous=fs.captured();change();
    assert.throws(()=>validateHostObservations(previous),/stat changed: .*value.txt/);
  }
  const cycle=join(root,'cycle');symlinkSync(cycle,cycle);
  assert.throws(()=>fs.stat(cycle),(error:unknown)=>(error as NodeJS.ErrnoException).code==='ELOOP');
});
