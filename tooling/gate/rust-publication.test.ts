import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inspectRustPublication,publicationTestFiles} from './rust-publication.ts';

test('production filesystem renames and aliases require the one publication owner',()=>{
  for(const source of [
    'fn publish(){std::fs::rename(a,b);}',
    'use std::fs; fn publish(){fs::rename(a,b);}',
    'use std::fs as disk; fn publish(){disk::rename(a,b);}',
    'use std::{fs::{rename as move_file}}; fn publish(){move_file(a,b);}',
    'fn publish(){let move_file=std::fs::rename;move_file(a,b);}',
    'use std::fs::*; fn publish(){rename(a,b);}',
    '#[cfg(any(test,windows))] fn publish(){std::fs::rename(a,b);}',
    '#[cfg(not(test))] fn publish(){std::fs::rename(a,b);}',
  ])assert.ok(inspectRustPublication('tooling/producer/src/lib.rs',source).length,source);
});

test('test-only mutations, literals and unrelated rename methods grant no production exception',()=>{
  for(const source of [
    '#[cfg(test)] mod tests {fn control(){std::fs::rename(a,b);}}',
    '#[cfg(all(unix,test))] fn control(){std::fs::rename(a,b);}',
    '#[test] fn control(){std::fs::rename(a,b);}',
    'fn production(){self.rename(a,b);let text=r#"std::fs::rename(a,b)"#;} // std::fs::rename(a,b)',
    'fn production(){nts_publication::write(path,bytes);}',
  ])assert.deepEqual(inspectRustPublication('tooling/producer/src/lib.rs',source),[],source);
  assert.deepEqual(inspectRustPublication('tooling/producer/tests/control.rs','std::fs::rename(a,b);',true),[]);
  assert.deepEqual(inspectRustPublication('tooling/publication/src/lib.rs','std::fs::rename(a,b);'),[]);
  assert.ok(inspectRustPublication('tooling/publication-neighbour/src/lib.rs','std::fs::rename(a,b);').length);
});

test('external cfg-test modules inherit test ownership while a test-like filename grants none',()=>{
  const files=new Map([
    ['crate/src/lib.rs','#[cfg(test)] mod control; mod production_test;'],
    ['crate/src/control.rs','mod child;'],['crate/src/control/child.rs','std::fs::rename(a,b);'],
    ['crate/src/production_test.rs','std::fs::rename(a,b);'],
  ]);
  const tests=publicationTestFiles(files,new Set());assert.ok(tests.has('crate/src/control.rs'));assert.ok(tests.has('crate/src/control/child.rs'));assert.ok(!tests.has('crate/src/production_test.rs'));
  assert.ok(inspectRustPublication('crate/src/production_test.rs',files.get('crate/src/production_test.rs')!).length);
});
