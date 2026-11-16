import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chmodSync,copyFileSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {buildRustSelectorMaterial,selectorInstalledSdk,verifySelectorSources} from './rust-selector-build.ts';
import {moduleGraph} from './module-closure.ts';
import {rustBuildModules} from './rust-modules.ts';
import {parseRustSelectorMaterial,readRustSelectorMaterial,selectorFact,selectorFile,selectorHash,validateRustSelectorMaterial,
  type RustSelectorMaterial,type SelectorRoots,type TrackedFile} from './rust-selector-material.ts';
import {captureToolchain} from '../differential/oracle-toolchain.ts';
import {OracleFilesystem} from '../differential/oracle-filesystem.ts';
import type {RustRuntimeManifest,RustRuntimeTarget} from './rust-runtime-declarations.ts';
import {testScratch} from './test-scratch.ts';
import {rustSelectorRoles} from './rust-selector-roles.ts';
import {encodeRustSelectorRecord,parseRustSelectorRecord,rustSelectorRecordHashes,validateRustSelectorKey} from './rust-selector-record.ts';
import {readerDependencyIndex,readerObservationIndex,validateReaderSourceObservations} from './reader-observations.ts';
import {projectConfig} from './reader-inputs/main.ts';
import {pathToFileURL} from 'node:url';

const target:RustRuntimeTarget={source:'crate/lib.rs',name:'crate',kind:['lib'],unitTests:true,doctests:false};
function fixture(t:Parameters<typeof testScratch>[0]){
  const root=testScratch(t,'rust-selector-record');mkdirSync(join(root,'crate'));mkdirSync(join(root,'data'));
  writeFileSync(join(root,'crate/lib.rs'),'mod child;');writeFileSync(join(root,'crate/child.rs'),'');
  writeFileSync(join(root,'data/input.md'),'immutable input');writeFileSync(join(root,'Cargo.toml'),'[package]\nname="fixture"\n');
  const manifest:RustRuntimeManifest={version:1,targets:[{target,declarations:{imports:[],assets:[
    {kind:'file',path:'../data/input.md'},{kind:'optional-file',path:'../missing.json'},{kind:'membership',path:'../data/'},
  ]}}],readers:[{source:'crate/child.rs',declarations:{imports:[],assets:[]}}]};
  writeFileSync(join(root,'declarations.json'),JSON.stringify(manifest));
  const installed=selectorInstalledSdk(),roots:SelectorRoots={source:root,sdk:installed.root,native:installed.nativeRoot};
  const tracked:TrackedFile[]=['crate/lib.rs','crate/child.rs','data/input.md','Cargo.toml','declarations.json'].map(path=>({path,mode:'100644'}));
  const build=()=>buildRustSelectorMaterial({sourceRoot:root,manifest,inventory:()=>[target],linkage:{packages:[{directory:'',name:'supplied',targets:[target],dependencies:[]}]},declarations:'declarations.json',engine:['crate/lib.rs'],cargoInputs:['Cargo.toml'],tracked:()=>tracked,installed});
  const options={roots,inventory:[target],tracked,sdk:()=>captureToolchain(installed.root)};
  return {root,manifest,roots,tracked,build,options};
}
function pending(record:RustSelectorMaterial,options:Parameters<typeof validateRustSelectorMaterial>[1],kind:string,path:RegExp){
  const result=validateRustSelectorMaterial(record,options);assert.equal(result.state,'pending');
  if(result.state!=='pending')throw Error('expected pending');assert.equal(result.pending.kind,kind);assert.match(result.pending.path,path);
}
test('native matching leaves warm outputs outside both selector keys and retains raw race and native-claim facts',t=>{
  const f=fixture(t);mkdirSync(join(f.root,'src'));
  writeFileSync(join(f.root,'package.json'),'{"type":"module"}');
  writeFileSync(join(f.root,'tsconfig.json'),'{"compilerOptions":{"types":[]},"include":["src/**/*.ts"]}');
  writeFileSync(join(f.root,'src/main.ts'),'export {};');
  f.manifest.targets[0]!.declarations.assets=[{kind:'project-config',path:'../tsconfig.json',role:'type-check'}];
  writeFileSync(join(f.root,'declarations.json'),JSON.stringify(f.manifest));
  const material=f.build(),compact=encodeRustSelectorRecord(material),graph=moduleGraph({sourceRoot:f.root});
  try{
    const snapshot=graph.describe([projectConfig(pathToFileURL(join(f.root,'tsconfig.json')),'type-check')]);
    assert.deepEqual(material.key.projects,[{request:{kind:'config',path:'tsconfig.json'},files:['src/main.ts']}]);
    const raw=snapshot.observations.find(row=>row.observation.kind==='entries'&&row.observation.path===join(f.root,'src'));
    assert.equal(raw?.observationOnly,true);
    assert.ok(!material.targets[0]!.roles.typedDependencies.some(row=>row.dependency.path==='src'&&row.dependency.kind==='entries'),'acquisition-only rows never enter selector roles');
    assert.ok(!material.targets[0]!.roles.typedDependencies.some(row=>row.dependency.observationOnly));
    assert.ok(!material.key.facts.some(row=>row.kind==='entries'&&row.path.root==='source'&&row.path.path==='src'));
    for(const path of ['tsconfig.tsbuildinfo','src/build-output.js','src/notes.tsv'])writeFileSync(join(f.root,path),'ignored output');
    assert.equal(validateRustSelectorMaterial(material,f.options).state,'current');
    assert.equal(validateRustSelectorKey(compact,f.options).state,'key-current');
    const rebuilt=f.build();assert.equal(rebuilt.keySha256,material.keySha256,'nonmatching output leaves the complete material key unchanged');
    assert.equal(rebuilt.targetsSha256,material.targetsSha256,'acquisition-only additions leave the persisted selection roles unchanged');
    assert.deepEqual(encodeRustSelectorRecord(rebuilt),compact,'ignored outputs leave the complete accepted projection unchanged');
    assert.throws(()=>validateReaderSourceObservations(snapshot,f.root),/filesystem entries changed/,'raw reads still guard the original acquisition');
    const changes=[{path:'src/notes.tsv',added:true}];
    assert.equal(readerObservationIndex(f.root,snapshot.observations,['src/main.ts']).affected(changes).size,0);
    const projected=material.targets[0]!.roles.typedDependencies;
    assert.equal(readerDependencyIndex(projected,row=>row.dependency,['src/main.ts']).affected(changes).size,0);
    writeFileSync(join(f.root,'src/new.ts'),'export {};');
    pending(material,f.options,'project-discovery',/tsconfig.json/);
    const stale=validateRustSelectorKey(compact,f.options);assert.equal(stale.state,'pending');if(stale.state==='pending')assert.equal(stale.pending.kind,'project-discovery');
    const next=f.build();assert.ok(next.targets[0]!.roles.files.includes('src/new.ts'));
    assert.notEqual(next.keySha256,material.keySha256);
  }finally{graph.close();}
});

test('compact project queries authenticate their native recipe and reject malformed routing before replay',t=>{
  const f=fixture(t);writeFileSync(join(f.root,'base.json'),'{"compilerOptions":{"types":[]}}');mkdirSync(join(f.root,'src'));writeFileSync(join(f.root,'src/main.ts'),'export {};');
  writeFileSync(join(f.root,'package.json'),'{"type":"module"}');
  f.manifest.targets[0]!.declarations.assets=[{kind:'generated-project',path:'../base.json',directory:'./src/',include:'typescript-tree',role:'compiled-program'}];
  writeFileSync(join(f.root,'declarations.json'),JSON.stringify(f.manifest));
  const material=f.build(),compact=encodeRustSelectorRecord(material);
  assert.deepEqual(material.key.projects,[{request:{kind:'generated',path:'base.json',directory:'src',include:'typescript-tree'},files:['src/main.ts']}]);
  assert.equal(validateRustSelectorKey(parseRustSelectorRecord(compact),f.options).state,'key-current');
  assert.ok(!JSON.stringify(compact).includes('project-config-'));
  for(const row of [[2,...compact.key.projects[0]!.slice(1)],[0,compact.key.projects[0]![1]],[1,compact.key.projects[0]![1],compact.key.projects[0]![2],2,compact.key.projects[0]![4]]]){
    const changed=structuredClone(compact);changed.key.projects=[row];Object.assign(changed,rustSelectorRecordHashes(changed));
    assert.throws(()=>parseRustSelectorRecord(changed),/project discovery|config discovery|generated include/);
  }
  const duplicate=structuredClone(compact);duplicate.key.projects.push([...duplicate.key.projects[0]!]);Object.assign(duplicate,rustSelectorRecordHashes(duplicate));
  assert.throws(()=>parseRustSelectorRecord(duplicate),/duplicate project discovery/);
  writeFileSync(join(f.root,'src/new.ts'),'export {};');assert.equal(validateRustSelectorKey(compact,f.options).state,'pending');
});

test('the actual oracle nearest-config lookup owes through ordinary Node and compact dependencies',t=>{
  const f=fixture(t);mkdirSync(join(f.root,'src'));writeFileSync(join(f.root,'package.json'),'{"type":"module"}');
  writeFileSync(join(f.root,'tsconfig.json'),'{"compilerOptions":{"types":[]},"include":["src/*.ts"]}');writeFileSync(join(f.root,'src/main.ts'),'export {};');
  f.manifest.targets[0]!.declarations.assets=[{kind:'project-config',path:'../tsconfig.json',role:'compiled-program'}];
  writeFileSync(join(f.root,'declarations.json'),JSON.stringify(f.manifest));
  const discovery=new OracleFilesystem();assert.equal(discovery.projectFor(join(f.root,'src/main.ts')),join(f.root,'tsconfig.json'));
  const material=f.build(),compact=encodeRustSelectorRecord(material),dependencies=material.targets[0]!.roles.typedDependencies;
  const lookup=dependencies.find(row=>row.dependency.path==='src/tsconfig.json'&&row.dependency.kind==='fileExists');assert.ok(lookup);assert.equal(lookup.dependency.observationOnly,undefined);
  assert.ok(readerDependencyIndex(dependencies,row=>row.dependency,['src/main.ts']).affected([{path:'src/tsconfig.json',added:true}]).has(lookup));
  assert.equal(validateRustSelectorKey(compact,f.options).state,'key-current');
  writeFileSync(join(f.root,'src/tsconfig.json'),'{"files":["main.ts"]}');
  assert.equal(new OracleFilesystem().projectFor(join(f.root,'src/main.ts')),join(f.root,'src/tsconfig.json'));
  pending(material,f.options,'fileExists',/src\/tsconfig.json$/);
  const changed=validateRustSelectorKey(compact,f.options);assert.equal(changed.state,'pending');if(changed.state==='pending')assert.equal(changed.pending.kind,'fileExists');
});
test('portable selector records retain live roles, exact bytes and candidate absences without a reusable snapshot',t=>{
  const f=fixture(t),record=f.build();
  assert.deepEqual(parseRustSelectorMaterial(JSON.parse(JSON.stringify(record))),record);
  const read=validateRustSelectorMaterial(record,f.options);assert.equal(read.state,'current');
  if(read.state!=='current')throw Error('expected current');
  assert.deepEqual(read.targets,record.targets);assert.deepEqual(read.targets[0]!.roles.byteInputs,[{reader:'crate/lib.rs',path:'data/input.md'},{reader:'crate/lib.rs',path:'missing.json'}]);
  assert.ok(!('observations'in read.targets[0]!.roles));
  read.targets[0]!.roles.files.push('caller-mutation');assert.ok(!record.targets[0]!.roles.files.includes('caller-mutation'));
  writeFileSync(join(f.root,'data/input.md'),'changed bytes');pending(record,f.options,'file',/data\/input.md$/);
});
test('selector projection never traverses unconsumed callback provenance or unused snapshot columns',()=>{
  // The source may have arbitrarily many causes. Accessors make any traversal
  // fail deterministically, without allocating a multi-gigabyte test string.
  const snapshot:Parameters<typeof rustSelectorRoles>[1]={files:['input.ts'],moduleFiles:['input.ts'],placingFiles:['input.ts'],stagingFiles:['input.ts'],
    get ownedFiles():never{throw Error('selector traversed unused ownership column');},
    get hostFiles():never{throw Error('selector traversed unused host column');},directories:[],optionalFiles:[],memberships:[],projectMatches:[],
    observations:[{reader:'reader.ts',protocol:'project',context:{entry:'<entry>',dataNamespaces:{}},
      observation:{kind:'file',path:'/source/input.ts',value:'0'.repeat(64)},get causes():never{throw Error('selector traversed callback causes');}}]};
  const roles=rustSelectorRoles('/source',snapshot,[]);
  assert.deepEqual(roles.typedDependencies,[{reader:'reader.ts',protocol:'project',dependency:{path:'input.ts',kind:'file',bytes:true,directoryStat:false,context:{entry:'<entry>',dataNamespaces:{}}}}]);
  assert.ok(JSON.stringify(roles).length<1024);
  assert.ok(!('causes'in roles.typedDependencies[0]!));assert.ok(!('ownedFiles'in roles));
});
test('selector roles omit race-guard metadata while retaining a promoted member',()=>{
  const context={entry:'<entry>',dataNamespaces:{}};
  const snapshot:Parameters<typeof rustSelectorRoles>[1]={files:['member.ts'],runtimeFiles:['member.ts','candidate.ts'],ownedFiles:['member.ts','candidate.ts'],
    moduleFiles:['member.ts'],hostFiles:[],placingFiles:['member.ts'],stagingFiles:['member.ts'],directories:[],memberships:[],projectMatches:[],observations:[],
    optionalFiles:[{reader:'fence.ts',path:'candidate.ts',present:true,context,observationOnly:true},{reader:'fence.ts',path:'member.ts',present:true,context,observationOnly:true},{reader:'installer.ts',path:'package.json',present:false,context}]};
  const roles=rustSelectorRoles('/source',snapshot,[]);
  assert.deepEqual(roles.files,['member.ts']);assert.deepEqual(roles.optionalFiles.map(row=>row.path),['package.json']);
  assert.deepEqual(snapshot.runtimeFiles,['member.ts','candidate.ts']);assert.equal(snapshot.optionalFiles.length,3,'selection never mutates the full claim generation');
});
test('missing candidates and newly added Rust alternatives are loud pending answers',t=>{
  const f=fixture(t),record=f.build();
  writeFileSync(join(f.root,'missing.json'),'{}');pending(record,f.options,'runtimeKind',/missing.json$/);rmSync(join(f.root,'missing.json'));
  mkdirSync(join(f.root,'crate/child'));writeFileSync(join(f.root,'crate/child/mod.rs'),'');
  pending(record,f.options,'rust-candidate',/crate\/child\/mod.rs$/);
});
test('an absent optional candidate retains its actual missing parent answers',t=>{
  const f=fixture(t);f.manifest.targets[0]!.declarations.assets[1]!.path='../absent/nested/config.json';
  writeFileSync(join(f.root,'declarations.json'),JSON.stringify(f.manifest));const record=f.build();
  assert.equal(validateRustSelectorMaterial(record,f.options).state,'current');
  assert.ok(record.key.facts.some(row=>row.kind==='runtimeKind'&&row.path.root==='source'&&row.path.path==='absent'&&row.value===null));
  mkdirSync(join(f.root,'absent'));pending(record,f.options,'runtimeKind',/absent$/);
});
test('projection identity retains mode, engine, Cargo and declaration changes',t=>{
  const f=fixture(t),record=f.build();
  chmodSync(join(f.root,'data/input.md'),0o600);pending(record,f.options,'file',/data\/input.md$/);chmodSync(join(f.root,'data/input.md'),0o644);
  writeFileSync(join(f.root,'crate/lib.rs'),'mod child; // changed engine');pending(record,f.options,'engine',/crate\/lib.rs$/);
  writeFileSync(join(f.root,'crate/lib.rs'),'mod child;');writeFileSync(join(f.root,'Cargo.toml'),'changed');pending(record,f.options,'cargo',/Cargo.toml$/);
  writeFileSync(join(f.root,'Cargo.toml'),'[package]\nname="fixture"\n');writeFileSync(join(f.root,'declarations.json'),'changed');pending(record,f.options,'declarations',/declarations.json$/);
});
test('record facts distinguish alias retargeting from metadata-only content changes',t=>{
  const f=fixture(t),record=f.build();writeFileSync(join(f.root,'first.txt'),'first');writeFileSync(join(f.root,'second.txt'),'second');symlinkSync('first.txt',join(f.root,'alias'));
  const filesystem=new OracleFilesystem();filesystem.readlink(join(f.root,'alias'));filesystem.realpath(join(f.root,'alias'));filesystem.getAccessibleEntries(join(f.root,'data'));
  record.key.facts.push(...filesystem.captured().map(row=>selectorFact(f.roots,row)));record.keySha256=selectorHash(record.key);
  const parsed=parseRustSelectorMaterial(record);writeFileSync(join(f.root,'data/input.md'),'new input bytes');
  // Remove the independent byte owner to test metadata sensitivity alone.
  parsed.key.files=parsed.key.files.filter(row=>row.path.root!=='source'||row.path.path!=='data/input.md');
  parsed.keySha256=selectorHash(parsed.key);
  assert.equal(validateRustSelectorMaterial(parsed,f.options).state,'current');
  rmSync(join(f.root,'alias'));symlinkSync('second.txt',join(f.root,'alias'));pending(parsed,f.options,'readlink',/alias$/);
});
test('roles are portable to another owned root while SDK and source facts retain their anchors',t=>{
  const f=fixture(t),record=f.build(),other=testScratch(t,'rust-selector-second-root');
  for(const path of f.tracked.map(row=>row.path)){mkdirSync(dirname(join(other,path)),{recursive:true});copyFileSync(join(f.root,path),join(other,path));}
  mkdirSync(join(other,'data'),{recursive:true});
  const result=validateRustSelectorMaterial(record,{...f.options,roots:{...f.roots,source:other}});assert.equal(result.state,'current');
  rmSync(join(other,'data'),{recursive:true});const outside=testScratch(t,'rust-selector-parent-link');symlinkSync(outside,join(other,'data'));
  pending(record,{...f.options,roots:{...f.roots,source:other}},'file',/data\/input.md$/);
});
test('positive byte keys retain owned parent aliases and retargeting even between equal declared bytes',t=>{
  const f=fixture(t),record=f.build();
  for(const directory of ['first','second']){mkdirSync(join(f.root,directory));writeFileSync(join(f.root,directory,'input.txt'),'equal bytes');}
  symlinkSync('first',join(f.root,'linked'));
  const key=selectorFile(f.roots,join(f.root,'linked/input.txt'));
  assert.deepEqual(key.identity,{path:{root:'source',path:'first/input.txt'},aliases:[{path:{root:'source',path:'linked'},text:'first'}]});
  record.key.files.push(key,selectorFile(f.roots,join(f.root,'second/input.txt')));record.keySha256=selectorHash(record.key);
  assert.equal(validateRustSelectorMaterial(record,f.options).state,'current');
  rmSync(join(f.root,'linked'));symlinkSync('second',join(f.root,'linked'));pending(record,f.options,'file',/linked\/input.txt$/);
  rmSync(join(f.root,'linked'));const outside=testScratch(t,'rust-selector-outside-alias');writeFileSync(join(outside,'input.txt'),'equal bytes');symlinkSync(outside,join(f.root,'linked'));
  assert.throws(()=>selectorFile(f.roots,join(f.root,'linked/input.txt')),/unsupported external input|outside owned/);
});
test('tracked population changes are pending without manufacturing placement or byte authority',t=>{
  const f=fixture(t),record=f.build();record.key.populations=[{directory:'data',files:[{path:'data/input.md',mode:'100644'}]}];
  record.keySha256=selectorHash(record.key);
  pending(record,{...f.options,tracked:[...f.tracked,{path:'data/added.md',mode:'100644'}]},'tracked-population',/^data$/);
  pending(record,{...f.options,tracked:f.tracked.filter(row=>row.path!=='data/input.md')},'tracked-population',/^data$/);
});
test('material keys notice Cargo input addition, deletion and rename independently of old bytes',t=>{
  const f=fixture(t),record=f.build();
  for(const path of ['.cargo/config.toml','new/Cargo.toml','Cargo.lock','rust-toolchain.toml'])
    pending(record,{...f.options,tracked:[...f.tracked,{path,mode:'100644'}]},'cargo-input-population',new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$'));
  const removed=f.tracked.filter(row=>row.path!=='Cargo.toml');
  for(const tracked of [removed,[...removed,{path:'config.txt',mode:'100644'}] as TrackedFile[]])pending(record,{...f.options,tracked},'cargo-input-population',/^Cargo.toml$/);
  assert.equal(validateRustSelectorMaterial(record,{...f.options,tracked:[...f.tracked,{path:'unrelated.txt',mode:'100644'}]}).state,'current');
});
test('missing records are pending and malformed payloads, schemas and anchors refuse',t=>{
  const f=fixture(t),record=f.build();assert.deepEqual(readRustSelectorMaterial(join(f.root,'absent.json'),f.options).state,'pending');
  const tampered=structuredClone(record);tampered.targets[0]!.roles.files.push('extra');assert.throws(()=>parseRustSelectorMaterial(tampered),/payload hash mismatch/);
  assert.throws(()=>parseRustSelectorMaterial({...record,schemaSha256:'0'.repeat(64)}),/schema hash/);
  const escaped=structuredClone(record);escaped.key.engine[0]!.path.path='../outside';escaped.keySha256=selectorHash(escaped.key);
  assert.throws(()=>parseRustSelectorMaterial(escaped),/canonical relative path/);
  assert.throws(()=>selectorFact(f.roots,{kind:'stat',path:join(f.root,'data/input.md'),value:{mode:0o100644,size:1,mtimeMs:1}}),/nonportable stat input/);
});
test('publication binds source fingerprints to the actual parse rather than a later hash',t=>{
  const f=fixture(t);writeFileSync(join(f.root,'entry.ts'),'export const original=1;');
  const graph=moduleGraph({sourceRoot:f.root});
  try{
    graph.describe(['entry.ts']);const sources=graph.sourceInputs();
    sources[0]!.sha256='caller-mutation';assert.notEqual(graph.sourceInputs()[0]!.sha256,'caller-mutation');
    writeFileSync(join(f.root,'entry.ts'),'export const changed=2;');
    assert.throws(()=>verifySelectorSources(graph.sourceInputs(),[selectorFile(f.roots,join(f.root,'entry.ts'))]),/source changed after parse: entry.ts/);
  }finally{graph.close();}
  const rust=rustBuildModules(f.root,'crate/lib.rs',()=>true);writeFileSync(join(f.root,'crate/child.rs'),'mod newly_added;');
  assert.throws(()=>verifySelectorSources(rust.sources,[selectorFile(f.roots,join(f.root,'crate/lib.rs')),selectorFile(f.roots,join(f.root,'crate/child.rs'))]),/source changed after parse: crate\/child.rs/);
});
test('the writer freshly rechecks membership after construction and never publishes stale roles',t=>{
  const f=fixture(t);let reads=0;
  assert.throws(()=>buildRustSelectorMaterial({sourceRoot:f.root,manifest:f.manifest,inventory:()=>[target],linkage:{packages:[{directory:'',name:'supplied',targets:[target],dependencies:[]}]},declarations:'declarations.json',engine:['crate/lib.rs'],cargoInputs:['Cargo.toml'],
    tracked:()=>{if(++reads===2)writeFileSync(join(f.root,'data/new.md'),'new member');return f.tracked;}}),/changed before publication: runtimeEntries .*data/);
  assert.equal(reads,2);
});
test('an actual private SDK byte edit makes the recorded installation pending by name',t=>{
  const f=fixture(t),record=f.build(),copy=testScratch(t,'rust-selector-private-sdk');
  // Clone the authenticated package bytes into the same Node dependency shape.
  const installed=selectorInstalledSdk(),sdk=join(copy,'node_modules/typescript'),native=join(copy,'node_modules',installed.nativePackage);
  for(const [base,source,files]of [[sdk,installed.root,installed.files],[native,installed.nativeRoot,installed.nativeFiles]] as const)for(const [path,bytes]of files){
    mkdirSync(dirname(join(base,path)),{recursive:true});writeFileSync(join(base,path),bytes);chmodSync(join(base,path),selectorFile(f.roots,join(source,path)).mode&0o777);
  }
  const privateCapture=captureToolchain(sdk),options={...f.options,roots:{...f.roots,sdk,native},sdk:()=>captureToolchain(sdk)};
  assert.deepEqual(privateCapture.identity,record.key.sdk);assert.equal(validateRustSelectorMaterial(record,options).state,'current');
  writeFileSync(join(sdk,'package.json'),readFileSync(join(sdk,'package.json'),'utf8')+' ');
  pending(record,options,'sdk',/node_modules\/typescript$/);
});
