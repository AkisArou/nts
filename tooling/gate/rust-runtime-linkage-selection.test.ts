import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {testScratch} from './test-scratch.ts';
import {fixtureEnvironment} from './test-environment.ts';
import {spawnTest} from './test-wait.ts';
import {gitArguments} from './git-arguments/main.ts';
import {withPackageManager} from '../inputs/package-manager.ts';
import {dependencyCache,installDependencies,installationCatalogTrust} from '../inputs/dependency-inputs.ts';

test('final selection retains library, implicit own-library, dev and launched-bin bytes through a real Cargo workspace',async t=>{
  const root=testScratch(t,'rust-linked-final-selection'),env=fixtureEnvironment(t);
  const shared=testScratch(t,'rust-linked-install-store');
  const cache=dependencyCache(shared);
  t.after(()=>rmSync(cache,{recursive:true,force:true}));
  const put=(path:string,body:string)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),body);};
  put('Cargo.toml','[workspace]\nmembers=["app","normal","dev"]\nresolver="3"\n');
  const packageText=(name:string)=>'[package]\nname="'+name+'"\nversion="0.0.0"\nedition="2021"\nautotests=false\n[lib]\npath="lib.rs"\ntest=false\ndoctest=false\n';
  for(const name of ['app','normal','dev']){put(name+'/Cargo.toml',packageText(name));put(name+'/lib.rs','');}
  put('app/Cargo.toml',packageText('app')+'[[bin]]\nname="app-bin"\npath="main.rs"\ntest=false\n[[test]]\nname="integration"\npath="tests/integration.rs"\n[dependencies]\nrenamed_normal={package="normal",path="../normal"}\n[dev-dependencies]\ndev={path="../dev"}\n');
  put('app/main.rs','fn main(){}');put('app/tests/integration.rs','');
  for(const name of ['own','normal','dev','bin','unread'])put('docs/'+name+'.ts','// old\nconstant\n');
  put('tooling/empty.test.ts','');put('tooling/gate/tooling-test-exclusions.json','[]');
  put('tooling/gate/all.sh',`#!/bin/sh
if [ "$1" = --list ]; then printf '%s\\n' tests addons tooling; exit; fi
step "tests" true
step "addons" true
step "tooling" node tooling/empty.test.ts
`);
  put('tooling/gate/run.mjs','if(step.name === "addons" && plan.includes("tests")) e.NTS_ADDON_EMITTED = "output";');
  const target={source:'app/tests/integration.rs',name:'integration',kind:['test']};
  const reader=(source:string,path:string)=>({source,declarations:{imports:[],assets:[{kind:'file',path}]}});
  put('tooling/gate/rust-runtime-inputs.json',JSON.stringify({version:1,targets:[{target,declarations:{imports:[],assets:[]}}],readers:[
    reader('app/lib.rs','../docs/own.ts'),reader('app/main.rs','../docs/bin.ts'),reader('normal/lib.rs','../docs/normal.ts'),reader('dev/lib.rs','../docs/dev.ts'),
  ]}));
  const git=(args:string[])=>{const result=spawnTest('git',gitArguments(args),{cwd:root,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
  const node=(source:string)=>{const result=spawnTest(process.execPath,['--input-type=module','-e',source],{cwd:root,env,encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);return result.stdout;};
  const url=(path:string)=>JSON.stringify(new URL(path,import.meta.url).href);
  put('package.json',JSON.stringify({name:'rust-linked-install-control',private:true,packageManager:'pnpm@10.15.0'}));
  put('pnpm-lock.yaml',"lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n");
  put('.gitignore','node_modules/\n');
  git(['init','-q','-b','main']);git(['add','.']);
  await withPackageManager(root,{},manager=>manager.run(['install','--offline','--lockfile-only','--ignore-scripts']));
  await installDependencies(shared,root);
  const catalog=installationCatalogTrust(shared,root);assert.ok(catalog);
  // Cargo may create a lockfile. Acquire once through its owner, track that
  // result, then start a fresh inventory generation before the actual build.
  node(`import {cargoRuntimeTargets} from ${url('./cargo-inputs.ts')};cargoRuntimeTargets(process.cwd());`);git(['add','.']);
  const prepared=JSON.parse(node(`import {readFileSync,mkdirSync} from 'node:fs';
import {cargoRuntimeTargets,cargoInputPaths} from ${url('./cargo-inputs.ts')};
import {buildRustSelectorMaterial,writeRustSelectorRecord,selectorTrackedFiles} from ${url('./rust-selector-build.ts')};
const root=process.cwd(),inventory=cargoRuntimeTargets(root),composition=[];
const manifest=JSON.parse(readFileSync('tooling/gate/rust-runtime-inputs.json','utf8'));
const material=buildRustSelectorMaterial({sourceRoot:root,manifest,inventory:()=>cargoRuntimeTargets(root),declarations:'tooling/gate/rust-runtime-inputs.json',
engine:['Cargo.toml'],cargoInputs:cargoInputPaths(root),tracked:()=>selectorTrackedFiles(root),composition:(source,row)=>composition.push({source,...row})});
mkdirSync('results/gate-inputs',{recursive:true});writeRustSelectorRecord('results/gate-inputs/rust-runtime.json',material);
console.log(JSON.stringify({inventory,composition,files:material.targets[0].roles.files}));`)) as {inventory:{source:string}[];composition:{readerCount:number;roots:{reason:string;target:{source:string}}[]}[];files:string[]};
  assert.deepEqual(prepared.inventory.map(row=>row.source),[target.source]);assert.equal(prepared.composition[0]!.readerCount,5);
  for(const name of ['own','normal','dev','bin'])assert.ok(prepared.files.includes('docs/'+name+'.ts'));
  git(['add','.']);git(['commit','-qm','accepted inherited reader projection']);
  const result=JSON.parse(node(`import {owed,gateSteps,rustRecordDecision} from ${url('./owed.mjs')};
import {acceptedRustSelectorIdentity} from ${url('./rust-selector.ts')};
const trust={acceptedRustRecordBlob:acceptedRustSelectorIdentity(process.cwd()).blob,dependencyCatalog:${JSON.stringify(catalog)}};
const choose=name=>gateSteps(owed([{path:'docs/'+name+'.ts',before:'// old\\nconstant\\n',after:'// new\\nconstant\\n',sameMode:true}],trust));
console.log(JSON.stringify({steps:Object.fromEntries(['own','normal','dev','bin','unread'].map(name=>[name,choose(name)])),decision:rustRecordDecision(trust)}));`)) as {steps:Record<string,string[]>;decision:{record:string;reason:string}};
  assert.equal(result.decision.record,'trusted');assert.match(result.decision.reason,/installation catalog current/);
  const selected=result.steps;
  for(const name of ['own','normal','dev','bin'])for(const step of ['tests','addons'])assert.ok(selected[name]!.includes(step),name+' retains '+step);
  for(const step of ['tests','addons'])assert.ok(!selected.unread!.includes(step),'unread comment keeps precision: '+step);
});
