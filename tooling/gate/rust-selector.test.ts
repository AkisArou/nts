import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {gitArguments} from './git-arguments/main.ts';
import {fixtureEnvironment,testEnvironment} from './test-environment.ts';
import {testScratch} from './test-scratch.ts';
import {rustSelectorPending,checkRustSelectorRecord,recordRustSelector,withKeyedRustSelectorSource} from './rust-selector-write.ts';
import {RUST_RUNTIME_DECLARATIONS} from './rust-selector-selection.ts';
import {acceptedRustSelectorIdentity,acceptedRustSelectorRecord,rustSelectorRecordAtBlob,selectRustInputs,verifyRustSelectorDerivation} from './rust-selector.ts';
import {buildRustSelectorMaterial,selectorInstalledSdk} from './rust-selector-build.ts';
import {RUST_SELECTOR_RECORD,encodeRustSelectorRecord,rustSelectorRecordHashes} from './rust-selector-record.ts';
import {captureToolchain} from '../differential/oracle-toolchain.ts';
import {liveRustSelectorTargets} from './rust-selector-live.ts';
import {selectRange,withCommittedSelectorSource,withSelectorSources} from './owed-range.ts';
import type {RustRuntimeManifest,RustRuntimeTarget} from './rust-runtime-declarations.ts';
import {readRustRecordDecision,reportRustRecordDecisions} from './rust-selector-decision.ts';
import {installationCatalogPath,installationCatalogTrust,dependencyCache} from '../inputs/dependency-inputs.ts';
import {durableRecord} from './durable-record.ts';

function fixture(t:Parameters<typeof testScratch>[0],project=false){
  const root=testScratch(t,'rust-selector-trust');mkdirSync(join(root,'src'));mkdirSync(dirname(join(root,RUST_SELECTOR_RECORD)),{recursive:true});
  writeFileSync(join(root,'src/lib.rs'),'');writeFileSync(join(root,'data.txt'),'original');writeFileSync(join(root,'Cargo.toml'),'fixture');
  const target:RustRuntimeTarget={source:'src/lib.rs',name:'fixture',kind:['lib'],unitTests:true,doctests:true};
  const manifest:RustRuntimeManifest={version:1,targets:[{target,declarations:{imports:[],assets:[{kind:'file',path:'../data.txt'},{kind:'optional-file',path:'../missing.txt'}]}}]};
  if(project){
    writeFileSync(join(root,'package.json'),'{"type":"module"}');
    writeFileSync(join(root,'tsconfig.json'),'{"compilerOptions":{"types":[]},"include":["src/**/*.ts"]}');
    writeFileSync(join(root,'src/main.ts'),'export {};');
    manifest.targets[0]!.declarations.assets.push({kind:'project-config',path:'../tsconfig.json',role:'type-check'});
  }
  writeFileSync(join(root,'declarations.json'),JSON.stringify(manifest));
  const installed=selectorInstalledSdk(),tracked=['src/lib.rs','data.txt','Cargo.toml'].map(path=>({path,mode:'100644'}));
  const build=()=>encodeRustSelectorRecord(buildRustSelectorMaterial({sourceRoot:root,manifest,inventory:()=>[target],linkage:{packages:[{directory:'',name:'supplied',targets:[target],dependencies:[]}]},declarations:'declarations.json',engine:['src/lib.rs'],cargoInputs:['Cargo.toml'],tracked:()=>tracked,installed}));
  const record=build(),path=join(root,RUST_SELECTOR_RECORD);writeFileSync(path,JSON.stringify(record)+'\n');
  const env=testEnvironment(),git=(args:string[])=>{const result=spawnSync('git',gitArguments(args),{cwd:root,env,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout;};
  git(['init','-q','-b','main']);git(['-c','user.name=selector control','-c','user.email=control@example.invalid','add','.']);
  git(['-c','user.name=selector control','-c','user.email=control@example.invalid','commit','-qm','accepted selector']);
  const accepted=()=>acceptedRustSelectorRecord(root),key={roots:{source:root,sdk:installed.root,native:installed.nativeRoot},inventory:[target],tracked,sdk:()=>captureToolchain(installed.root)};
  return {root,path,record,key,build,accepted,git,live:()=>liveRustSelectorTargets({sourceRoot:root,manifest,inventory:[target],linkage:{packages:[{directory:'',name:'supplied',targets:[target],dependencies:[]}]},})};
}
test('committed source preparation excludes ignored output, keeps candidate bytes independent and drains on failure',t=>{
  const f=fixture(t);writeFileSync(join(f.root,'.gitignore'),'cache/\n');
  f.git(['add','.gitignore']);f.git(['-c','user.name=selector control','-c','user.email=control@example.invalid','commit','-qm','ignore private build output']);
  mkdirSync(join(f.root,'cache'));writeFileSync(join(f.root,'cache/build.tsbuildinfo'),'local ignored output');
  let prepared='',revision='';
  withCommittedSelectorSource(f.root,source=>{
    prepared=source.tree;revision=source.revision;assert.equal(source.dependencyCatalog,null);
    assert.equal(existsSync(join(source.tree,'cache')),false,'ignored caller output never enters committed source');
    assert.equal(readFileSync(join(source.tree,'data.txt'),'utf8'),'original');
    const key={...f.key,roots:{...f.key.roots,source:source.tree}};
    assert.equal(verifyRustSelectorDerivation({root:source.tree,candidatePath:f.path,key,accepted:f.accepted,build:f.build,report:()=>{}}),'current');
    const mutant=structuredClone(f.record);mutant.targets[0]!.files=[];Object.assign(mutant,rustSelectorRecordHashes(mutant));writeFileSync(f.path,JSON.stringify(mutant)+'\n');
    assert.throws(()=>verifyRustSelectorDerivation({root:source.tree,candidatePath:f.path,key,accepted:f.accepted,build:f.build,report:()=>{}}),/derivation mismatch/,'clean source cannot hide a changed working candidate');
  });
  assert.equal(existsSync(prepared),false);assert.equal(f.git(['for-each-ref','--format=%(refname)','refs/nts-selector/']).trim(),'');
  assert.throws(()=>withSelectorSources(f.root,[revision],sources=>{prepared=sources.prepare(0);assert.throws(()=>sources.prepare(0),/unused endpoint/);throw Error('supplied committed-source assessment failure');}),/supplied committed-source assessment failure/);
  assert.equal(existsSync(prepared),false);assert.equal(f.git(['for-each-ref','--format=%(refname)','refs/nts-selector/']).trim(),'');
  writeFileSync(f.path,JSON.stringify(f.record)+'\n');writeFileSync(join(f.root,'data.txt'),'next committed bytes');f.git(['add','data.txt']);
  f.git(['-c','user.name=selector control','-c','user.email=control@example.invalid','commit','-qm','change source input']);
  withCommittedSelectorSource(f.root,source=>{assert.notEqual(source.revision,revision);assert.equal(readFileSync(join(source.tree,'data.txt'),'utf8'),'next committed bytes');});
});

test('public pending and mandatory checks use committed declaration presence and refuse a dirty deletion',t=>{
  const f=fixture(t),messages:string[]=[];
  // This committed repository has no runtime declaration. Its unrelated
  // malformed candidate and invalid Cargo text must never acquire an API.
  writeFileSync(f.path,'malformed unrelated candidate');
  assert.equal(rustSelectorPending(f.root),false);checkRustSelectorRecord(f.root,line=>messages.push(line));assert.equal(messages.length,0);
  const declaration=join(f.root,RUST_RUNTIME_DECLARATIONS);mkdirSync(dirname(declaration),{recursive:true});writeFileSync(declaration,'{}');
  f.git(['add',RUST_RUNTIME_DECLARATIONS]);f.git(['-c','user.name=selector control','-c','user.email=control@example.invalid','commit','-qm','declare runtime inputs']);
  rmSync(declaration);
  assert.throws(()=>rustSelectorPending(f.root),/requires committed source inputs/);
  assert.throws(()=>checkRustSelectorRecord(f.root,line=>messages.push(line)),/requires committed source inputs/);
  assert.throws(()=>recordRustSelector(f.root),/requires committed source inputs/);
  assert.equal(messages.length,0);
});

test('the keyed fence refuses a HEAD moved during assessment',t=>{
  const f=fixture(t),declaration=join(f.root,RUST_RUNTIME_DECLARATIONS);mkdirSync(dirname(declaration),{recursive:true});writeFileSync(declaration,'{}');
  f.git(['add',RUST_RUNTIME_DECLARATIONS]);f.git(['-c','user.name=selector control','-c','user.email=control@example.invalid','commit','-qm','declare runtime inputs']);
  assert.equal(withKeyedRustSelectorSource(f.root,new Map(),()=>true),true);
  assert.throws(()=>withKeyedRustSelectorSource(f.root,new Map(),()=>{f.git(['-c','user.name=selector control','-c','user.email=control@example.invalid','commit','-q','--allow-empty','-m','moved during assessment']);return true;}),/changed during assessment/);
});

function declaredProgramFence(t:Parameters<typeof testScratch>[0]){
  const f=fixture(t,true),declaration=join(f.root,RUST_RUNTIME_DECLARATIONS);
  mkdirSync(dirname(declaration),{recursive:true});writeFileSync(declaration,'{}');
  f.git(['add','.']);f.git(['-c','user.name=selector control','-c','user.email=control@example.invalid','commit','-qm','declare source identity controls']);
  return {...f,certify:()=>withKeyedRustSelectorSource(f.root,new Map(),(_source,observe)=>{observe(f.record);return true;})};
}
for(const replacement of ['symlink','file'] as const)test('the source fence refuses a root replaced by a '+replacement,t=>{
  const f=declaredProgramFence(t),parent=testScratch(t,'source-root-replacement'),saved=join(parent,'saved'),elsewhere=join(parent,'elsewhere');
  const cloned=spawnSync('git',gitArguments(['clone','--quiet','--no-hardlinks',f.root,elsewhere]),{env:fixtureEnvironment(t),encoding:'utf8'});
  assert.equal(cloned.status,0,cloned.stderr);assert.equal(f.certify(),true);
  const replace=()=>{renameSync(f.root,saved);if(replacement==='symlink')symlinkSync(elsewhere,f.root);else writeFileSync(f.root,'replaced root');};
  const restore=()=>{rmSync(f.root,{force:true});renameSync(saved,f.root);};
  replace();
  try{assert.throws(f.certify,/source root/,'an invalid root is refused before another Git source can supply authority');}
  finally{restore();}
  assert.throws(()=>withKeyedRustSelectorSource(f.root,new Map(),(_source,observe)=>{
    observe(f.record);replace();return true;
  }),/source root/,'the root also stays bound throughout an assessment');
  restore();assert.equal(f.certify(),true);
});
for(const change of ['delete','rename'] as const)test('the source fence refuses a '+change+' of a source directory',t=>{
  const f=declaredProgramFence(t);assert.equal(f.certify(),true);
  f.git(change==='delete'?['rm','-r','src']:['mv','src','renamed']);
  assert.throws(f.certify,/requires committed source inputs/);
});

test('the keyed source fence replays compiler matches for dirty additions and preserves nonmatching edits',t=>{
  const f=fixture(t,true),declaration=join(f.root,RUST_RUNTIME_DECLARATIONS);
  mkdirSync(dirname(declaration),{recursive:true});writeFileSync(declaration,'{}');
  writeFileSync(join(f.root,'src/notes.tsv'),'committed non-source');
  f.git(['add','.']);f.git(['-c','user.name=selector control','-c','user.email=control@example.invalid','commit','-qm','declare Program fence controls']);
  const certify=()=>withKeyedRustSelectorSource(f.root,new Map(),(_source,observe)=>{observe(f.record);return true;});
  const notes=readFileSync(join(f.root,'src/notes.tsv'));
  writeFileSync(join(f.root,'src/notes.tsv'),'dirty non-source');
  assert.equal(certify(),true,'a nonmatching content edit can be certified on its own');
  writeFileSync(join(f.root,'src/notes.tsv'),notes);
  writeFileSync(join(f.root,'src/added.tsv'),'staged non-source');f.git(['add','src/added.tsv']);
  assert.equal(certify(),true,'a staged nonmatching addition can be certified on its own');
  writeFileSync(join(f.root,'src/added.ts'),'export {};');f.git(['add','src/added.ts']);
  assert.throws(certify,/requires committed source inputs/,'a dirty matching addition cannot be certified');
  f.git(['rm','-f','src/added.ts']);
  assert.equal(certify(),true);
  const original=readFileSync(join(f.root,'src/main.ts'));
  writeFileSync(join(f.root,'src/main.ts'),'export const changed=1;');
  assert.throws(certify,/requires committed source inputs/,'matched source bytes retain the exact path fence');
  writeFileSync(join(f.root,'src/main.ts'),original);
  assert.equal(certify(),true);
  f.git(['rm','tsconfig.json']);f.git(['-c','user.name=selector control','-c','user.email=control@example.invalid','commit','-qm','remove the formerly declared project']);
  assert.equal(certify(),true,'a stale candidate cannot invent a removed committed config');
});

test('selection assesses committed inputs while retaining the independent working record body',t=>{
  const f=fixture(t);writeFileSync(join(f.root,'.gitignore'),'missing.txt\n');
  f.git(['add','.gitignore']);f.git(['-c','user.name=selector control','-c','user.email=control@example.invalid','commit','-qm','ignore local compiler output']);
  writeFileSync(join(f.root,'missing.txt'),'ignored compiler output');
  assert.equal(selectRustInputs({...f,report:()=>{}}).state,'live','the working source observes the changed negative');
  withCommittedSelectorSource(f.root,source=>{
    const key={...f.key,roots:{...f.key.roots,source:source.tree}};
    const options={root:source.tree,candidatePath:f.path,key,accepted:f.accepted,report:()=>{}};
    const selected=selectRustInputs({...options,live:()=>{throw Error('ignored caller output caused live derivation');}});
    assert.equal(selected.state,'record');assert.equal(selected.decision.record,'trusted');
    const mutant=structuredClone(f.record);mutant.targets[0]!.files=[];Object.assign(mutant,rustSelectorRecordHashes(mutant));
    writeFileSync(f.path,JSON.stringify(mutant)+'\n');
    let live=0;
    assert.equal(selectRustInputs({...options,live:()=>{live++;return [];}}).state,'live');
    assert.equal(live,1,'the committed source cannot authorize a changed working body');
  });
});

test('accepted main acquisition pins revision, blob and the exact bounded body',t=>{
  const f=fixture(t),trusted=f.accepted();assert.ok(trusted);
  assert.equal(trusted.revision,f.git(['rev-parse','HEAD']).trim());assert.equal(trusted.blob,f.git(['rev-parse','HEAD:'+RUST_SELECTOR_RECORD]).trim());
  assert.equal(trusted.sha256,createHash('sha256').update(readFileSync(f.path)).digest('hex'));
  const selected=selectRustInputs({...f,report:()=>{},live:()=>{throw Error('current record built live');}});assert.equal(selected.state,'record');
  assert.deepEqual(selected.decision,{record:'trusted',reason:'accepted record bytes and current input key verified',blob:trusted.blob});
  assert.deepEqual(selected.targets,f.live(),'record and live graph expose the same consumed roles');
  assert.equal(verifyRustSelectorDerivation({...f,report:()=>{},build:()=>{throw Error('accepted record rebuilt');}}),'current');
});
test('stale keys log pending and use the canonical live graph, never stale roles',t=>{
  const f=fixture(t),messages:string[]=[];writeFileSync(join(f.root,'missing.txt'),'new candidate');
  const selected=selectRustInputs({...f,report:message=>messages.push(message)});assert.equal(selected.state,'live');
  assert.equal(selected.decision.record,'stale-live');assert.match(selected.decision.reason,/runtimeKind .*missing.txt/);
  assert.ok(selected.targets[0]!.roles.files.includes('missing.txt'));assert.match(messages.join('\n'),/pending: runtimeKind .*missing.txt/);
  assert.equal(verifyRustSelectorDerivation({...f,report:()=>{},build:()=>{throw Error('stale record required rebuild equality');}}),'pending');
});
test('missing or stale installation catalogs conservatively owe all Rust targets with a structured reason',t=>{
  const f=fixture(t),messages:string[]=[];
  const selected=selectRustInputs({...f,catalogPending:'installation catalog pin changed: pnpm-lock.yaml',report:line=>messages.push(line),live:()=>{throw Error('unavailable catalog cannot authenticate live package reads');}});
  assert.equal(selected.state,'live');if(selected.state!=='live')return;
  assert.equal(selected.allRust,true);assert.deepEqual(selected.targets,[],'no invented path or role authority');
  assert.match(selected.decision.reason,/catalog-stale-live: .*pnpm-lock.yaml/);assert.match(messages[0]!,/owing all Rust targets/);
  const malformed=structuredClone(f.record);malformed.targetsSha256='0'.repeat(64);writeFileSync(f.path,JSON.stringify(malformed));
  assert.throws(()=>selectRustInputs({...f,catalogPending:'missing',report:()=>{}}),/malformed/,'catalog absence cannot hide tampered records');
});
test('edited self-consistent narrowed roles use live selection and fail mandatory derivation',t=>{
  const f=fixture(t),mutant=structuredClone(f.record);mutant.targets[0]!.files=[];Object.assign(mutant,rustSelectorRecordHashes(mutant));writeFileSync(f.path,JSON.stringify(mutant)+'\n');
  const selected=selectRustInputs({...f,report:()=>{}});assert.equal(selected.state,'live');assert.ok(selected.targets[0]!.roles.files.includes('data.txt'));
  assert.throws(()=>verifyRustSelectorDerivation({...f,report:()=>{}}),/derivation mismatch/);
  writeFileSync(f.path,JSON.stringify(f.record,null,2)+'\n');assert.equal(verifyRustSelectorDerivation({...f,report:()=>{}}),'derived','untrusted formatting still needs actual derivation');
});
test('a changed stale payload cannot become trusted main and activate when its key returns',t=>{
  const f=fixture(t),accepted=f.accepted(),mutant=structuredClone(f.record);assert.ok(accepted);
  mutant.targets[0]!.files=[];Object.assign(mutant,rustSelectorRecordHashes(mutant));writeFileSync(f.path,JSON.stringify(mutant)+'\n');
  writeFileSync(join(f.root,'data.txt'),'temporary source change');
  assert.throws(()=>verifyRustSelectorDerivation({...f,accepted:()=>accepted,report:()=>{},build:()=>{throw Error('stale rebuild cannot certify a different key');}}),/unverified stale candidate/);
  // The mandatory check refuses stage one, so no accepted-main publication
  // is authorized. Returning the source cannot convert it to accepted bytes.
  writeFileSync(join(f.root,'data.txt'),'original');
  assert.equal(selectRustInputs({...f,accepted:()=>accepted,report:()=>{}}).state,'live');
  assert.throws(()=>verifyRustSelectorDerivation({...f,accepted:()=>accepted,report:()=>{}}),/derivation mismatch/);
});

test('explicit blob trust hashes Git bytes independently of a dirty working record',t=>{
  const f=fixture(t),identity=acceptedRustSelectorIdentity(f.root);assert.ok(identity);
  const trust={acceptedRustRecordBlob:identity.blob};
  const accepted=()=>rustSelectorRecordAtBlob(f.root,trust);
  assert.equal(selectRustInputs({...f,accepted,report:()=>{},live:()=>{throw Error('matching blob rebuilt');}}).state,'record');
  assert.equal(selectRustInputs({...f,accepted:()=>rustSelectorRecordAtBlob(f.root,{acceptedRustRecordBlob:null}),report:()=>{}}).state,'live');
  const mutant=structuredClone(f.record);mutant.targets[0]!.files=[];Object.assign(mutant,rustSelectorRecordHashes(mutant));
  writeFileSync(f.path,JSON.stringify(mutant)+'\n');
  assert.equal(f.git(['rev-parse','HEAD:'+RUST_SELECTOR_RECORD]).trim(),identity.blob);
  assert.equal(accepted()!.sha256,f.accepted()!.sha256,'trusted SHA still comes from Git, not changed working bytes');
  const result=selectRustInputs({...f,accepted,report:()=>{}});assert.equal(result.state,'live');
  if(result.state==='live')assert.equal(result.pending.kind,'unverified-record');
});

test('real private endpoints reuse only the accepted blob and their prepared base catalog',t=>{
  const f=fixture(t),url=(path:string)=>JSON.stringify(new URL(path,import.meta.url).href);
  // Supplied catalog bytes exercise only the process handoff here; package
  // membership and producer authentication have their own owner controls.
  durableRecord(installationCatalogPath(f.root,f.root),{fixture:'source catalog handoff'});
  const cache=dependencyCache(f.root);t.after(()=>rmSync(cache,{recursive:true,force:true}));
  const sourceCatalog=installationCatalogTrust(f.root,f.root);assert.ok(sourceCatalog);
  mkdirSync(join(f.root,'tooling/inputs'),{recursive:true});
  writeFileSync(join(f.root,'pnpm-lock.yaml'),'supplied linker control; no package authority');
  writeFileSync(join(f.root,'publish-catalog'),'yes');
  writeFileSync(join(f.root,'tooling/inputs/link.sh'),'#!/bin/sh\nset -eu\nnode "$3/tooling/inputs/catalog-fixture.ts" "$2" "$3"\n');
  writeFileSync(join(f.root,'tooling/inputs/catalog-fixture.ts'),`import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {durableRecord} from ${url('./durable-record.ts')};
import {installationCatalogPath} from ${url('../inputs/dependency-inputs.ts')};
const [shared,tree]=process.argv.slice(2);if(existsSync(join(tree,'publish-catalog')))durableRecord(installationCatalogPath(shared,tree),{fixture:'prepared base catalog handoff'});
`);
  mkdirSync(join(f.root,'tooling/gate'),{recursive:true});
  writeFileSync(join(f.root,'tooling/gate/owed.mjs'),`import {readFileSync} from 'node:fs';
import {durableRecord} from ${url('./durable-record.ts')};
import {join} from 'node:path';
import {selectRustInputs,rustSelectorRecordAtBlob} from ${url('./rust-selector.ts')};
import {selectorInstalledSdk} from ${url('./rust-selector-inputs.ts')};
import {RUST_SELECTOR_RECORD,rustSelectorRecordHashes} from ${url('./rust-selector-record.ts')};
const root=process.cwd(),installed=selectorInstalledSdk();
export const SELECTOR_POLICY_DATA=[RUST_SELECTOR_RECORD];
export const selfTest=()=>null;
export const allSteps=()=>['record','live'];
export const gateSteps=rules=>rules.flatMap(row=>row.steps);
let decision;
export const rustRecordDecision=()=>decision;
export function owed(changes,trust){
 if(changes.some(row=>row.path==='dirty-body-trigger.md')){
  const path=join(root,RUST_SELECTOR_RECORD),record=JSON.parse(readFileSync(path,'utf8'));record.targets[0].files=[];
  Object.assign(record,rustSelectorRecordHashes(record));durableRecord(path,record,{compact:true});
 }
 const selected=selectRustInputs({root,key:{roots:{source:root,sdk:installed.root,native:installed.nativeRoot},
  inventory:[{source:'src/lib.rs',name:'fixture',kind:['lib'],unitTests:true,doctests:true}],
  tracked:['src/lib.rs','data.txt','Cargo.toml'].map(path=>({path,mode:'100644'})),sdk:()=>installed},
  accepted:()=>rustSelectorRecordAtBlob(root,trust),report:message=>console.error(message),live:()=>{
   if(readFileSync('live-mode','utf8')==='refuse')throw Error('matched accepted endpoint unexpectedly built live');return [];
  }});
 decision=selected.decision;
 return [{name:selected.state==='live'?'live '+selected.pending.kind:'record',paths:[],steps:[selected.state],arms:[{kind:'valid',asks:JSON.stringify(trust.dependencyCatalog),run:'supplied source catalog handoff'}]}];
}
`);
  const commit=(message:string)=>{f.git(['add','.']);f.git(['-c','user.name=selector control','-c','user.email=control@example.invalid','commit','-qm',message]);return f.git(['rev-parse','HEAD']).trim();};
  writeFileSync(join(f.root,'live-mode'),'refuse');const base=commit('endpoint policy');
  f.git(['switch','-c','candidate']);writeFileSync(join(f.root,'unread.md'),'unread');const candidate=commit('unread candidate');
  const matched=selectRange(f.root,base+'..'+candidate);assert.ok(matched.views.every(row=>row.rules[0]!.name==='record'));
  const preparedCatalog=JSON.parse(matched.views[0]!.rules[0]!.arms[0]!.asks) as typeof sourceCatalog;
  assert.ok(preparedCatalog);assert.notEqual(preparedCatalog.catalogPath,sourceCatalog.catalogPath,'the real source checkout is not the installation owner');
  assert.ok(matched.views.every(row=>row.rules[0]!.arms[0]!.asks===JSON.stringify(preparedCatalog)),'both private endpoints receive the one prepared base catalog');
  assert.equal(existsSync(preparedCatalog.catalogPath),false,'the range drains its own catalog receipt');
  assert.equal(matched.acceptedRustRecord!.blob,acceptedRustSelectorIdentity(f.root)!.blob);
  assert.equal(matched.rustRecords!.length,2);assert.ok(matched.rustRecords!.every(row=>row.decision.record==='trusted'&&row.decision.blob===matched.acceptedRustRecord!.blob));
  writeFileSync(join(f.root,'live-mode'),'allow');const allowed=commit('allow named live controls');f.git(['update-ref','refs/heads/main',allowed]);
  writeFileSync(join(f.root,'dirty-body-trigger.md'),'trigger');const dirty=commit('dirty working-body control');
  const dirtyResult=selectRange(f.root,allowed+'..'+dirty);
  assert.ok(dirtyResult.views.every(row=>row.rules[0]!.name==='live unverified-record'),'unchanged endpoint HEAD cannot authenticate a modified working body');
  assert.ok(dirtyResult.rustRecords!.every(row=>row.decision.record==='absent-live'&&row.decision.reason.includes('unverified-record')));
  rmSync(join(f.root,'dirty-body-trigger.md'));const clean=commit('end dirty working-body control');f.git(['update-ref','refs/heads/main',clean]);
  writeFileSync(join(f.root,'another-unread.md'),'unread');const unchanged=commit('unchanged record candidate');
  const mutant=structuredClone(f.record);mutant.targets[0]!.files=[];Object.assign(mutant,rustSelectorRecordHashes(mutant));
  writeFileSync(f.path,JSON.stringify(mutant)+'\n');const edited=commit('self-consistent edited candidate');
  const narrowed=selectRange(f.root,clean+'..'+edited);assert.deepEqual(narrowed.views.map(row=>row.rules[0]!.name),['record','live unverified-record']);
  // Main advances without moving this tree back: the older endpoints now
  // differ from the one accepted blob acquired at the source owner.
  writeFileSync(f.path,JSON.stringify(f.record,null,2)+'\n');const advanced=commit('advanced accepted record');f.git(['update-ref','refs/heads/main',advanced]);
  const moved=selectRange(f.root,clean+'..'+unchanged);assert.ok(moved.views.every(row=>row.rules[0]!.name==='live unverified-record'));
  assert.equal(moved.acceptedRustRecord!.revision,advanced);
  f.git(['update-ref','-d','refs/heads/main']);rmSync(installationCatalogPath(f.root,f.root));
  rmSync(join(f.root,'publish-catalog'));const missingBase=commit('prepared linker has no catalog');
  writeFileSync(join(f.root,'missing-catalog-unread.md'),'unread');const missingTip=commit('missing catalog candidate');
  const absent=selectRange(f.root,missingBase+'..'+missingTip);
  assert.equal(absent.acceptedRustRecord,null);assert.ok(absent.views.every(row=>row.rules[0]!.name==='live unverified-record'));
  assert.ok(absent.rustRecords!.every(row=>row.decision.record==='absent-live'&&row.decision.blob===null));
  assert.ok(absent.views.every(row=>row.rules[0]!.arms[0]!.asks==='null'),'missing source catalog remains explicit in each endpoint');
});

test('record decision JSON is validated and detached before the parent prints it',()=>{
  const original={record:'stale-live' as const,reason:'directoryExists missing.ts: changed',blob:null};
  const value=readRustRecordDecision(original);original.reason='caller mutation';
  const lines:string[]=[];reportRustRecordDecisions([{revision:'a'.repeat(40),decision:value}],line=>lines.push(line));
  assert.equal(lines.length,1);assert.match(lines[0]!,/stale-live; directoryExists missing.ts: changed/);
  for(const malformed of [{...value,record:'green'},{...value,reason:''},{...value,blob:'bad'},{...value,record:'trusted'}, {...value,authority:true}])
    assert.throws(()=>readRustRecordDecision(malformed),/invalid Rust selector record decision/);
});
