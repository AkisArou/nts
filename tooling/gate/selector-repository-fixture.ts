import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {oracleWorkspaceFixture} from '../differential/oracle-workspace-fixture.ts';
import {dependencyCache} from '../inputs/dependency-inputs.ts';
import {LINKER_INPUTS} from '../inputs/linker.ts';
import {cargoRuntimeTargets} from './cargo-inputs.ts';
import {gitArguments} from './git-arguments/main.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {SELECTOR_POLICY_DATA} from './owed.mjs';
import {fileInput,fixtureInput,type InputEntry} from './reader-inputs/main.ts';
import {RUST_RUNTIME_DECLARATIONS} from './rust-selector-selection.ts';
import {RUST_SELECTOR_RECORD} from './rust-selector-record.ts';
import {recordRustSelector} from './rust-selector-write.ts';
import {toolingStepNames} from './tooling-discovery.ts';

const ROOT=fileURLToPath(new URL('../..',import.meta.url));
type Fixture=Parameters<typeof oracleWorkspaceFixture>[0];

/** The real selector and installer, with one independent Rust input owner. */
export function smallSelectorRepository(t:Fixture,repo:string,env:NodeJS.ProcessEnv):void{
  mkdirSync(repo,{recursive:true});
  const entries:InputEntry[]=[fixtureInput(new URL('./owed.mjs',import.meta.url),{dataNamespaces:{}}),...LINKER_INPUTS.map(url=>relative(ROOT,fileURLToPath(url))),
    ...SELECTOR_POLICY_DATA.map(path=>({kind:'file' as const,url:fileInput(pathToFileURL(join(ROOT,path)))}))];
  const copied=copyModuleClosure(entries,repo);
  oracleWorkspaceFixture(t,repo,ROOT);
  const git=(...args:string[])=>execFileSync('git',gitArguments(args),{cwd:repo,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const put=(path:string,text:string)=>{mkdirSync(dirname(join(repo,path)),{recursive:true});writeFileSync(join(repo,path),text);};
  // This source owner makes real candidate commits, including new tooling
  // entries; the oracle-only fixture's blanket tooling ignore does not apply.
  put('.gitignore','node_modules/\n/third_party/\n/target/\n');
  // The one-crate source has no nts CLI linking LLVM, hence no dependent
  // compiler corpus. Retain every rule/order self-check and its failure arm;
  // only the real full-population control owns that graph-specific assertion.
  const policy=join(repo,'tooling/gate/owed.mjs'),text=readFileSync(policy,'utf8'),dependent=' || !order.includes("corpus")';
  assert.equal(text.split(dependent).length,2);writeFileSync(policy,text.replace(dependent,''));
  const names=toolingStepNames(ROOT);assert.ok(names.includes('tests')&&names.includes('tooling'));
  for(const name of names)assert.match(name,/^[a-z0-9-]+$/);
  const commands:Record<string,string>={tooling:'node tooling/control.test.ts','gate-inputs':'node tooling/gate/owed.mjs --full-census'};
  put('tooling/gate/all.sh',`#!/bin/sh
if [ "$1" = --list ]; then printf '%s\\n' ${names.map(name=>"'"+name+"'").join(' ')}; exit; fi
${names.map(name=>'step "'+name+'" '+(commands[name]??'true')).join('\n')}
`);
  put('tooling/gate/run.mjs','');put('tooling/gate/tooling-test-exclusions.json','[]');
  put('tooling/control.test.ts',"import {test} from 'node:test';test('owned selector fixture',()=>{});\n");
  put('Cargo.toml','[package]\nname="selector-range-control"\nversion="0.0.0"\nedition="2021"\n[workspace]\n');
  put('src/lib.rs','');put('docs/runtime-input.txt','one runtime input\n');
  const inventory=cargoRuntimeTargets(repo);assert.equal(inventory.length,1);assert.equal(inventory[0]!.source,'src/lib.rs');
  const {source,name,kind}=inventory[0]!;
  put(RUST_RUNTIME_DECLARATIONS,JSON.stringify({version:1,targets:[{target:{source,name,kind},declarations:{imports:[],assets:[{kind:'file',path:'../docs/runtime-input.txt'}]}}]}));
  rmSync(join(repo,RUST_SELECTOR_RECORD),{force:true});
  // The staging owner supplies membership, including protected recipe code.
  // Private overrides are committed after that copy, never reconstructed from
  // a second handwritten module list or the source tree's index blobs.
  git('add','-f','--',...copied.filter(path=>path!==RUST_SELECTOR_RECORD&&existsSync(join(repo,path))),
    ...['.gitignore','Cargo.toml','Cargo.lock','src/lib.rs','docs/runtime-input.txt','tooling/control.test.ts',RUST_RUNTIME_DECLARATIONS].filter(path=>existsSync(join(repo,path))));
  git('commit','-qm','one-crate selector source and actual policy');
  recordRustSelector(repo);
  git('add','--',RUST_SELECTOR_RECORD);git('commit','-qm','accepted one-crate selector record');
  // Candidate commits remain detached, so the selection owner acquires only
  // the fixture's accepted main body, exactly as on the production route.
  git('checkout','--quiet','--detach','HEAD');
}

/** Only the wide integrity control uses the full source population. */
export function fullSelectorRepository(t:Fixture,repo:string,env:NodeJS.ProcessEnv):void{
  execFileSync('git',gitArguments(['clone','--quiet','--shared','--no-checkout',ROOT,repo]),{env,stdio:['ignore','pipe','pipe']});
  const git=(cwd:string,...args:string[])=>execFileSync('git',gitArguments(args),{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(repo,'checkout','--quiet','--detach',git(ROOT,'rev-parse','HEAD'));
  const shared=dirname(git(ROOT,'rev-parse','--path-format=absolute','--git-common-dir'));
  const cache=dependencyCache(repo);assert.equal(existsSync(cache),false);
  mkdirSync(dirname(cache),{recursive:true});symlinkSync(dependencyCache(shared),cache,'dir');
  t.after(()=>rmSync(cache,{force:true}));
}
