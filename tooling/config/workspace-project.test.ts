import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {fixtureEnvironment} from '../gate/test-environment.ts';
import {projectConfig} from '../gate/reader-inputs/main.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {withWorkspaceProject} from './workspace-project.ts';

const SOURCE=fileURLToPath(new URL('../../',import.meta.url)),tsc=join(SOURCE,'node_modules/.bin/tsc');
function fixture(root:string,broken=false){
  const put=(name:string,value:string|object)=>{const file=join(root,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
  put('tests/workspace/tsconfig.solution.json',{files:[],references:[{path:'lib'},{path:'app'}]});
  put('tests/workspace/tsconfig.base.json',{compilerOptions:{target:'ESNext',module:'ESNext',moduleResolution:'bundler',strict:true,allowImportingTsExtensions:true,types:[]}});
  put('tests/workspace/lib/tsconfig.json',{extends:'../tsconfig.base.json',compilerOptions:{composite:true,declaration:true,emitDeclarationOnly:true,outDir:'.types',rootDir:'src'},include:['src']});
  put('tests/workspace/lib/src/index.ts',broken?'import {native} from "c:binding"; export const answer:number="wrong";\n':'export const answer:number=42;\n');
  put('tests/workspace/app/tsconfig.json',{extends:'../tsconfig.base.json',compilerOptions:{composite:true,noEmit:true},references:[{path:'../lib'}],include:['src']});
  put('tests/workspace/app/src/main.ts','import {answer} from "../../lib/src/index.ts"; export const result=answer;\n');
  return projectConfig(pathToFileURL(join(root,'tests/workspace/tsconfig.solution.json')));
}
function snapshot(root:string):[string,string][]{
  const rows:[string,string][]=[];
  const walk=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else rows.push([relative(root,path),readFileSync(path,'utf8')]);}};
  walk(root);return rows.sort(([a],[b])=>a.localeCompare(b));
}

test('a real referenced build writes only in the private project tree',async t=>{
  const own=testScratch(t,'config-workspace'),source=join(own,'repo'),project=fixture(source),before=snapshot(source);
  let temporary='';
  await withWorkspaceProject(project,source,workspace=>{
    temporary=dirname(workspace.root);
    const result=spawnSync(tsc,['-b',relative(dirname(workspace.project),workspace.project),'--force'],{cwd:dirname(workspace.project),env:fixtureEnvironment(t),encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.ok(existsSync(join(workspace.root,'tests/workspace/lib/.types/index.d.ts')),'the real build emitted a declaration');
    assert.ok(existsSync(join(workspace.root,'tests/workspace/app/tsconfig.tsbuildinfo')),'the real build emitted incremental state');
    assert.notEqual(workspace.root,source);
    assert.deepEqual(snapshot(source),before,'a build must not materialize outputs in its source');
  });
  assert.ok(temporary);assert.equal(existsSync(temporary),false,'the build tree is drained before cleanup');
  assert.deepEqual(snapshot(source),before);
});

test('the scratch build preserves actual compiler diagnostics and binding refusals',async t=>{
  const own=testScratch(t,'config-diagnostics'),baseline=join(own,'baseline'),source=join(own,'source');
  const beforeProject=fixture(baseline,true),project=fixture(source,true),before=snapshot(source);
  const build=(path:string)=>{const r=spawnSync(tsc,['-b',relative(dirname(path),path),'--force'],{cwd:dirname(path),env:fixtureEnvironment(t),encoding:'utf8'});return {status:r.status,output:r.stdout+r.stderr};};
  const expected=build(fileURLToPath(beforeProject.url));
  const actual=await withWorkspaceProject(project,source,workspace=>build(workspace.project));
  assert.notEqual(expected.status,0);
  assert.match(expected.output,/error TS2322/);assert.match(expected.output,/Cannot find module 'c:binding'/);
  assert.deepEqual(actual,expected,'the same project produces the same diagnostics in private storage');
  assert.deepEqual(snapshot(source),before);
  rmSync(baseline,{recursive:true,force:true});
});
