import assert from'node:assert/strict';
import{mkdirSync,writeFileSync,appendFileSync}from'node:fs';
import{join}from'node:path';
import{test,type TestContext}from'node:test';
import{testScratch}from'./test-scratch.ts';
import{checkTestLayout,listedTestRows,compareInventories,type CargoPackage,type TestInventory}from'./test-layout.ts';

function fixture(t:TestContext){
  const root=testScratch(t,'rust-layout'),directory=join(root,'sample'),tests=join(directory,'tests');mkdirSync(tests,{recursive:true});
  const manifest=join(directory,'Cargo.toml'),entry=join(tests,'integration.rs');
  writeFileSync(manifest,'[package]\nname = "sample"\nautotests = false\n\n[[test]]\nname = "integration"\npath = "tests/integration.rs"\n');
  for(const name of ['alpha','beta'])writeFileSync(join(tests,name+'.rs'),'#[test]\nfn same_name() {}\n');
  writeFileSync(entry,'#[path = "alpha.rs"]\nmod alpha;\n#[path = "beta.rs"]\nmod beta;\n');
  const pkg:CargoPackage={id:'sample-id',name:'sample',manifest_path:manifest,targets:[{kind:['test'],name:'integration',src_path:entry}]};
  return {root,tests,manifest,entry,pkg,check:()=>checkTestLayout(root,[pkg])};
}

test('one explicit harness owns every case once, with no body or conditional wrapper',t=>{
  const f=fixture(t),layout=f.check();assert.deepEqual(layout.problems,[]);assert.equal(layout.harnesses.length,1);
  assert.deepEqual(layout.harnesses[0]!.cases.map(item=>item.name),['alpha','beta']);
  appendFileSync(f.entry,'#[cfg(any())]\n');assert.match(f.check().problems.join('\n'),/only unconditional/);
});

test('an unowned new case is rejected before Cargo can silently omit it',t=>{
  const f=fixture(t);writeFileSync(join(f.tests,'forgotten.rs'),'#[test]\nfn omitted() {}\n');
  assert.match(f.check().problems.join('\n'),/forgotten.rs has 0 owners/);
});

test('shared test-support modules are owned once by the harness',t=>{
  const f=fixture(t);mkdirSync(join(f.tests,'support'));writeFileSync(join(f.tests,'support','common.rs'),'pub(crate) fn helper() {}\n');
  const declaration='#[path = "support/common.rs"]\nmod common;\n';appendFileSync(f.entry,declaration);
  assert.deepEqual(f.check().problems,[]);assert.equal(f.check().harnesses[0]!.helpers.length,1);
  appendFileSync(f.entry,declaration);assert.match(f.check().problems.join('\n'),/shared helper is compiled twice/);
});

test('a case included twice is rejected even under another module name',t=>{
  const f=fixture(t);appendFileSync(f.entry,'#[path = "alpha.rs"]\nmod alpha;\n');
  assert.match(f.check().problems.join('\n'),/alpha.rs has 2 owners/);
});

test('auto discovery and a new per-file Cargo target cannot restore the old layout',t=>{
  const f=fixture(t);writeFileSync(f.manifest,'[package]\nname = "sample"\nautotests = true\n');
  f.pkg.targets.push({kind:['test'],name:'alpha',src_path:join(f.tests,'alpha.rs')});
  const problems=f.check().problems.join('\n');assert.match(problems,/autotests = false/);assert.match(problems,/unexpected Cargo test target alpha/);
});

test('core must retain its complete declared topic set',t=>{
  const f=fixture(t);f.pkg.name='nts-core';assert.match(f.check().problems.join('\n'),/integration_scalars.*integration_modules/);
});

test('compiled listings retain the original case path, nested names and package identity',t=>{
  const f=fixture(t),layout=f.check(),target=f.pkg.targets[0]!;
  const rows=listedTestRows(f.root,f.pkg,target,'alpha::nested::same_name: test\nbeta::same_name: test\n',layout);
  assert.deepEqual(rows.map(row=>[row.crate,row.file,row.name]),[
    ['sample','sample/tests/alpha.rs','nested::same_name'],['sample','sample/tests/beta.rs','same_name'],
  ]);
  const before:TestInventory={version:1,rows},after:TestInventory={version:1,rows:[...rows]};
  assert.deepEqual(compareInventories(before,after),[]);
  assert.equal(compareInventories(before,{version:1,rows:[rows[0]!]}).length,1);
  assert.equal(compareInventories(before,{version:1,rows:[...rows,rows[0]!]}).length,1);
  assert.equal(compareInventories(before,{version:1,rows:rows.map(row=>({...row,crate:'other'}))}).length,4);
  assert.throws(()=>listedTestRows(f.root,f.pkg,target,'unowned::same_name: test\n',layout),/no case owner/);
});
