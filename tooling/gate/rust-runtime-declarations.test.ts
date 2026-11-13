import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseRustRuntimeManifest,bindRustRuntimeDeclarations,type RustInputTarget} from './rust-runtime-declarations.ts';

const identity:RustInputTarget={source:'compiler/control/tests/integration.rs',name:'integration',kind:['test']};
const value=()=>({version:1,targets:[{target:{...identity},declarations:{imports:['../helper.ts'],assets:[{kind:'optional-file',path:'../absent.json'},{kind:'membership',path:'..'}]}}]});

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
