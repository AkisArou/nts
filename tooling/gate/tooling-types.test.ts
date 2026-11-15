import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {API} from 'typescript/sync';
import {checkToolingTypes,checkTypeProjects,checkTypeProject,typeProjectSourceKey,typeRecordChanges,writeTypeProjectRecord,
  strictProjectProblems,type TypeCheckResult} from './tooling-types.ts';
import {serializeDiagnosticRecord,parseDiagnosticRecord,TOOLING_PROJECT,type DiagnosticRecord} from './tooling-type-records.ts';
import {TYPE_PROJECTS,typeProjectName,type TypeProject} from './tooling-type-projects.ts';
import {testScratch} from './test-scratch.ts';
const source=fileURLToPath(new URL('../..',import.meta.url));
function put(root:string,file:string,text:string):void{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text);}
function project(root:string,name:string,files:string[],extra:Record<string,unknown>={}):void{
  put(root,name,JSON.stringify({extends:join(source,'tsconfig.base.json'),compilerOptions:{rootDir:root,types:[],allowJs:true,checkJs:true,noCheck:false,composite:false,incremental:false,declaration:false,declarationMap:false,emitDeclarationOnly:false,noEmit:true,...extra},files:files.map(file=>join(root,file))}));
}
function fixture(t:{after(fn:()=>void):void}):string{
  const root=testScratch(t,'project-types');put(root,'tooling/subject.ts','export const value=1;');project(root,TOOLING_PROJECT,['tooling/subject.ts']);return root;
}
const empty=():DiagnosticRecord=>({version:2,projects:{}});
const checked=(root:string,definitions:readonly TypeProject[]=[TYPE_PROJECTS[0]!])=>checkTypeProjects(root,definitions);

test('new projects are pending; existing module counts may only fall, including on record',t=>{
  const root=fixture(t),file=join(root,'tooling/subject.ts'),path=join(root,'counts.json');writeFileSync(file,'export const value:number="wrong";');
  const first=checked(root);assert.deepEqual(first.problems,[]);assert.equal(first.projects[TOOLING_PROJECT]!.counts['tooling/subject.ts'],1);
  assert.deepEqual(typeRecordChanges(first,empty()).pending,[TOOLING_PROJECT]);writeTypeProjectRecord(path,first,empty(),true);
  const before=readFileSync(path,'utf8'),record=parseDiagnosticRecord(JSON.parse(before));
  writeFileSync(file,'export const value:number="wrong";export const other:number="also wrong";');const raised=checked(root);
  assert.match(typeRecordChanges(raised,record).problems.join('\n'),/rose from 1 to 2/);assert.throws(()=>writeTypeProjectRecord(path,raised,record),/rose from 1 to 2/);assert.equal(readFileSync(path,'utf8'),before);
  writeFileSync(file,'export const value:number=1;');const improved=checked(root);assert.deepEqual(typeRecordChanges(improved,record).problems,[]);writeTypeProjectRecord(path,improved,record);
  const next=parseDiagnosticRecord(JSON.parse(readFileSync(path,'utf8')));assert.deepEqual(next.projects[TOOLING_PROJECT]!.counts,{});assert.deepEqual(next.projects[TOOLING_PROJECT]!.modules,['tooling/subject.ts']);
});

test('a recorded project or zero-diagnostic module cannot disappear during checking or publication',t=>{
  const root=fixture(t),first=checked(root),path=join(root,'counts.json');writeTypeProjectRecord(path,first,empty(),true);const previous=parseDiagnosticRecord(JSON.parse(readFileSync(path,'utf8')));
  const dropped:TypeCheckResult={root,projects:{},problems:[]};assert.match(typeRecordChanges(dropped,previous).problems.join('\n'),/project was dropped/);assert.throws(()=>writeTypeProjectRecord(path,dropped,previous),/project was dropped/);
  put(root,'tooling/new.ts','export const added=1;');project(root,TOOLING_PROJECT,['tooling/subject.ts','tooling/new.ts']);
  const added=checked(root);assert.deepEqual(typeRecordChanges(added,previous).problems,[]);writeTypeProjectRecord(path,added,previous);const all=parseDiagnosticRecord(JSON.parse(readFileSync(path,'utf8')));
  project(root,TOOLING_PROJECT,['tooling/new.ts']);const missing=checked(root);assert.match(missing.problems.join('\n'),/missing from its strict project: tooling\/subject.ts/);assert.throws(()=>writeTypeProjectRecord(path,missing,all),/missing from its strict project/);
});

test('a genuinely deleted source leaves the inventory while a still-present omitted source refuses',t=>{
  const root=fixture(t),path=join(root,'counts.json'),file='tooling/subject.ts';
  put(root,file,'export const value:number="wrong";');put(root,'tooling/kept.ts','export const kept=1;');project(root,TOOLING_PROJECT,[file,'tooling/kept.ts']);
  const first=checked(root);writeTypeProjectRecord(path,first,empty(),true);const previous=parseDiagnosticRecord(JSON.parse(readFileSync(path,'utf8')));
  project(root,TOOLING_PROJECT,['tooling/kept.ts']);const omitted=checked(root);assert.throws(()=>writeTypeProjectRecord(path,omitted,previous),/missing from its strict project/);
  unlinkSync(join(root,file));const removed=checked(root);assert.deepEqual(typeRecordChanges(removed,previous).problems,[]);writeTypeProjectRecord(path,removed,previous);
  const next=parseDiagnosticRecord(JSON.parse(readFileSync(path,'utf8')));assert.deepEqual(next.projects[TOOLING_PROJECT]!.modules,['tooling/kept.ts']);assert.deepEqual(next.projects[TOOLING_PROJECT]!.counts,{});
});

test('the JS population comes from every bindings.node.mjs and cannot be disabled or excluded',t=>{
  const root=fixture(t),definition=TYPE_PROJECTS.find(row=>row.policy==='javascript')!,name=typeProjectName(definition),file='runtime/node/private/bindings.node.mjs';
  put(root,file,'const value=1;value();export {};');project(root,name,[file]);const first=checked(root,[definition]);
  assert.deepEqual(first.problems,[]);assert.ok(first.projects[name]!.counts[file]);
  project(root,name,[file],{checkJs:false});assert.match(checked(root,[definition]).problems.join('\n'),/checkJs=true/);
  put(root,'runtime/node/empty.ts','export {};');project(root,name,['runtime/node/empty.ts']);assert.match(checked(root,[definition]).problems.join('\n'),/module missing from its strict project: runtime\/node\/private\/bindings.node.mjs/);
});

test('project contexts cannot exchange counts for the same product file',t=>{
  const root=fixture(t),one={...TYPE_PROJECTS[2]!,population:[]},two={...TYPE_PROJECTS[5]!,population:[]},file='runtime/shared/subject.ts';
  put(root,file,'export const answer:Side=1;');put(root,'runtime/shared/number.d.ts','declare type Side=number;');put(root,'runtime/shared/string.d.ts','declare type Side=string;');
  project(root,typeProjectName(one),[file,'runtime/shared/number.d.ts']);project(root,typeProjectName(two),[file,'runtime/shared/string.d.ts']);
  const first=checked(root,[one,two]);assert.deepEqual(first.problems,[]);assert.equal(first.projects[typeProjectName(one)]!.counts[file],undefined);assert.equal(first.projects[typeProjectName(two)]!.counts[file],1);
  const path=join(root,'counts.json');writeTypeProjectRecord(path,first,empty(),true);const previous=parseDiagnosticRecord(JSON.parse(readFileSync(path,'utf8')));
  put(root,file,'export const answer:Side="one";');const next=checked(root,[one,two]);assert.equal(next.projects[typeProjectName(two)]!.counts[file],undefined);assert.match(typeRecordChanges(next,previous).problems.join('\n'),/rose from 0 to 1/);
});

test('a binding byte edit changes the complete input identity and is checked again without resetting its floor',t=>{
  const root=fixture(t),definition=TYPE_PROJECTS.find(row=>row.policy==='javascript')!,name=typeProjectName(definition),file='runtime/node/private/bindings.node.mjs';
  put(root,file,'export const answer=1;');project(root,name,[file]);const first=checkTypeProject(root,definition);assert.deepEqual(first.problems,[]);
  const path=join(root,'counts.json');writeTypeProjectRecord(path,{root,projects:{[name]:first},problems:[]},empty(),true);const previous=parseDiagnosticRecord(JSON.parse(readFileSync(path,'utf8')));
  put(root,file,'export const answer=2;');const second=checkTypeProject(root,definition);assert.notEqual(second.source,first.source);assert.equal(typeProjectSourceKey(root,name),second.source);assert.deepEqual(second.counts,{});
  put(root,file,'export const answer=2;answer();');const third=checked(root,[definition]);assert.match(typeRecordChanges(third,previous).problems.join('\n'),/rose from 0 to 1/);
});

test('weak options and no-check pragmas cannot suppress the checker',t=>{
  const root=fixture(t);put(root,'tooling/subject.ts','// @ts-nocheck\nexport const value:number="wrong";');assert.match(checkToolingTypes(root).problems.join('\n'),/disables type checking/);
  const api=new API({cwd:root});try{const options=api.parseConfigFile(join(root,TOOLING_PROJECT)).options;assert.deepEqual(strictProjectProblems(options as Record<string,unknown>),[]);
    for(const name of ['strict','checkJs','allowJs','noUncheckedIndexedAccess'])assert.ok(strictProjectProblems({...options,[name]:false}).some(problem=>problem.includes(name)));assert.ok(strictProjectProblems({...options,noCheck:true}).length);
  }finally{api.close();}
});

test('root configuration errors refuse instead of becoming a diagnostic allowance',t=>{
  const root=fixture(t);project(root,TOOLING_PROJECT,['tooling/subject.ts'],{rootDir:join(root,'elsewhere')});
  const result=checked(root);assert.ok(result.problems.some(problem=>problem.includes('TS6059')),result.problems.join('\n'));
  assert.throws(()=>writeTypeProjectRecord(join(root,'counts.json'),result,empty()),/TS6059/);
});

test('project records accept only complete version-two inventories and positive counts',()=>{
  const row={modules:['tooling/subject.ts'],counts:{'tooling/subject.ts':3},source:'sha256:'+'a'.repeat(64)},record:DiagnosticRecord={version:2,projects:{[TOOLING_PROJECT]:row}};
  assert.deepEqual(parseDiagnosticRecord(JSON.parse(serializeDiagnosticRecord(record))),record);
  for(const value of [{version:1,modules:{}},{version:3,modules:{}},{version:2,projects:{bad:{}}},
    {version:2,projects:{[TOOLING_PROJECT]:{...row,modules:null}}},{version:2,projects:{[TOOLING_PROJECT]:{...row,counts:{'tooling/subject.ts':-1}}}}])assert.throws(()=>parseDiagnosticRecord(value));
});

test('the fixture base excludes root tooling while child projects still discover their own source',t=>{
  const root=testScratch(t,'fixture-config-discovery');put(root,'tsconfig.fixtures.json',readFileSync(join(source,'tsconfig.fixtures.json'),'utf8'));
  put(root,'tooling/instrument.ts','export const value=1;');put(root,'fixture/src/main.ts','export const value=1;');put(root,'fixture/tsconfig.json',JSON.stringify({extends:'../tsconfig.fixtures.json'}));
  const api=new API({cwd:root});try{assert.ok(!api.parseConfigFile(join(root,'tsconfig.fixtures.json')).fileNames.some(file=>file===join(root,'tooling/instrument.ts')));assert.ok(api.parseConfigFile(join(root,'fixture/tsconfig.json')).fileNames.some(file=>file===join(root,'fixture/src/main.ts')));}finally{api.close();}
});

test('tooling imports still resolve product code while its diagnostics stay with the product owner',t=>{
  const root=fixture(t);put(root,'runtime/product.ts','export const value:number="wrong";');put(root,'tooling/subject.ts','import {value} from "../runtime/product.ts";export const answer:number=value;');
  const result=checkToolingTypes(root);assert.deepEqual(result.problems,[]);assert.deepEqual(result.counts,{});
});
