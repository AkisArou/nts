import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {test} from 'node:test';
import {moduleGraph} from './module-closure.ts';
import {directoryCandidates,type DirectoryCandidate} from './reader-inputs/main.ts';
import {readerObservationIndex,readerObservationDependency,validateReaderSourceObservations} from './reader-observations.ts';
import {copyModuleClosure} from './module-closure-fixture.ts';
import {testScratch} from './test-scratch.ts';

function fixture(t:Parameters<typeof testScratch>[0],candidates:readonly DirectoryCandidate[]){
  const base=testScratch(t,'directory-candidates'),source=join(base,'source');
  mkdirSync(join(source,'cases/one'),{recursive:true});mkdirSync(join(source,'cases/two'));
  writeFileSync(join(source,'reader.rs'),'');writeFileSync(join(source,'cases/note.txt'),'not a directory');
  const declarations=new Map([['reader.rs',{imports:[],assets:[{...directoryCandidates(pathToFileURL(join(source,'cases')),candidates),path:'./cases/'}]}]]);
  const describe=()=>{const graph=moduleGraph({sourceRoot:source,declarations});try{return graph.describe(['reader.rs']);}finally{graph.close();}};
  return {base,source,declarations,describe};
}

test('shallow directory candidates keep optional bytes separate from followed metadata and placement',t=>{
  const f=fixture(t,[{name:'meta.json',kind:'optional-file'},{name:'ref.cpp',kind:'path-exists'},{name:'ref.cpp',kind:'file-exists'}]);
  writeFileSync(join(f.source,'cases/one/meta.json'),'metadata');writeFileSync(join(f.source,'cases/one/ref.cpp'),'reference');
  const snapshot=f.describe();
  assert.deepEqual(snapshot.files,['cases/one/meta.json','reader.rs']);assert.deepEqual(snapshot.moduleFiles,['reader.rs']);assert.deepEqual(snapshot.placingFiles,['reader.rs']);
  assert.equal(snapshot.memberships.length,1);assert.equal(snapshot.optionalFiles.length,2);
  assert.ok(snapshot.observations.every(row=>row.protocol==='filesystem'));
  assert.ok(snapshot.observations.some(row=>row.observation.kind==='directoryExists'&&row.observation.path===join(f.source,'cases/note.txt')&&row.observation.value===false));
  assert.ok(!snapshot.observations.some(row=>row.observation.path.startsWith(join(f.source,'cases/note.txt')+'/')));
  assert.ok(!snapshot.observations.some(row=>row.observation.kind==='file'||row.observation.kind==='stat'));
  const tracked=['reader.rs','cases/note.txt','cases/one/meta.json','cases/one/ref.cpp'];
  const index=readerObservationIndex(f.source,snapshot.observations,tracked);
  assert.equal(index.affected([{path:'cases/one/ref.cpp',sameMode:true}]).size,0);
  assert.ok(snapshot.observations.every(row=>!readerObservationDependency(f.source,row)?.bytes));
  validateReaderSourceObservations(snapshot,f.source);
});

test('path existence distinguishes a directory, absence and dangling or retargeted links',t=>{
  const f=fixture(t,[{name:'ref.cpp',kind:'path-exists'},{name:'ref.cpp',kind:'file-exists'}]);
  const ref=join(f.source,'cases/one/ref.cpp');mkdirSync(ref);
  const directory=f.describe();
  assert.ok(directory.observations.some(row=>row.observation.kind==='runtimeKind'&&row.observation.path===ref&&row.observation.value==='directory'));
  assert.ok(directory.observations.some(row=>row.observation.kind==='fileExists'&&row.observation.path===ref&&row.observation.value===false));
  rmSync(ref,{recursive:true});assert.throws(()=>validateReaderSourceObservations(directory,f.source),/runtimeKind changed/);
  const absent=f.describe();assert.ok(absent.observations.some(row=>row.observation.kind==='runtimeKind'&&row.observation.path===ref&&row.observation.value===null));
  symlinkSync('../missing',ref);const dangling=f.describe();
  assert.ok(dangling.observations.some(row=>row.observation.kind==='readlink'&&row.observation.path===ref));
  assert.ok(dangling.observations.some(row=>row.observation.kind==='runtimeKind'&&row.observation.path===join(f.source,'cases/missing')&&row.observation.value===null));
  writeFileSync(join(f.source,'cases/target'),'target');rmSync(ref);symlinkSync('../target',ref);
  assert.throws(()=>validateReaderSourceObservations(dangling,f.source),/readlink changed|fileExists changed/);
  const linked=f.describe();validateReaderSourceObservations(linked,f.source);
  const index=readerObservationIndex(f.source,linked.observations,['reader.rs','cases/one/ref.cpp','cases/target']);
  assert.ok(index.affected([{path:'cases/target',deleted:true}]).size>0);
  assert.equal(index.affected([{path:'cases/target',sameMode:true}]).size,0);
});

test('an empty candidate list retains the actual followed directory filter without child bytes',t=>{
  const f=fixture(t,[]),link=join(f.source,'cases/alias');symlinkSync('one',link);
  const before=f.describe();assert.deepEqual(before.files,['reader.rs']);assert.deepEqual(before.optionalFiles,[]);
  assert.ok(before.observations.some(row=>row.observation.kind==='directoryExists'&&row.observation.path===link&&row.observation.value===true));
  rmSync(link);symlinkSync('note.txt',link);
  assert.throws(()=>validateReaderSourceObservations(before,f.source),/directoryExists changed|readlink changed/);
  assert.ok(f.describe().observations.some(row=>row.observation.kind==='directoryExists'&&row.observation.path===link&&row.observation.value===false));
});

test('copier stages genuine optional bytes but cannot fabricate collection metadata',t=>{
  const f=fixture(t,[{name:'meta.json',kind:'optional-file'},{name:'ref.cpp',kind:'path-exists'}]);
  writeFileSync(join(f.source,'cases/one/meta.json'),'metadata');mkdirSync(join(f.source,'cases/one/ref.cpp'));
  const destination=join(f.base,'destination');mkdirSync(join(destination,'cases/one'),{recursive:true});mkdirSync(join(destination,'cases/two'));writeFileSync(join(destination,'cases/note.txt'),'private metadata child');
  assert.throws(()=>copyModuleClosure(['reader.rs'],destination,{sourceRoot:f.source,declarations:f.declarations}),/fixture reader observation is not portable: reader.rs \[filesystem\] runtimeKind/);
  assert.equal(existsSync(join(destination,'cases/one/ref.cpp')),false);
  mkdirSync(join(destination,'cases/one/ref.cpp'));
  assert.deepEqual(copyModuleClosure(['reader.rs'],destination,{sourceRoot:f.source,declarations:f.declarations}),['cases/one/meta.json','reader.rs']);
  assert.equal(existsSync(join(destination,'cases/two/meta.json')),false);
});
