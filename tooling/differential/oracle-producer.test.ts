import {testEnvironment} from "../gate/test-environment.ts";
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {basename,dirname,join,normalize,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {test,type TestContext} from 'node:test';
import {copyModuleClosure,moduleClosure} from '../gate/module-closure-fixture.ts';
import {testScratch} from '../gate/test-scratch.ts';
import {spawnTest} from '../gate/test-wait.ts';
import {dependencyCapability} from './oracle-dependencies.ts';

const ENTRY='tooling/differential/oracle-dependencies.ts';
const SOURCE=fileURLToPath(new URL('../..',import.meta.url));
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const expected=(source:string)=>hash(JSON.stringify(moduleClosure([ENTRY],{sourceRoot:source}).map(file=>[file,hash(readFileSync(join(source,file)))])));

function fixture(t:TestContext){
  const scratch=testScratch(t,'oracle-producer'),root=join(scratch,'source');
  copyModuleClosure([ENTRY],root);
  writeFileSync(join(root,'pnpm-lock.yaml'),'private lockfile\n');
  execFileSync('git',['init','--quiet'],{env:testEnvironment(),cwd:root});
  execFileSync('git',['-c','user.name=nts fixture','-c','user.email=fixture@invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','--quiet','--allow-empty','-m','Private producer root'],{env:testEnvironment(),cwd:root});
  return {root,cap:()=>dependencyCapability(root,join(scratch,'tmp','dependencies'))};
}

test('the derived producer retains every previous producer module',()=>{
  // Names from the former 17-path declaration; folders remain source-owned.
  const previous=['oracle-dependencies.ts','oracle-filesystem.ts','oracle-runtime.ts','oracle-resolution.ts','dependency-inputs.ts','package-manager.ts','gate-resource.ts','durable-record.ts','active-command.ts','step-result.ts','canonical-environment.ts','run-temporary.ts','worker-memory.ts','admission.ts','case-costs.ts','tooling-slice.ts'];
  const files=moduleClosure([ENTRY],{sourceRoot:SOURCE}),names=files.map(file=>basename(file));
  assert.deepEqual(previous.filter(name=>!names.includes(name)),[]);
  assert.equal(dependencyCapability(SOURCE,join(SOURCE,'tmp','unused')).producerSha256,expected(SOURCE));
});

test('dependency provisioning loads before installing the parser packages',t=>{
  const f=fixture(t);
  assert.equal(existsSync(join(f.root,'node_modules')),false);
  const result=spawnTest(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(join(f.root,ENTRY)).href)}); console.log('provisioner loaded');`],{cwd:f.root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'provisioner loaded\n');
});

test('the source tree chooses a relocated producer and authenticates its current bytes',t=>{
  const f=fixture(t),before=f.cap();
  assert.equal(before.producerSha256,expected(f.root),'unchanged layout control');
  const files=moduleClosure([ENTRY],{sourceRoot:f.root});
  const old=files.find(file=>basename(file)==='durable-record.ts')!;
  const moved='tooling/relocated/durable-record.ts';mkdirSync(dirname(join(f.root,moved)),{recursive:true});
  renameSync(join(f.root,old),join(f.root,moved));
  // Every import that names the old file is rewritten, from wherever its importer sits.
  for(const file of files){
    if(file===old)continue;
    const path=join(f.root,file),text=readFileSync(path,'utf8');
    const next=text.replace(/(["'])(\.\.?\/[^"']+)\1/g,(whole,quote:string,spec:string)=>{
      if(normalize(join(dirname(file),spec))!==old)return whole;
      const to=relative(dirname(file),moved);
      return quote+(to.startsWith('.')?to:'./'+to)+quote;
    });
    if(next!==text)writeFileSync(path,next);
  }
  assert.equal(existsSync(join(f.root,old)),false,'no caller-layout fallback can find the moved file');
  const relocated=f.cap();
  assert.equal(relocated.producerSha256,expected(f.root));
  assert.notEqual(relocated.producerSha256,before.producerSha256);
  assert.equal(f.cap().producerSha256,relocated.producerSha256);
  writeFileSync(join(f.root,moved),readFileSync(join(f.root,moved),'utf8')+'\n// changed producer bytes\n');
  assert.notEqual(f.cap().producerSha256,relocated.producerSha256,'the moved producer remains authenticated');
});

test('producer membership follows new declarations afresh and refuses missing imports',t=>{
  const f=fixture(t),before=f.cap(),entry=join(f.root,ENTRY),text=readFileSync(entry,'utf8');
  const extra=join(dirname(entry),'new-producer.ts');writeFileSync(extra,'export const version=1;\n');
  assert.equal(f.cap().producerSha256,before.producerSha256,'unreached source is not a producer');
  writeFileSync(entry,text+"\nexport * from './new-producer.ts';\n");
  const after=f.cap();assert.equal(after.producerSha256,expected(f.root));assert.notEqual(after.producerSha256,before.producerSha256);
  writeFileSync(extra,'export const version=2;\n');assert.notEqual(f.cap().producerSha256,after.producerSha256);
  writeFileSync(entry,text+"\nimport './missing-producer.ts';\n");
  assert.throws(f.cap,/missing-producer\.ts/);
});
