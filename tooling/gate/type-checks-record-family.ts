// Type projects share the recorder transaction, while this family owns their format and ratchet.
import assert from 'node:assert/strict';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {RecordFamily} from '../records/recorder-core.ts';
import {typeProjectSourceKey} from './tooling-types.ts';
import {TYPE_PROJECTS,typeProjectName,absentTypeModules,pendingTypeProjects} from './tooling-type-projects.ts';
import {projectTypeRows,mergedProjectTypeRows,parseProjectTypeRecord,projectTypeChanges,TOOLING_DIAGNOSTICS} from './tooling-type-records.ts';

const SOURCE_ROOT=fileURLToPath(new URL('../..',import.meta.url));
export const typeChecksFamily:RecordFamily={
 pending:root=>pendingTypeProjects(root).map(name=>({name,record:TOOLING_DIAGNOSTICS})),
 files:()=>[TOOLING_DIAGNOSTICS],records:()=>[TOOLING_DIAGNOSTICS],
 runs:()=>[[relative(SOURCE_ROOT,fileURLToPath(new URL('./tooling-types.ts',import.meta.url))),'--record-pending']],
 audit:(file,before,after,pending,root)=>{
  const was=projectTypeRows(before),now=projectTypeRows(after),recorded:string[]=[];
  for(const [name,text]of was){
   const next=now.get(name);assert.ok(next,`${file}: the type project ${name} was removed`);
   if(next===text)continue;
   const old=parseProjectTypeRecord(JSON.parse(text)),current=parseProjectTypeRecord(JSON.parse(next));
   const changes=projectTypeChanges(current,old,root===undefined?undefined:absentTypeModules(root,current.modules,old.modules));
   assert.deepEqual(changes.problems,[],`${file}: ${name}: ${changes.problems.join('; ')}`);
   recorded.push(`${name} rechecked without a diagnostic increase (improved)`);
  }
  for(const name of now.keys())if(!was.has(name)){
   assert.ok(pending.has(name),`${file}: added type project ${name} was not pending`);
   recorded.push(`${name} (pending)`);
  }
  return recorded;
 },
 rows:(_file,text)=>new Map([...projectTypeRows(text)].map(([name,line])=>[name,{name,line}])),
 changes:(kind,file,before,after)=>{const was=projectTypeRows(before);return [...projectTypeRows(after)]
  .filter(([name,text])=>was.get(name)!==text).map(([name,text])=>({kind,record:file,case:name,key:name,before:was.get(name)??null,after:text}));},
 validate:(row,bad)=>{
  if(row.key!==row.case||!TYPE_PROJECTS.some(project=>typeProjectName(project)===row.case))bad(row,'unknown type project or mismatched key');
  for(const text of [row.before,row.after])if(text!==null){
   try{parseProjectTypeRecord(JSON.parse(text));}catch{bad(row,'it is not one complete type project row');}
  }
 },
 merge:(_file,text,rows)=>mergedProjectTypeRows(text,new Map(rows.map(row=>[row.key,row.after]))),
 sourceDigests:(root,names)=>new Map(names.map(name=>[name,typeProjectSourceKey(root,name)])),
};
