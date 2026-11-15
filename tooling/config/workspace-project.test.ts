import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {fileInput,moduleMembers,projectConfig,type InputEntry} from '../gate/reader-inputs/main.ts';
import {gitArguments} from '../gate/git-arguments/main.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {withWorkspaceProject} from './workspace-project.ts';

const SOURCE=fileURLToPath(new URL('../../',import.meta.url)),tsc=join(SOURCE,'node_modules/.bin/tsc');
const OWED=new URL('../gate/owed.mjs',import.meta.url);
function fixture(root:string,broken=false){
  const put=(name:string,value:string|object)=>{const file=join(root,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
  put('tests/workspace/tsconfig.solution.json',{files:[],references:[{path:'lib'},{path:'app'}]});
  put('tests/workspace/tsconfig.base.json',{compilerOptions:{target:'ESNext',module:'ESNext',moduleResolution:'bundler',strict:true,allowImportingTsExtensions:true,types:[]}});
  put('tests/workspace/lib/tsconfig.json',{extends:'../tsconfig.base.json',compilerOptions:{composite:true,declaration:true,emitDeclarationOnly:true,outDir:'.types',rootDir:'src'},include:['src']});
  put('tests/workspace/lib/src/index.ts',broken?'import {native} from "c:binding"; export const answer:number="wrong";\n':'export const answer:number=42;\n');
  put('tests/workspace/app/tsconfig.json',{extends:'../tsconfig.base.json',compilerOptions:{composite:true,noEmit:true},references:[{path:'../lib'}],include:['src']});
  put('tests/workspace/app/src/main.ts','import {answer} from "../../lib/src/index.ts"; export const result=answer;\n');
  put('tests/workspace/app/metadata.txt','a real tracked sibling\n');
  put('support/external.d.ts','declare module "external:types" { export type Value=number; }\n');
  put('.gitignore','*.tsbuildinfo\n.types/\n');
  for(const args of [['init','--quiet'],['add','.']]){
    const result=spawnSync('git',gitArguments(args),{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  }
  const inputs:InputEntry[]=[moduleMembers(pathToFileURL(join(root,'tests/workspace/')),'nts.config.ts',{data:true}),
    {kind:'file',url:fileInput(pathToFileURL(join(root,'support/external.d.ts')))}];
  return {project:projectConfig(pathToFileURL(join(root,'tests/workspace/tsconfig.solution.json')),'compiled-program'),inputs};
}
function snapshot(root:string):[string,string][]{
  const rows:[string,string][]=[];
  const walk=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else rows.push([relative(root,path),readFileSync(path,'utf8')]);}};
  walk(root);return rows.sort(([a],[b])=>a.localeCompare(b));
}

test('a real referenced build writes only in the private project tree',async t=>{
  const own=testScratch(t,'config-workspace'),source=join(own,'repo'),{project,inputs}=fixture(source);
  writeFileSync(join(source,'tests/workspace/lib/src/index.ts'),'/// <reference path="../../../../support/external.d.ts" />\nexport const answer=43;\n');
  writeFileSync(join(source,'tests/workspace/app/tsconfig.tsbuildinfo'),'ignored source build cache\n');
  const before=snapshot(source);
  let temporary='';
  await withWorkspaceProject(project,inputs,source,workspace=>{
    temporary=dirname(workspace.root);
    assert.equal(readFileSync(join(workspace.root,'tests/workspace/app/metadata.txt'),'utf8'),'a real tracked sibling\n');
    assert.equal(existsSync(join(workspace.root,'tests/workspace/app/tsconfig.tsbuildinfo')),false,'ignored source cache is not staged');
    assert.equal(readFileSync(join(workspace.root,'support/external.d.ts'),'utf8'),readFileSync(join(source,'support/external.d.ts'),'utf8'),'declared external bytes retain repository-relative layout');
    const result=spawnSync(tsc,['-b',relative(dirname(workspace.project),workspace.project),'--force'],{cwd:dirname(workspace.project),env:fixtureEnvironment(t),encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.ok(existsSync(join(workspace.root,'tests/workspace/lib/.types/index.d.ts')),'the real build emitted a declaration');
    assert.match(readFileSync(join(workspace.root,'tests/workspace/lib/.types/index.d.ts'),'utf8'),/answer = 43/,'the compiler sees dirty tracked bytes, not the index or HEAD version');
    assert.ok(existsSync(join(workspace.root,'tests/workspace/app/tsconfig.tsbuildinfo')),'the real build emitted incremental state');
    assert.notEqual(workspace.root,source);
    assert.deepEqual(snapshot(source),before,'a build must not materialize outputs in its source');
  });
  assert.ok(temporary);assert.equal(existsSync(temporary),false,'the build tree is drained before cleanup');
  assert.deepEqual(snapshot(source),before);
  await withWorkspaceProject(project,inputs.filter(input=>typeof input==='string'||input.kind!=='file'),source,workspace=>{
    const result=spawnSync(tsc,['-b',relative(dirname(workspace.project),workspace.project),'--force'],{cwd:dirname(workspace.project),env:fixtureEnvironment(t),encoding:'utf8'});
    assert.notEqual(result.status,0,'an undeclared external reference cannot silently read the source tree');
    assert.match(result.stdout+result.stderr,/error TS6053: File .*external\.d\.ts.* not found/);
  });
  assert.deepEqual(snapshot(source),before);
});

test('the scratch build preserves actual compiler diagnostics and binding refusals',async t=>{
  const own=testScratch(t,'config-diagnostics'),baseline=join(own,'baseline'),source=join(own,'source');
  const beforeProject=fixture(baseline,true),{project,inputs}=fixture(source,true),before=snapshot(source);
  const build=(path:string)=>{const r=spawnSync(tsc,['-b',relative(dirname(path),path),'--force'],{cwd:dirname(path),env:fixtureEnvironment(t),encoding:'utf8'});return {status:r.status,output:r.stdout+r.stderr};};
  const expected=build(fileURLToPath(beforeProject.project.url));
  const actual=await withWorkspaceProject(project,inputs,source,workspace=>build(workspace.project));
  assert.notEqual(expected.status,0);
  assert.match(expected.output,/error TS2322/);assert.match(expected.output,/Cannot find module 'c:binding'/);
  assert.deepEqual(actual,expected,'the same project produces the same diagnostics in private storage');
  assert.deepEqual(snapshot(source),before);
  rmSync(baseline,{recursive:true,force:true});
});

test('editing the audit external program inputs owes config through its reader rule',t=>{
  const script=`
import {readFileSync} from 'node:fs';
const {covering,stepInputs,owed}=await import(process.argv[1]);
const rows=['runtime/native/libc.d.ts','runtime/native/scalars.d.ts'].map(path=>{
 const before=readFileSync(path,'utf8'),rules=owed([{path,before,after:before+'\\ndeclare const changedExternalInput: unique symbol;\\n',sameMode:true}]);
 return {path,readers:[...covering(stepInputs(),path)],input:rules.find(row=>row.name==='an input to what a gate step runs')?.steps??[]};
});
process.stdout.write(JSON.stringify(rows));`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script,OWED.href],{cwd:SOURCE,env:fixtureEnvironment(t),encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+result.stderr);
  const current=JSON.parse(result.stdout) as {path:string;readers:string[];input:string[]}[];
  assert.equal(current.length,2);
  for(const row of current){
    assert.ok(row.readers.includes('config'),row.path+' is a declared config input');
    assert.ok(row.input.includes('config'),row.path+' changes the actual reader obligation');
  }
});
