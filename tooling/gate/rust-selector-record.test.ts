import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {chmodSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync,truncateSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {buildRustSelectorMaterial,selectorInstalledSdk,writeRustSelectorRecord} from './rust-selector-build.ts';
import {encodeRustSelectorRecord,parseRustSelectorRecord,readRustSelectorRecord,rustSelectorRecordHashes,validateRustSelectorKey,MAX_RUST_SELECTOR_RECORD_BYTES} from './rust-selector-record.ts';
import {captureToolchain} from '../differential/oracle-toolchain.ts';
import type {RustRuntimeManifest,RustRuntimeTarget} from './rust-runtime-declarations.ts';
import {testScratch} from './test-scratch.ts';
import {selectorFact,selectorFile,selectorHash} from './rust-selector-material.ts';
const interned=(row:unknown[])=>[createHash('sha256').update(JSON.stringify(row)).digest().subarray(0,6).toString('base64url'),...row];

test('compact dependencies preserve the explicit filesystem protocol',t=>{
  const f=fixture(t);
  f.material.targets[0]!.roles.typedDependencies.push({reader:'crate/lib.rs',protocol:'filesystem',dependency:{path:'data/input.txt',kind:'runtimeKind',bytes:false,directoryStat:false,context:{entry:'<entry>',dataNamespaces:{}},observationOnly:true}});
  f.material.targets[0]!.roles.directories.push({reader:'crate/lib.rs',directory:'data',kind:'conservative',fileCount:1,context:{entry:'<entry>',dataNamespaces:{}}});
  f.material.targetsSha256=selectorHash(f.material.targets);
  writeRustSelectorRecord(f.path,f.material);f.options.trusted.sha256=createHash('sha256').update(readFileSync(f.path)).digest('hex');
  const parsed=readRustSelectorRecord(f.path,f.options);assert.equal(parsed.state,'current');if(parsed.state!=='current')throw Error('expected current');
  assert.ok(parsed.targets[0]!.roles.typedDependencies.some(row=>row.protocol==='filesystem'));
  assert.ok(parsed.targets[0]!.roles.typedDependencies.some(row=>row.dependency.observationOnly===true),'the compact codec retains the selection role');
  assert.ok(parsed.targets[0]!.roles.directories.some(row=>row.kind==='conservative'&&row.context?.entry==='<entry>'));
});

function fixture(t:Parameters<typeof testScratch>[0]){
  const root=testScratch(t,'compact-rust-selector');mkdirSync(join(root,'crate'));mkdirSync(join(root,'data'));
  writeFileSync(join(root,'crate/lib.rs'),'mod child;');writeFileSync(join(root,'crate/child.rs'),'');writeFileSync(join(root,'data/input.txt'),'original bytes');writeFileSync(join(root,'Cargo.toml'),'fixture Cargo identity');
  const target:RustRuntimeTarget={source:'crate/lib.rs',name:'fixture',kind:['lib'],unitTests:true,doctests:false};
  const manifest:RustRuntimeManifest={version:1,targets:[{target,declarations:{imports:[],assets:[{kind:'file',path:'../data/input.txt'},{kind:'optional-file',path:'../missing/nested.json'},{kind:'membership',path:'../data/'}]}}],readers:[{source:'crate/child.rs',declarations:{imports:[],assets:[]}}]};
  writeFileSync(join(root,'declarations.json'),JSON.stringify(manifest));
  const installed=selectorInstalledSdk(),tracked=['crate/lib.rs','crate/child.rs','data/input.txt','Cargo.toml'].map(path=>({path,mode:'100644'}));
  const material=buildRustSelectorMaterial({sourceRoot:root,manifest,inventory:()=>[target],linkage:{packages:[{directory:'',name:'supplied',targets:[target],dependencies:[]}]},declarations:'declarations.json',engine:['crate/lib.rs'],cargoInputs:['Cargo.toml'],tracked:()=>tracked,installed});
  const record=encodeRustSelectorRecord(material),path=join(root,'record.json');writeRustSelectorRecord(path,material);
  const trusted={revision:'a'.repeat(40),blob:'b'.repeat(40),sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};
  const options={roots:{source:root,sdk:installed.root,native:installed.nativeRoot},inventory:[target],tracked,sdk:()=>captureToolchain(installed.root),trusted};
  return {root,path,material,record,options};
}
test('compact records round-trip only consumed roles and bind one accepted body',t=>{
  const f=fixture(t);assert.deepEqual(parseRustSelectorRecord(JSON.parse(readFileSync(f.path,'utf8'))),f.record);
  assert.deepEqual(encodeRustSelectorRecord(f.material),f.record,'pool order is deterministic');
  const result=readRustSelectorRecord(f.path,f.options);assert.equal(result.state,'current');if(result.state!=='current')throw Error('expected current');
  const roles=result.targets[0]!.roles,original=f.material.targets[0]!.roles;
  for(const name of ['files','moduleFiles','placingFiles','byteInputs','optionalFiles','memberships'] as const)assert.deepEqual(roles[name],original[name],name);
  assert.deepEqual(roles.typedDependencies,original.typedDependencies.map(({reader,protocol,dependency})=>({reader,protocol,dependency})));
  assert.ok(!('runtimeFiles'in roles)&&!('observations'in roles)&&!('ownedFiles'in roles));
  roles.files.push('caller mutation');assert.ok(!readFileSync(f.path,'utf8').includes('caller mutation'));
});
test('compact keys notice Cargo input addition, deletion and rename independently of old bytes',t=>{
  const f=fixture(t);
  for(const path of ['.cargo/config.toml','new/Cargo.toml','Cargo.lock','rust-toolchain.toml']){
    const result=validateRustSelectorKey(f.record,{...f.options,tracked:[...f.options.tracked,{path,mode:'100644'}]});
    assert.deepEqual(result,{state:'pending',pending:{kind:'cargo-input-population',path,reason:'tracked Cargo input names changed'}});
  }
  const removed=f.options.tracked.filter(row=>row.path!=='Cargo.toml');
  for(const tracked of [removed,[...removed,{path:'config.txt',mode:'100644'}]])
    assert.deepEqual(validateRustSelectorKey(f.record,{...f.options,tracked}),{state:'pending',pending:{kind:'cargo-input-population',path:'Cargo.toml',reason:'tracked Cargo input names changed'}});
  assert.equal(validateRustSelectorKey(f.record,{...f.options,tracked:[...f.options.tracked,{path:'unrelated.txt',mode:'100644'}]}).state,'key-current');
});
test('negative, byte and candidate answers are freshly checked with honest scope diagnostics',t=>{
  const f=fixture(t);writeFileSync(join(f.root,'data/input.txt'),'changed');
  let result=readRustSelectorRecord(f.path,f.options);assert.equal(result.state,'pending');if(result.state==='pending'){assert.equal(result.pending.kind,'file');assert.match(result.pending.path,/data\/input.txt$/);}
  writeFileSync(join(f.root,'data/input.txt'),'original bytes');mkdirSync(join(f.root,'missing'));writeFileSync(join(f.root,'missing/nested.json'),'{}');
  result=readRustSelectorRecord(f.path,f.options);assert.equal(result.state,'pending');if(result.state==='pending'){assert.equal(result.pending.kind,'runtimeKind');assert.match(result.pending.reason,/missing/);}
  rmSync(join(f.root,'missing'),{recursive:true});mkdirSync(join(f.root,'crate/child'));writeFileSync(join(f.root,'crate/child/mod.rs'),'');
  result=readRustSelectorRecord(f.path,f.options);assert.equal(result.state,'pending');if(result.state==='pending'){assert.equal(result.pending.kind,'rust-candidate');assert.match(result.pending.reason,/child\/mod.rs/);}
});
test('recomputed self hashes cannot authorize a narrowed candidate payload',t=>{
  const f=fixture(t),mutant=structuredClone(f.record);mutant.targets[0]!.files=[];Object.assign(mutant,rustSelectorRecordHashes(mutant));
  assert.equal(validateRustSelectorKey(parseRustSelectorRecord(mutant),f.options).state,'key-current','key validation alone establishes no derivation');
  writeFileSync(f.path,JSON.stringify(mutant)+'\n');const result=readRustSelectorRecord(f.path,f.options);
  assert.equal(result.state,'pending');if(result.state==='pending')assert.equal(result.pending.kind,'unverified-record');
});
test('malformed path graphs, references and hashes refuse instead of becoming pending',t=>{
  const f=fixture(t),cycle=structuredClone(f.record);cycle.paths[0]=interned(['AAAAAAAA','cycle']);Object.assign(cycle,rustSelectorRecordHashes(cycle));
  assert.throws(()=>parseRustSelectorRecord(cycle),/path parent/);
  const escape=structuredClone(f.record);escape.paths.push(interned([escape.paths[0]![0],'..']));Object.assign(escape,rustSelectorRecordHashes(escape));assert.throws(()=>parseRustSelectorRecord(escape),/noncanonical path/);
  const ref=structuredClone(f.record);ref.targets[0]!.files.push('AAAAAAAA');Object.assign(ref,rustSelectorRecordHashes(ref));assert.throws(()=>parseRustSelectorRecord(ref),/ordered block/);
  const payload=structuredClone(f.record);payload.targets[0]!.files=[];assert.throws(()=>parseRustSelectorRecord(payload),/payload hash/);
});
test('ordered blocks preserve repeated role order, complete digests and detached answers',t=>{
  const f=fixture(t),dependency={reader:'crate/lib.rs',protocol:'filesystem' as const,dependency:{path:'data/input.txt',kind:'runtimeKind' as const,bytes:false,directoryStat:false,context:{entry:'<entry>',dataNamespaces:{}}}};
  f.material.targets[0]!.roles.typedDependencies=Array.from({length:257},()=>structuredClone(dependency));
  f.material.targetsSha256=selectorHash(f.material.targets);
  writeRustSelectorRecord(f.path,f.material);f.options.trusted.sha256=createHash('sha256').update(readFileSync(f.path)).digest('hex');
  const encoded=parseRustSelectorRecord(JSON.parse(readFileSync(f.path,'utf8'))),refs=encoded.targets[0]!.typedDependencies;
  assert.ok(new Set(refs).size<refs.length,'identical ordered blocks are shared');
  assert.ok(encoded.lists.every(row=>row.length>1&&row.length<=65));
  assert.equal(typeof encoded.key.files[0]![3],'string');assert.equal((encoded.key.files[0]![3] as string).length,43);
  const current=readRustSelectorRecord(f.path,f.options);assert.equal(current.state,'current');if(current.state!=='current')throw Error('expected current');
  assert.deepEqual(current.targets[0]!.roles,f.material.targets[0]!.roles);
  current.targets[0]!.roles.typedDependencies[0]!.dependency.path='mutated';
  assert.equal(current.targets[0]!.roles.typedDependencies.at(-1)!.dependency.path,'data/input.txt');
});
test('malformed blocks and noncanonical full-width digest encodings refuse',t=>{
  const f=fixture(t);
  for(const block of [[],Array(65).fill('AAAAAAAA'),[-1],[0.5]]){
    const bad=structuredClone(f.record);bad.lists.push(interned(block));Object.assign(bad,rustSelectorRecordHashes(bad));
    assert.throws(()=>parseRustSelectorRecord(bad),/ordered block/);
  }
  const missing=structuredClone(f.record),block=interned(['AAAAAAAA']);missing.lists.push(block);missing.targets[0]!.files=[block[0] as string];
  Object.assign(missing,rustSelectorRecordHashes(missing));assert.throws(()=>parseRustSelectorRecord(missing),/path reference/);
  for(const hash of ['a'.repeat(64),'a'.repeat(42)+'_']){
    const bad=structuredClone(f.record);bad.key.declarations[3]=hash;Object.assign(bad,rustSelectorRecordHashes(bad));
    assert.throws(()=>parseRustSelectorRecord(bad),/canonical base64url SHA256/);
  }
});
test('untrusted block validation reads a repeated dictionary once without expanding its targets',t=>{
  const f=fixture(t),candidate=structuredClone(f.record),first=candidate.lists.find(row=>row[0]===candidate.targets[0]!.files[0])!,path=first[1];let reads=0;
  const values=interned(Array(64).fill(path)),block=new Proxy(values,{get(target,key,receiver){
    if(key==='1'){reads++;assert.ok(reads<=5,'untrusted dictionary repeatedly materialized');}
    return Reflect.get(target,key,receiver);
  }});
  candidate.lists.push(block);candidate.targets[0]!.files=Array(2000).fill(block[0]);
  Object.assign(candidate,rustSelectorRecordHashes(candidate));parseRustSelectorRecord(candidate);assert.equal(reads,5);
});
test('routing IDs retain unaffected paths and rows after an earlier insertion and reject collisions',t=>{
  const f=fixture(t),before=f.record;
  f.material.targets[0]!.roles.files.unshift('aaa/new.ts');
  f.material.targets[0]!.roles.typedDependencies.unshift({reader:'aaa/reader.ts',protocol:'filesystem',dependency:{path:'aaa/new.ts',kind:'runtimeKind',bytes:false,directoryStat:false,context:{entry:'<entry>',dataNamespaces:{}}}});
  const after=encodeRustSelectorRecord(f.material);
  assert.equal(after.keySha256,before.keySha256,'unrelated role paths never enter the key binding hash');
  assert.notEqual(after.targetsSha256,before.targetsSha256,'the complete raw role/path payload remains authenticated');
  for(const name of ['paths','contexts','dependencies','directories','optional','memberships','byteInputs'] as const){
    const rows=new Map(after[name].map(row=>[row[0],row]));for(const row of before[name])assert.deepEqual(rows.get(row[0]),row,name);
  }
  const collision=structuredClone(before);collision.paths.push([...collision.paths[0]!]);Object.assign(collision,rustSelectorRecordHashes(collision));
  assert.throws(()=>parseRustSelectorRecord(collision),/duplicate routing ID/);
  collision.paths.at(-1)![2]='different';Object.assign(collision,rustSelectorRecordHashes(collision));assert.throws(()=>parseRustSelectorRecord(collision),/duplicate routing ID/);
  const changed=structuredClone(before);changed.paths[0]![2]='different';Object.assign(changed,rustSelectorRecordHashes(changed));
  assert.throws(()=>parseRustSelectorRecord(changed),/routing ID\/content mismatch/);
});
test('untrusted files are bounded on their opened descriptor before parsing',t=>{
  const f=fixture(t);truncateSync(f.path,MAX_RUST_SELECTOR_RECORD_BYTES+1);
  assert.throws(()=>readRustSelectorRecord(f.path,{...f.options,trusted:undefined}),/exceeds committed size budget/);
  rmSync(f.path);mkdirSync(f.path);assert.throws(()=>readRustSelectorRecord(f.path,f.options),/not a regular file/);
  rmSync(f.path,{recursive:true});const original=join(f.root,'accepted.json');writeRustSelectorRecord(original,f.material);symlinkSync(original,f.path);
  const result=readRustSelectorRecord(f.path,f.options);assert.equal(result.state,'pending');if(result.state==='pending')assert.equal(result.pending.kind,'record-read');
});
test('compact keys retain alias identity and SDK refusal separately from byte membership',t=>{
  const f=fixture(t),first=join(f.root,'first.txt'),second=join(f.root,'second.txt');writeFileSync(first,'same');writeFileSync(second,'same');symlinkSync('first.txt',join(f.root,'link'));
  // The material owner already has the real link controls. This checks that
  // grouped re-observation retains exact readlink and physical answers too.
  f.material.key.files.push(selectorFile(f.options.roots,join(f.root,'link')));
  f.material.key.facts.push(selectorFact(f.options.roots,{kind:'readlink',path:join(f.root,'link'),value:'first.txt'}));
  f.material.keySha256=selectorHash(f.material.key);
  const record=encodeRustSelectorRecord(f.material);writeFileSync(f.path,JSON.stringify(record)+'\n');
  const options={...f.options,trusted:{...f.options.trusted,sha256:createHash('sha256').update(readFileSync(f.path)).digest('hex')}};
  assert.equal(readRustSelectorRecord(f.path,options).state,'current');
  rmSync(join(f.root,'link'));symlinkSync('second.txt',join(f.root,'link'));
  const result=readRustSelectorRecord(f.path,options);assert.equal(result.state,'pending');if(result.state==='pending'){assert.equal(result.pending.kind,'file');assert.match(result.pending.path,/\/link$/);}
});
test('a real installed SDK byte change invalidates the compact record by capability name',t=>{
  const f=fixture(t),installed=selectorInstalledSdk(),copy=testScratch(t,'compact-selector-sdk'),sdk=join(copy,'node_modules/typescript'),native=join(copy,'node_modules',installed.nativePackage);
  for(const [base,source,files]of [[sdk,installed.root,installed.files],[native,installed.nativeRoot,installed.nativeFiles]] as const)for(const [path,bytes]of files){
    mkdirSync(dirname(join(base,path)),{recursive:true});writeFileSync(join(base,path),bytes);chmodSync(join(base,path),selectorFile(f.options.roots,join(source,path)).mode&0o777);
  }
  const options={...f.options,roots:{...f.options.roots,sdk,native},sdk:()=>captureToolchain(sdk)};
  assert.equal(readRustSelectorRecord(f.path,options).state,'current');
  writeFileSync(join(sdk,'package.json'),readFileSync(join(sdk,'package.json'),'utf8')+' ');
  const result=readRustSelectorRecord(f.path,options);assert.equal(result.state,'pending');if(result.state==='pending'){assert.equal(result.pending.kind,'sdk');assert.equal(result.pending.path,sdk);}
});
