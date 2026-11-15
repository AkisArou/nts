import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseRustRuntimeManifest,bindRustRuntimeDeclarations,cargoRustRuntimeTargets,type RustInputTarget} from './rust-runtime-declarations.ts';

const identity:RustInputTarget={source:'compiler/control/tests/integration.rs',name:'integration',kind:['test']};
const value=()=>({version:1,targets:[{target:{...identity},declarations:{imports:['../helper.ts'],assets:[{kind:'optional-file',path:'../absent.json'},{kind:'membership',path:'..'}]}}]});
const cargo=()=>({version:1,workspace_members:['control'],packages:[{id:'control',manifest_path:'/source/compiler/control/Cargo.toml',targets:[
  {test:true,doctest:false,name:identity.name,kind:[...identity.kind],src_path:'/source/'+identity.source},
  {test:false,doctest:false,name:'build-script',kind:['custom-build'],src_path:'/source/compiler/control/build.rs'},
]}]});

test('runtime targets consume the crate owner metadata without rediscovering Cargo identities',()=>{
  const metadata=cargo(),groups=cargoRustRuntimeTargets(metadata,'/source');
  const runtimeIdentity={...identity,unitTests:true,doctests:false};
  assert.deepEqual([...groups],[['compiler/control',[runtimeIdentity]]]);
  assert.deepEqual([...bindRustRuntimeDeclarations(parseRustRuntimeManifest(value()),[...groups.values()].flat()).keys()],[identity.source]);
  metadata.packages.push({id:'dependency',manifest_path:'/outside/Cargo.toml',targets:[{test:true,doctest:true,name:'foreign',kind:['lib'],src_path:'/outside/lib.rs'}]});
  assert.deepEqual([...cargoRustRuntimeTargets(metadata,'/source')],[['compiler/control',[runtimeIdentity]]]);
  const changed=cargo();changed.packages[0]!.targets[0]!.test=false;
  assert.deepEqual([...cargoRustRuntimeTargets(changed,'/source')],[['compiler/control',[]]]);
});

test('library doctest owners remain when unit tests are disabled',()=>{
  const metadata=cargo(),entry=metadata.packages[0]!.targets[0]!;
  entry.test=false;entry.doctest=true;entry.kind=['lib'];
  assert.deepEqual([...cargoRustRuntimeTargets(metadata,'/source')],[['compiler/control',[{...identity,kind:['lib'],unitTests:false,doctests:true}]]]);
  entry.doctest=false;assert.deepEqual([...cargoRustRuntimeTargets(metadata,'/source')],[['compiler/control',[]]]);
  entry.doctest=true;entry.kind=['bin'];assert.deepEqual([...cargoRustRuntimeTargets(metadata,'/source')],[['compiler/control',[]]],'doctest has no effect on non-library targets');
  const missing=structuredClone(metadata) as unknown as {version:number;workspace_members:string[];packages:{id:string;manifest_path:string;targets:unknown[]}[]};
  missing.packages[0]!.targets=[{test:true,name:'test',kind:['test'],src_path:'/source/test.rs'}];
  assert.throws(()=>cargoRustRuntimeTargets(missing,'/source'),/target has no doctest setting/);
});

test('Cargo target inventory refuses unsupported, omitted, ambiguous and escaped owners',()=>{
  assert.throws(()=>cargoRustRuntimeTargets({...cargo(),version:2},'/source'),/unsupported Cargo metadata version/);
  assert.throws(()=>cargoRustRuntimeTargets(cargo(),'relative'),/source root is not absolute/);
  assert.throws(()=>cargoRustRuntimeTargets({...cargo(),workspace_members:['missing']},'/source'),/workspace member has no package/);
  assert.throws(()=>cargoRustRuntimeTargets({...cargo(),workspace_members:['control','control']},'/source'),/duplicate Cargo workspace member/);
  const duplicate=cargo();duplicate.packages[0]!.targets.push({...duplicate.packages[0]!.targets[0]!});
  assert.throws(()=>cargoRustRuntimeTargets(duplicate,'/source'),/ambiguous Cargo source owner/);
  const escaped=cargo();escaped.packages[0]!.targets[0]!.src_path='/outside/test.rs';
  assert.throws(()=>cargoRustRuntimeTargets(escaped,'/source'),/not repository-relative/);
  const missing=cargo() as unknown as {version:number;workspace_members:string[];packages:{id:string;manifest_path:string;targets:unknown[]}[]};
  missing.packages[0]!.targets=[{name:'test',kind:['test'],src_path:'/source/test.rs'}];
  assert.throws(()=>cargoRustRuntimeTargets(missing,'/source'),/target has no test setting/);
});

test('portable Rust declarations retain the shared reader rows and bind actual Cargo identities',()=>{
  const manifest=parseRustRuntimeManifest(value()),bound=bindRustRuntimeDeclarations(manifest,[identity]);
  assert.deepEqual(bound.get(identity.source),{imports:['../helper.ts'],assets:[{kind:'optional-file',path:'../absent.json'},{kind:'membership',path:'..'}]});
  assert.throws(()=>bindRustRuntimeDeclarations(manifest,[]),/declaration has no Cargo target: compiler\/control\/tests\/integration.rs/);
  assert.throws(()=>bindRustRuntimeDeclarations({version:1,targets:[]},[identity]),/Cargo target lacks runtime declarations/);
  assert.throws(()=>bindRustRuntimeDeclarations(manifest,[identity,identity]),/ambiguous Cargo source owner/);
  assert.throws(()=>bindRustRuntimeDeclarations(manifest,[{...identity,name:'other'}]),/Cargo target mismatch/);
  assert.throws(()=>bindRustRuntimeDeclarations(manifest,[{...identity,kind:['lib']}]),/Cargo target mismatch/);
});

test('unknown declaration fields and ambiguous or nonportable identities refuse by name',()=>{
  assert.throws(()=>parseRustRuntimeManifest({...value(),version:2}),/unsupported manifest version 2/);
  assert.throws(()=>parseRustRuntimeManifest({...value(),guess:[]}),/unknown field guess/);
  const duplicate=value();duplicate.targets.push(duplicate.targets[0]!);
  assert.throws(()=>parseRustRuntimeManifest(duplicate),/duplicate source owner/);
  for(const source of ['/outside.rs','../outside.rs','compiler//control.rs','compiler/./control.rs']){
    const supplied=value();supplied.targets[0]!.target.source=source;
    assert.throws(()=>parseRustRuntimeManifest(supplied),/repository-relative/);
  }
  const unknown=value();unknown.targets[0]!.declarations.assets[0]!.kind='guessed-directory';
  assert.throws(()=>parseRustRuntimeManifest(unknown),/unknown input kind guessed-directory/);
  const absolute=value();absolute.targets[0]!.declarations.imports=['/outside.ts'];
  assert.throws(()=>parseRustRuntimeManifest(absolute),/literal relative input/);
});

test('shallow candidate declarations retain distinct existence and byte roles',()=>{
  const candidates=[{name:'ref.cpp',kind:'path-exists'},{name:'ref.cpp',kind:'file-exists'},{name:'ref.provenance.json',kind:'optional-file'}];
  const supplied={version:1,targets:[{target:identity,declarations:{imports:[],assets:[{kind:'directory-candidates',path:'../cases',candidates}]}}]};
  assert.deepEqual(parseRustRuntimeManifest(supplied).targets[0]!.declarations.assets,supplied.targets[0]!.declarations.assets);
  for(const row of [{name:'../escape',kind:'path-exists'},{name:'ref.cpp',kind:'unknown'},{name:'ref.cpp',kind:'path-exists',extra:true}])
    assert.throws(()=>parseRustRuntimeManifest({...supplied,targets:[{target:identity,declarations:{imports:[],assets:[{kind:'directory-candidates',path:'../cases',candidates:[row]}]}}]}),/candidate/);
});

test('shared choosing readers use the same rows and cannot duplicate Cargo source ownership',()=>{
  const supplied={...value(),readers:[{source:'compiler/control/tests/case.rs',declarations:{imports:[],assets:[{kind:'project-config',path:'../../../fixture/tsconfig.json'}]}}]};
  supplied.targets[0]!.declarations.imports=['./case.rs'];
  const manifest=parseRustRuntimeManifest(supplied),bound=bindRustRuntimeDeclarations(manifest,[identity]);
  assert.equal(bound.size,2);assert.deepEqual(bound.get(supplied.readers[0]!.source),supplied.readers[0]!.declarations);
  const duplicate=structuredClone(supplied);duplicate.readers[0]!.source=identity.source;
  assert.throws(()=>parseRustRuntimeManifest(duplicate),/duplicate source owner/);
  assert.throws(()=>parseRustRuntimeManifest({...supplied,readers:{}}),/shared readers are not an array/);
  const escaped=structuredClone(supplied);escaped.readers[0]!.source='../outside.rs';
  assert.throws(()=>parseRustRuntimeManifest(escaped),/repository-relative/);
});


test('optional project member selection is literal and retains an empty all-member prefix',()=>{
  const supplied={...value(),readers:[{source:'compiler/control/case.rs',declarations:{imports:[],assets:[{kind:'project-members',path:'./projects/',prefix:'',optional:true}]}}]};
  assert.deepEqual(parseRustRuntimeManifest(supplied).readers![0]!.declarations.assets,supplied.readers[0]!.declarations.assets);
  for(const options of [{prefix:'../escape',optional:true},{prefix:'',optional:false},{prefix:'',optional:'true'}]){
    const invalid=structuredClone(supplied) as unknown as {readers:{declarations:{assets:Record<string,unknown>[]}}[]};
    Object.assign(invalid.readers[0]!.declarations.assets[0]!,options);
    assert.throws(()=>parseRustRuntimeManifest(invalid),/project member/);
  }
});
