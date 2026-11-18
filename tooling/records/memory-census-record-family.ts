// A whole observation per program; changes refresh it, without ranking homes.
import assert from 'node:assert/strict';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {RecordFamily} from './recorder-core.ts';
import {wholeRow,mergeWhole} from './recorder-format.ts';
import {refreshLine} from './pending.ts';
import {memoryPrograms,censusRecord,censusSourceKey,checkMemoryCensuses,parseCensusRecord,censusInputScope,type CensusInputScope} from './memory-census.ts';
const ROOT=fileURLToPath(new URL('../..',import.meta.url));
/** Each transaction reads a Program once; subsequent hooks replay its facts. */
function family(inputs?:CensusInputScope):RecordFamily{return {
 ...(inputs?{}:{scope:(root:string)=>family(censusInputScope(root))}),
 pending:root=>checkMemoryCensuses(root,()=>{},{inputs}).map(name=>({name,record:censusRecord(name)})),
 // The check's distinct refresh requests start a core records unit even when
 // every observation is current and no other family has anything pending.
 refresh:root=>{const pending=new Set(checkMemoryCensuses(root,()=>{},{inputs}));return memoryPrograms(root).filter(name=>!pending.has(name)).map(name=>({name,record:censusRecord(name)}));},
 refreshLine:one=>`  ${refreshLine(one.name,one.record)}`,
 files:root=>memoryPrograms(root).map(censusRecord),records:row=>[censusRecord(row.case)],
 runs:pending=>pending.map(row=>[relative(ROOT,fileURLToPath(new URL('./memory-census.ts',import.meta.url))),'--record-pending',row.name]),
 audit:(file,before,after,pending,root)=>{
  const name=parseName(file);assert.ok(before!==null||pending.has(name),'memory census observation was not requested');
  const row=parseCensusRecord(JSON.parse(after),name);
  if(root)assert.equal(censusSourceKey(root,name,inputs),sourceOf(row.identity),'foreign memory census identity');
  return [name+' (native observation)'];
 },
 rows:()=>null,validate:(row,bad)=>{wholeRow(row,bad);try{assert.equal(row.record,censusRecord(row.case));parseCensusRecord(JSON.parse(row.after),row.case);}catch{bad(row,'malformed or foreign memory census');}},merge:mergeWhole,
 changes:(kind,record,before,after)=>{const name=parseName(record);return [{kind,record,case:name,key:name,before,after}];},
 sourceDigests:(root,names)=>{const scope=inputs??censusInputScope(root);return new Map([...scope.read(names)].map(([name,identity])=>[name,sourceOf(identity)]));},
 sourceAtApply:(root,row)=>memoryPrograms(root).includes(row.case)?censusSourceKey(root,row.case,inputs):null,
 checkSources:async(root,rows)=>new Map(rows.flatMap(row=>{const record=parseCensusRecord(JSON.parse(row.after),row.case);return censusSourceKey(root,row.case,inputs)===sourceOf(record.identity)?[]:[[row,'its source, recipe or census producer changed']];})),
};}
export const memoryCensusFamily=family();
import {createHash} from 'node:crypto';
const sourceOf=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function parseName(file:string):string{const name=file.slice(file.lastIndexOf('/')+1,-5);assert.equal(file,censusRecord(name));return name;}
