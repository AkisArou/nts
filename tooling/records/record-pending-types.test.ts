import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {testScratch} from '../gate/test-scratch.ts';
import {checkTypeProjects,checkTypeProject,typeRow,writeTypeProjectRecord} from '../gate/tooling-types.ts';
import {TYPE_PROJECTS,typeProjectName,readTypeRecord} from '../gate/tooling-type-projects.ts';
import {projectTypeRows,TOOLING_PROJECT,TOOLING_DIAGNOSTICS,parseDiagnosticRecord,serializeDiagnosticRecord} from '../gate/tooling-type-records.ts';
import {applyDelta,auditRecord,findPending,KIND_STEPS,partOf,recordPending,sourceDigests,type Runner} from './record-pending.ts';
import {parseDelta} from './delta.ts';
const SOURCE=fileURLToPath(new URL('../..',import.meta.url));
const JS=TYPE_PROJECTS.find(row=>row.policy==='javascript')!,NODE=typeProjectName(JS),BINDING='runtime/node/private/bindings.node.mjs';
const put=(root:string,path:string,text:string)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);};
function tree(t:{after(fn:()=>void):void}):string{
  const root=testScratch(t,'type-record-transport');
  put(root,'tooling/subject.ts','export const marker=1;');put(root,BINDING,'const answer=1;answer();export {};');
  for(const [config,file]of [[TOOLING_PROJECT,'tooling/subject.ts'],[NODE,BINDING]])put(root,config!,JSON.stringify({extends:join(SOURCE,'tsconfig.base.json'),
    compilerOptions:{rootDir:relative(dirname(join(root,config!)),root),types:[],allowJs:true,checkJs:true,noCheck:false,composite:false,incremental:false,declaration:false,declarationMap:false,emitDeclarationOnly:false,noEmit:true},
    files:[relative(dirname(join(root,config!)),join(root,file!))]}));
  const row=typeRow(checkTypeProject(root,TYPE_PROJECTS[0]!));put(root,TOOLING_DIAGNOSTICS,serializeDiagnosticRecord({version:2,projects:{[TOOLING_PROJECT]:row}}));return root;
}
const runner:Runner=(args,root)=>{
  assert.deepEqual(args,['tooling/gate/tooling-types.ts','--record-pending']);
  const projects=TYPE_PROJECTS.filter(row=>existsSync(join(root,typeProjectName(row))));
  const result=checkTypeProjects(root,projects);writeTypeProjectRecord(join(root,TOOLING_DIAGNOSTICS),result,readTypeRecord(root),true);return 0;
};

test('type projects join the green core pending recorder and publish real measured rows',async t=>{
  const root=tree(t),main=tree(t),delta=join(testScratch(t,'type-delta'),'delta.json'),lines:string[]=[];
  assert.deepEqual(KIND_STEPS['type-checks'],['tooling-types']);assert.equal(partOf('type-checks'),'core');
  assert.deepEqual(findPending(root,'type-checks'),[{kind:'type-checks',name:NODE,record:TOOLING_DIAGNOSTICS}]);
  assert.equal(recordPending(root,['type-checks'],runner,line=>lines.push(line),new Map(),delta),0);
  const recorded=readTypeRecord(root);assert.equal(recorded.projects[NODE]!.counts[BINDING],1);assert.deepEqual(findPending(root,'type-checks'),[]);
  assert.ok(lines.some(line=>line.includes(NODE+' (pending)')),lines.join('\n'));
  const carried=parseDelta(readFileSync(delta,'utf8'));assert.equal(carried.rows.length,1,'only the new project row changes');
  assert.deepEqual(await applyDelta(main,carried,{say:()=>{}}),{applied:1,already:0,skipped:0});assert.deepEqual(readTypeRecord(main),recorded);
});

test('a binding edit invalidates only its type-project delta row and a fresh measurement can record it',async t=>{
  const root=tree(t),main=tree(t),delta=join(testScratch(t,'type-stale-delta'),'delta.json');
  assert.equal(recordPending(root,['type-checks'],runner,()=>{},new Map(),delta),0);const old=parseDelta(readFileSync(delta,'utf8')),node=old.rows.find(row=>row.case===NODE)!;
  put(main,BINDING,'const answer=1;answer();export {};\n// source changed');
  const current=sourceDigests(main,[{kind:'type-checks',name:NODE}]).get('type-checks\0'+NODE);assert.notEqual(current,node.sources);
  const lines:string[]=[];assert.deepEqual(await applyDelta(main,old,{say:line=>lines.push(line)}),{applied:0,already:0,skipped:1});
  assert.ok(lines.some(line=>line.includes(NODE)&&line.includes('sources changed')),lines.join('\n'));assert.ok(findPending(main,'type-checks').some(row=>row.name===NODE));
  assert.equal(recordPending(main,['type-checks'],runner,()=>{}),0);assert.equal(readTypeRecord(main).projects[NODE]!.counts[BINDING],1);
});

test('the records audit refuses a dropped project, missing zero-count module, rising count or non-pending row',t=>{
  const root=tree(t);recordPending(root,['type-checks'],runner,()=>{});const text=readFileSync(join(root,TOOLING_DIAGNOSTICS),'utf8'),record=JSON.parse(text);
  const lost=structuredClone(record);delete lost.projects[NODE];assert.throws(()=>auditRecord('type-checks',TOOLING_DIAGNOSTICS,text,JSON.stringify(lost),new Set()),/was removed/);
  const missing=structuredClone(record);missing.projects[TOOLING_PROJECT].modules=[];assert.throws(()=>auditRecord('type-checks',TOOLING_DIAGNOSTICS,text,JSON.stringify(missing),new Set(),root),/missing from its project/);
  const rose=structuredClone(record);rose.projects[NODE].counts[BINDING]=2;assert.throws(()=>auditRecord('type-checks',TOOLING_DIAGNOSTICS,text,JSON.stringify(rose),new Set()),/rose from 1 to 2/);
  const onlyTooling={version:2,projects:{[TOOLING_PROJECT]:record.projects[TOOLING_PROJECT]}};
  assert.throws(()=>auditRecord('type-checks',TOOLING_DIAGNOSTICS,JSON.stringify(onlyTooling),text,new Set()),/was not pending/);
  assert.equal(projectTypeRows(text).size,2);assert.equal(parseDiagnosticRecord(record).projects[NODE]!.counts[BINDING],1);
});

test('record auditing accepts an inventory deletion only with the owner observing no entry',t=>{
  const root=tree(t),text=readFileSync(join(root,TOOLING_DIAGNOSTICS),'utf8'),record=JSON.parse(text);
  record.projects[TOOLING_PROJECT].modules=[];const next=JSON.stringify(record);
  assert.throws(()=>auditRecord('type-checks',TOOLING_DIAGNOSTICS,text,next,new Set(),root),/missing from its project/);
  unlinkSync(join(root,'tooling/subject.ts'));
  assert.throws(()=>auditRecord('type-checks',TOOLING_DIAGNOSTICS,text,next,new Set()),/missing from its project/);
  assert.equal(auditRecord('type-checks',TOOLING_DIAGNOSTICS,text,next,new Set(),root).length,1);
});
