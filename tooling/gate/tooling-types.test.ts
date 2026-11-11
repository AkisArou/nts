import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {API} from 'typescript/sync';
import {checkToolingTypes,diagnosticChanges,parseDiagnosticRecord,strictProjectProblems,writeDiagnosticRecord,type DiagnosticRecord} from './tooling-types.ts';
import {testScratch} from './test-scratch.ts';

const source=fileURLToPath(new URL('../..',import.meta.url));
function fixture(t:{after(fn:()=>void):void}):string {
  const root=testScratch(t,'tooling-types');mkdirSync(join(root,'tooling'));
  const project=JSON.parse(readFileSync(join(source,'tooling/tsconfig.json'),'utf8'));
  project.extends=join(source,'tsconfig.base.json');project.compilerOptions.types=[];
  writeFileSync(join(root,'tooling/tsconfig.json'),JSON.stringify(project));return root;
}

test('new diagnostic modules and rising recorded counts fail; only the tool records improvements',t=>{
  const root=fixture(t),file=join(root,'tooling/subject.ts'),recordFile=join(root,'counts.json');
  writeFileSync(file,'export const answer:number="wrong";');
  const first=checkToolingTypes(root);assert.deepEqual(first.problems,[]);assert.equal(first.counts['tooling/subject.ts'],1);
  assert.match(diagnosticChanges(first.counts,{version:1,modules:{}}).problems[0]!,/rose from 0 to 1/);
  writeDiagnosticRecord(recordFile,first);
  const baseline=parseDiagnosticRecord(JSON.parse(readFileSync(recordFile,'utf8')));
  writeFileSync(file,'export const answer:number="wrong"; export const other:number="also wrong";');
  const raised=checkToolingTypes(root);
  assert.throws(()=>writeDiagnosticRecord(recordFile,raised,baseline),/rose from 1 to 2/);
  assert.deepEqual(parseDiagnosticRecord(JSON.parse(readFileSync(recordFile,'utf8'))),baseline);
  writeFileSync(file,'export const answer:number=1;');
  const clean=checkToolingTypes(root);assert.deepEqual(diagnosticChanges(clean.counts,baseline).problems,[]);
  writeDiagnosticRecord(recordFile,clean,baseline);
  assert.deepEqual(parseDiagnosticRecord(JSON.parse(readFileSync(recordFile,'utf8'))),{version:1,modules:{}});
});

test('every .mjs module is checked and an omitted module cannot disappear from the inventory',t=>{
  const root=fixture(t),file=join(root,'tooling/subject.mjs');writeFileSync(file,'const value=1;value();export {};');
  const checked=checkToolingTypes(root);assert.ok(checked.counts['tooling/subject.mjs']);
  const project=JSON.parse(readFileSync(join(root,'tooling/tsconfig.json'),'utf8'));
  project.include=['**/*.ts'];writeFileSync(join(root,'tooling/tsconfig.json'),JSON.stringify(project));
  assert.ok(checkToolingTypes(root).problems.some(problem=>problem.includes('missing from the strict project: tooling/subject.mjs')));
});

test('weak flags and a file-level no-check pragma cannot suppress the ratchet',t=>{
  const root=fixture(t);writeFileSync(join(root,'tooling/subject.ts'),'// @ts-nocheck\nexport const value:number="wrong";');
  assert.ok(checkToolingTypes(root).problems.some(problem=>problem.includes('disables type checking')));
  const project=JSON.parse(readFileSync(join(root,'tooling/tsconfig.json'),'utf8'));
  const api=new API({cwd:root});try{
    const options=api.parseConfigFile(join(root,'tooling/tsconfig.json')).options;
    assert.deepEqual(strictProjectProblems(options as Record<string,unknown>),[]);
    for(const flag of ['strict','checkJs','allowJs','noUncheckedIndexedAccess'])
      assert.ok(strictProjectProblems({...options,[flag]:false}).some(problem=>problem.includes(flag)));
    assert.ok(strictProjectProblems({...options,noCheck:true}).length);
  }finally{api.close();}
  assert.equal(project.compilerOptions.checkJs,true);
});

test('the fixture base excludes root tooling while child projects still discover their own sources',t=>{
  const root=testScratch(t,'fixture-config-discovery');
  const base=JSON.parse(readFileSync(join(source,'tsconfig.fixtures.json'),'utf8'));
  writeFileSync(join(root,'tsconfig.fixtures.json'),JSON.stringify(base));
  mkdirSync(join(root,'tooling'));writeFileSync(join(root,'tooling/instrument.ts'),'export const value=1;');
  mkdirSync(join(root,'fixture/src'),{recursive:true});writeFileSync(join(root,'fixture/src/main.ts'),'export const value=1;');
  writeFileSync(join(root,'fixture/tsconfig.json'),JSON.stringify({extends:'../tsconfig.fixtures.json'}));
  const api=new API({cwd:root});try{
    const parent=api.parseConfigFile(join(root,'tsconfig.fixtures.json'));
    assert.ok(!parent.fileNames.some(file=>file===join(root,'tooling/instrument.ts')));
    const child=api.parseConfigFile(join(root,'fixture/tsconfig.json'));
    assert.ok(child.fileNames.some(file=>file===join(root,'fixture/src/main.ts')));
  }finally{api.close();}
});

test('the record schema accepts only positive per-module counts',()=>{
  const record:DiagnosticRecord={version:1,modules:{'tooling/legacy.ts':3}};
  assert.deepEqual(parseDiagnosticRecord(record),record);
  for(const value of [{version:2,modules:{}},{version:1,modules:{'outside.ts':1}},{version:1,modules:{'tooling/legacy.ts':-1}}])
    assert.throws(()=>parseDiagnosticRecord(value),/invalid tooling diagnostic/);
});

test('product imports are resolved but their diagnostics belong to their own projects',t=>{
  const root=fixture(t);mkdirSync(join(root,'runtime'));
  writeFileSync(join(root,'runtime/product.ts'),'export const value:number="wrong";');
  writeFileSync(join(root,'tooling/subject.ts'),'import {value} from "../runtime/product.ts";export const answer:number=value;');
  const checked=checkToolingTypes(root);assert.deepEqual(checked.problems,[]);assert.deepEqual(checked.counts,{});
});
