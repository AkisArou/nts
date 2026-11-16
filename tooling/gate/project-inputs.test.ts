import {gitArguments} from './git-arguments/main.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,writeFileSync,statSync,symlinkSync,utimesSync} from 'node:fs';
import {captureToolchain} from '../differential/oracle-toolchain.ts';
import {join,relative} from 'node:path';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {OracleFilesystem,validateHostObservations} from '../differential/oracle-filesystem.ts';
import {projectInputs,projectInputOwner} from './project-inputs.ts';
import {testScratch} from './test-scratch.ts';
import {moduleGraph,closeModuleGraphOwners} from './module-closure.ts';
import {validateReaderSourceObservations,readerObservationDependency,readerObservationIndex} from './reader-observations.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {projectConfig} from './reader-inputs/main.ts';
import {fileURLToPath,pathToFileURL} from 'node:url';

test('a directory used for matching and ordinary Program type discovery is promoted in both acquisition orders',t=>{
  const root=testScratch(t,'project-directory-promotion');mkdirSync(join(root,'src'));mkdirSync(join(root,'src/ambient'));
  writeFileSync(join(root,'src/main.ts'),'export {};');writeFileSync(join(root,'src/ambient/index.d.ts'),'declare const ambient:number;');
  writeFileSync(join(root,'matching.json'),'{"compilerOptions":{"types":[]},"include":["src/**/*.ts"]}');
  writeFileSync(join(root,'ordinary.json'),'{"compilerOptions":{"typeRoots":["./src"]},"files":["src/main.ts"]}');
  const owner=moduleGraph({sourceRoot:root});
  try{for(const names of [['matching.json','ordinary.json'],['ordinary.json','matching.json']]){
    const entries=names.map(name=>projectConfig(pathToFileURL(join(root,name)),'type-check'));
    const snapshot=owner.describe(entries),rows=snapshot.observations.filter(row=>row.observation.kind==='entries'&&row.observation.path===join(root,'src'));
    assert.ok(rows.some(row=>row.observationOnly),'matching context retains its raw observation role');
    assert.ok(rows.some(row=>!row.observationOnly),'ordinary Program discovery retains selection authority');
    assert.ok(readerObservationIndex(root,rows,snapshot.files).affected([{path:'src/new.md',added:true}]).size>0);
  }}finally{owner.close();}
});

test('declared real Programs retain ancestor package absences as host provenance without repository reach',()=>{
  const root=fileURLToPath(new URL('../..',import.meta.url)),owner=moduleGraph({sourceRoot:root});
  try{
    for(const path of ['tests/workspace/apps/node/tsconfig.json','tests/workspace/tsconfig.solution.json','runtime/react/packages/react-reconciler/tsconfig.json']){
      const result=owner.describe([projectConfig(pathToFileURL(join(root,path)),'compiled-program')]);
      const host=result.observations.filter(row=>row.environment);
      assert.ok(host.length>0,path);
      const hostSnapshot={...result,observations:host};validateReaderSourceObservations(hostSnapshot,root);
      assert.ok(host.every(row=>row.protocol==='project'&&row.environment!.programs.some(program=>program.request.path===path)),path);
      assert.ok(host.some(row=>row.environment!.programs.some(program=>program.imports.some(usage=>path.startsWith('tests/')?usage.specifier==='@nts/scalars':usage.specifier.startsWith('shared/')))),path);
      assert.ok(host.every(row=>readerObservationDependency(root,row)===undefined),'host facts do not enter selector reach');
      const ambient=structuredClone(hostSnapshot);for(const row of ambient.observations)delete row.environment;
      assert.throws(()=>validateReaderSourceObservations(ambient,root),/reader observation needs an external capability/);
    }
  }finally{owner.close();}
});

test('an ancestor package path becoming an ordinary file invalidates an otherwise unchanged negative directory answer',t=>{
  const own=testScratch(t,'project-host-absence'),root=join(own,'source'),external=join(own,'node_modules');mkdirSync(root);
  writeFileSync(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{module:'preserve',moduleResolution:'bundler',types:[]},files:['main.ts']}));
  writeFileSync(join(root,'main.ts'),"import 'missing-project-host-package';");
  const owner=moduleGraph({sourceRoot:root});
  try{
    const snapshot=owner.describe([projectConfig(pathToFileURL(join(root,'tsconfig.json')),'compiled-program')]);
    assert.ok(snapshot.observations.some(row=>row.environment&&row.observation.path===external&&row.observation.kind==='directoryExists'));
    const hostSnapshot={...snapshot,observations:snapshot.observations.filter(row=>row.environment)};
    validateReaderSourceObservations(hostSnapshot,root);
    writeFileSync(external,'ordinary file');
    assert.throws(()=>validateReaderSourceObservations(hostSnapshot,root),/project host absence is now present/);
    assert.throws(()=>owner.describe([projectConfig(pathToFileURL(join(root,'tsconfig.json')),'compiled-program')]),/declared project external package path is present/);
  }finally{owner.close();}
});

test('declared configs retain failed probes, inherited bytes and parser enumerations as distinct facts',t=>{
  const root=testScratch(t,'project-input-facts');
  const write=(path:string,value:string)=>writeFileSync(join(root,path),value);
  mkdirSync(join(root,'src'));mkdirSync(join(root,'reference'));
  write('base.json','{"compilerOptions":{"strict":true,"module":"preserve","moduleResolution":"bundler","types":[]}}');
  write('tsconfig.json','{"extends":"./base.json","include":["src/**/*.ts"],"references":[{"path":"./reference"}]}');
  write('src/main.ts',"import './missing.js';export const value=1;");write('reference/tsconfig.json','{"compilerOptions":{"types":[]},"files":["ref.ts"]}');write('reference/ref.ts','export {};');
  const result=projectInputs([{kind:'config',path:'tsconfig.json'}],root);
  assert.deepEqual(result.configs.sort(),['base.json','reference/tsconfig.json','tsconfig.json']);
  assert.deepEqual(result.roots.sort(),['reference/ref.ts','src/main.ts']);
  assert.ok(result.observations.some(row=>row.kind==='fileExists'&&row.path===join(root,'src/missing.ts')&&row.value===false));
  assert.ok(result.observations.some(row=>row.kind==='file'&&row.path===join(root,'base.json')&&typeof row.value==='string'));
  assert.ok(result.observations.some(row=>row.kind==='entries'&&row.path===join(root,'src')));
  assert.ok(result.observations.some(row=>row.kind==='runtimeKind'&&row.path===join(root,'reference')&&row.value==='directory'));
  validateHostObservations(result.observations);
  write('src/missing.ts','export {};');
  assert.throws(()=>validateHostObservations(result.observations.filter(row=>row.kind==='fileExists'&&row.path===join(root,'src/missing.ts'))),/fileExists changed: .*src\/missing.ts/);
  assert.throws(()=>validateHostObservations(result.observations.filter(row=>row.kind==='entries'&&row.path===join(root,'src'))),/entries changed: .*src/);
  const changed=projectInputs([{kind:'config',path:'tsconfig.json'}],root);
  assert.ok(changed.modules.some(row=>row.path==='src/missing.ts'));
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

test('compiled project imports use the pinned resolver rather than literal host filenames',t=>{
  const root=testScratch(t,'project-resolved-imports');mkdirSync(join(root,'src'));mkdirSync(join(root,'outside'));
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  writeFileSync(join(root,'tsconfig.json'),'{"compilerOptions":{"module":"esnext","moduleResolution":"bundler","types":[]},"files":["src/main.ts"]}');
  writeFileSync(join(root,'src/main.ts'),"export {value} from './provider.js';\n");
  writeFileSync(join(root,'src/provider.ts'),"export {value} from '../outside/value';\n");
  writeFileSync(join(root,'outside/value.ts'),'export const value=1;');
  const actual=projectInputs([{kind:'config',path:'tsconfig.json'}],root);
  assert.deepEqual(actual.modules.find(row=>row.path==='src/main.ts')?.imports,['src/provider.ts']);
  assert.deepEqual(actual.modules.find(row=>row.path==='src/provider.ts')?.imports,['outside/value.ts']);
  assert.ok(actual.observations.some(row=>row.kind==='file'&&row.path===join(root,'outside/value.ts')));
  {
    const entry=projectConfig(pathToFileURL(join(root,'tsconfig.json')),'compiled-program');
    const graph=moduleGraph({sourceRoot:root,nodeMajor:26});
    try{
      const snapshot=graph.describe([entry]);
      assert.ok(snapshot.moduleFiles.includes('src/provider.ts'));assert.ok(snapshot.moduleFiles.includes('outside/value.ts'));
      assert.deepEqual(snapshot.hostFiles,[]);assert.ok(snapshot.observations.every(row=>row.protocol==='project'));
    }finally{graph.close();}
  }
});

test('different compiler projects retain both resolutions and host promotion in either order',t=>{
  const root=testScratch(t,'project-resolution-contexts');
  writeFileSync(join(root,'package.json'),'{"type":"module"}');writeFileSync(join(root,'main.ts'),"export {value} from '@value';");
  for(const name of ['first','second']){
    writeFileSync(join(root,name+'.ts'),'export const value=1;');
    writeFileSync(join(root,name+'.json'),JSON.stringify({compilerOptions:{module:'esnext',moduleResolution:'bundler',types:[],paths:{'@value':['./'+name+'.ts']}},files:['main.ts']}));
  }
  const first=projectConfig(pathToFileURL(join(root,'first.json')),'compiled-program'),second=projectConfig(pathToFileURL(join(root,'second.json')),'compiled-program');
  for(const entries of [[first,second,'main.ts'],['main.ts',second,first],[second,first]]){
    const graph=moduleGraph({sourceRoot:root,nodeMajor:26});
    try{
      const snapshot=graph.describe(entries);
      assert.ok(snapshot.moduleFiles.includes('first.ts'));assert.ok(snapshot.moduleFiles.includes('second.ts'));
      assert.deepEqual(snapshot.hostFiles,entries.includes('main.ts')?['main.ts']:[]);
      assert.ok(snapshot.observations.some(row=>row.observation.kind==='file'&&row.observation.path===join(root,'first.ts')));
      assert.ok(snapshot.observations.some(row=>row.observation.kind==='file'&&row.observation.path===join(root,'second.ts')));
    }finally{graph.close();}
  }
});


test('the pinned Program retains per-usage NodeNext conditions and explicit type modes',t=>{
  const root=testScratch(t,'project-usage-modes');
  const write=(path:string,text:string)=>writeFileSync(join(root,path),text);
  write('package.json',JSON.stringify({name:'dual',type:'module',exports:{'.':{import:'./import.mts',require:'./require.cts'}}}));
  write('import.mts','export const value=1;export type Kind="import";');
  write('require.cts','export const value=2;export type Kind="require";');
  write('mixed.mts',"import {value} from 'dual';import required = require('dual');export const pair=[value,required.value];");
  write('type-require.mts',`import type {Kind} from 'dual' with {'resolution-mode':'require'};export type Value=Kind;`);
  write('type-import.cts',`import type {Kind} from 'dual' with {'resolution-mode':'import'};export type Value=Kind;`);
  write('tsconfig.json',JSON.stringify({compilerOptions:{module:'nodenext',moduleResolution:'nodenext',types:[]},files:['mixed.mts','type-require.mts','type-import.cts']}));
  const result=projectInputs([{kind:'config',path:'tsconfig.json'}],root),edges=new Map(result.modules.map(row=>[row.path,row.imports]));
  assert.deepEqual(edges.get('mixed.mts')?.slice().sort(),['import.mts','require.cts']);
  assert.deepEqual(edges.get('type-require.mts'),['require.cts']);
  assert.deepEqual(edges.get('type-import.cts'),['import.mts']);
  assert.ok(result.installedObservations.some(row=>row.observation.kind==='file'&&row.capability.kind==='typescript-sdk'));
  assert.ok(result.modules.every(row=>!row.path.includes('node_modules')));
  const destination=testScratch(t,'project-usage-copy');
  const staged=copyModuleClosure([projectConfig(pathToFileURL(join(root,'tsconfig.json')),'compiled-program')],destination,{sourceRoot:root});
  assert.ok(staged.includes('import.mts'));assert.ok(staged.includes('require.cts'));
  assert.ok(staged.every(path=>!path.includes('node_modules')));
});

test('allowJs uses each actual package goal for import and require conditions',t=>{
  const root=testScratch(t,'project-allowjs-goals');
  for(const goal of ['module','commonjs']){
    mkdirSync(join(root,goal));
    const write=(name:string,text:string)=>writeFileSync(join(root,goal,name),text);
    write('package.json',JSON.stringify({name:'dual',type:goal,exports:{'.':{import:'./import.mts',require:'./require.cts'}}}));
    write('import.mts','export const value=1;');write('require.cts','export const value=2;');
    write('entry.js',goal==='module'?"import {value} from 'dual';export {value};":"const value=require('dual');module.exports=value;");
  }
  writeFileSync(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{module:'nodenext',moduleResolution:'nodenext',allowJs:true,types:[]},files:['module/entry.js','commonjs/entry.js']}));
  const result=projectInputs([{kind:'config',path:'tsconfig.json'}],root),edges=new Map(result.modules.map(row=>[row.path,row.imports]));
  assert.deepEqual(edges.get('module/entry.js'),['module/import.mts']);
  assert.deepEqual(edges.get('commonjs/entry.js'),['commonjs/require.cts']);
});


test('installed SDK facts retain exact authenticated membership and no repository byte role',t=>{
  const root=testScratch(t,'project-installed-facts');
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  writeFileSync(join(root,'entry.ts'),'export {};');writeFileSync(join(root,'tsconfig.json'),'{"files":["entry.ts"],"compilerOptions":{"types":[]}}');
  const graph=moduleGraph({sourceRoot:root});
  try{
    const snapshot=graph.describe([projectConfig(pathToFileURL(join(root,'tsconfig.json')),'compiled-program')]),row=snapshot.observations.find(row=>row.capability&&row.observation.kind==='file');
    assert.ok(row?.capability);assert.equal(readerObservationDependency(root,row),undefined);
    assert.ok(!snapshot.ownedFiles.some(path=>path.includes('node_modules')));
    validateReaderSourceObservations(snapshot,root);
    const changed=structuredClone(snapshot),mutation=changed.observations.find(item=>item.capability)!;
    assert.ok(mutation.capability?.kind==='typescript-sdk');mutation.capability.identity.rootPackageSha256='0'.repeat(64);
    assert.throws(()=>validateReaderSourceObservations(changed,root),/not an authenticated installed SDK fact/);
    const unlisted=structuredClone(snapshot),outside=unlisted.observations.find(item=>item.capability&&item.observation.kind==='file')!;
    outside.observation.path=join(root,'entry.ts');
    assert.throws(()=>validateReaderSourceObservations(unlisted,root),/not an authenticated installed SDK fact/);
  }finally{graph.close();}
});


test('a project package search outside its source retains facts and refuses implicit fixture authority',t=>{
  const root=testScratch(t,'project-unbounded-package-search'),destination=testScratch(t,'project-unbounded-package-destination');
  writeFileSync(join(root,'entry.ts'),'export {};');writeFileSync(join(root,'tsconfig.json'),'{"files":["entry.ts"]}');
  const result=projectInputs([{kind:'config',path:'tsconfig.json'}],root);
  assert.ok(result.observations.some(row=>row.kind==='fileExists'&&!row.path.startsWith(root+'/')));
  assert.throws(()=>copyModuleClosure([projectConfig(pathToFileURL(join(root,'tsconfig.json')),'compiled-program')],destination,{sourceRoot:root}),/needs an external capability/);
});


test('one project API keeps fresh transactions after changed inputs and failures until explicit close',t=>{
  const root=testScratch(t,'project-api-lifetime');
  const write=(name:string,text:string)=>writeFileSync(join(root,name),text);
  write('package.json',JSON.stringify({name:'dual',type:'module',exports:{'.':'./first.ts'}}));
  write('first.ts','export const value=1;');write('second.ts','export const value=2;');
  write('entry.ts',"import {value} from 'dual';export {value};");
  write('tsconfig.json',JSON.stringify({compilerOptions:{module:'nodenext',moduleResolution:'nodenext',types:[]},include:['*.ts']}));
  const require=createRequire(import.meta.url);let captures=0,fail=false;
  const capture=captureToolchain(join(require.resolve('typescript/package.json'),'..'));
  const owner=projectInputOwner(root,()=>{captures++;if(fail)throw Error('supplied toolchain acquisition failure');return capture;});
  assert.equal(captures,0,'the SDK API/capability is lazy');
  try{
    const first=owner.read([{kind:'config',path:'tsconfig.json'}]);
    assert.deepEqual(first.modules.find(row=>row.path==='entry.ts')?.imports,['first.ts']);
    write('package.json',JSON.stringify({name:'dual',type:'module',exports:{'.':'./second.ts'}}));
    write('added.ts','export const added=1;');
    const second=owner.read([{kind:'config',path:'tsconfig.json'}]);
    assert.deepEqual(second.modules.find(row=>row.path==='entry.ts')?.imports,['second.ts']);assert.ok(second.roots.includes('added.ts'));
    assert.ok(!first.roots.includes('added.ts'),'reported primitives remain detached from later transactions');
    for(const value of [first,second])assert.ok(value.installedObservations.some(row=>row.observation.kind==='file'&&row.observation.value!==null),'each fresh Program supplies actual SDK byte observations');
    write('tsconfig.json','{invalid');assert.throws(()=>owner.read([{kind:'config',path:'tsconfig.json'}]),/compiled input cannot be parsed/);
    write('tsconfig.json','{"compilerOptions":{"types":[]},"files":["entry.ts"]}');
    fail=true;assert.throws(()=>owner.read([{kind:'config',path:'tsconfig.json'}]),/supplied toolchain acquisition failure/);
    fail=false;assert.ok(owner.read([{kind:'config',path:'tsconfig.json'}]).roots.includes('entry.ts'),'a failed Program transaction disposes before a new read');
    const changedCapture={...capture,nativeFiles:new Map(capture.nativeFiles)};
    const library=second.installedObservations.find(row=>row.observation.kind==='file'&&row.observation.path.endsWith('/lib.es5.d.ts')&&capture.nativeFiles.has(relative(capture.nativeRoot,row.observation.path)));
    assert.ok(library);changedCapture.nativeFiles.set(relative(capture.nativeRoot,library.observation.path),Buffer.from('changed SDK bytes'));
    const invalid=projectInputOwner(root,()=>changedCapture);
    try{assert.throws(()=>invalid.read([{kind:'config',path:'tsconfig.json'}]),/project input escapes source root/);}finally{invalid.close();}
  }finally{owner.close();}
  owner.close();assert.throws(()=>owner.read([]),/project input owner is closed/);
  const unopened=projectInputOwner(root,()=>{throw Error('closed lazy owner acquired SDK');});unopened.close();assert.throws(()=>unopened.read([]),/closed/);
});

test('a closed canonical graph refuses traversal and closes its lazy project owner',t=>{
  const root=testScratch(t,'closed-project-graph');writeFileSync(join(root,'entry.ts'),'export {};');
  writeFileSync(join(root,'tsconfig.json'),' {"compilerOptions":{"types":[]},"files":["entry.ts"]}');writeFileSync(join(root,'package.json'),'{}');
  const graph=moduleGraph({sourceRoot:root});graph.describe([projectConfig(pathToFileURL(join(root,'tsconfig.json')),'compiled-program')]);graph.close();graph.close();
  assert.throws(()=>graph.describe(['entry.ts']),/module graph is closed/);assert.throws(()=>graph.membershipIndex(),/module graph is closed/);
});


test('graph closure attempts both acquired APIs and retains both named failures',()=>{
  const closed:string[]=[],project=Error('supplied project close failure'),parser=Error('supplied parser close failure');
  assert.throws(()=>closeModuleGraphOwners([
    {name:'project API',close(){closed.push('project');throw project;}},
    undefined,
    {name:'parser API',close(){closed.push('parser');throw parser;}},
  ]),(error:unknown)=>{
    assert.ok(error instanceof AggregateError);assert.deepEqual(error.errors.map(item=>item.cause),[project,parser]);
    assert.match(error.errors[0].message,/project API/);assert.match(error.errors[1].message,/parser API/);return true;
  });
  assert.deepEqual(closed,['project','parser']);assert.doesNotThrow(()=>closeModuleGraphOwners([undefined,undefined]));
});


test('project roles retain Program reads and add runtime assets only for compiled programs in either order',t=>{
  const root=testScratch(t,'project-role-assets');
  mkdirSync(join(root,'tooling/gate/reader-inputs'),{recursive:true});
  writeFileSync(join(root,'tooling/gate/reader-inputs/main.ts'),'export const dataDirectory=(url:URL)=>url;');
  writeFileSync(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{module:'esnext',moduleResolution:'bundler',types:[]},files:['main.ts']}));
  writeFileSync(join(root,'main.ts'),"import {dataDirectory} from './tooling/gate/reader-inputs/main.ts';export const asset=new URL('./generated.bin',import.meta.url);dataDirectory(new URL('./runtime-data/',import.meta.url));");
  const typecheck=projectConfig(pathToFileURL(join(root,'tsconfig.json')),'type-check');
  const executable=projectConfig(pathToFileURL(join(root,'tsconfig.json')),'compiled-program');
  const graph=moduleGraph({sourceRoot:root});
  try{
    const checked=graph.describe([typecheck]);
    assert.ok(checked.files.includes('main.ts'));assert.ok(checked.files.includes('tooling/gate/reader-inputs/main.ts'));
    assert.ok(!checked.files.includes('generated.bin'));
    assert.ok(!checked.directories.some(row=>row.directory==='runtime-data'));
    assert.ok(!checked.observations.some(row=>row.observation.path===join(root,'generated.bin')));
    for(const entries of [[executable],[typecheck,executable],[executable,typecheck]])
      assert.throws(()=>graph.describe(entries),/ENOENT.*generated.bin/);
    writeFileSync(join(root,'generated.bin'),'runtime bytes');
    assert.throws(()=>graph.describe([executable]),/ENOENT.*runtime-data/);
    mkdirSync(join(root,'runtime-data'));writeFileSync(join(root,'runtime-data/value.txt'),'runtime data');
    // dataDirectory populations are tracked: the private repository supplies
    // that population through its own independent Git inventory.
    for(const args of [['init','-q'],['add','.']])execFileSync('git',gitArguments(args),{cwd:root,env:fixtureEnvironment(t)});
    for(const entries of [[typecheck,executable],[executable,typecheck]]){
      const both=graph.describe(entries);
      assert.ok(both.files.includes('generated.bin'));assert.ok(both.files.includes('runtime-data/value.txt'));
    }
  }finally{graph.close();}
});
