import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {type RecordFamily} from '../records/recorder-core.ts';
import {auditLines,lineRows,changedLines,validateLine} from '../records/recorder-format.ts';

const SOURCE_ROOT=fileURLToPath(new URL('../..',import.meta.url));
import {TEST262_SLICES,TEST262_RECORDS,BACKENDS} from '../records/record-paths.ts';
import {mergeTest262Record,parseTest262Row} from './test262-record.ts';
import {createHash} from 'node:crypto';
function test262Slice(record: string): { backend: string; under: string } | null {
  const found = /^results\/test262\/([a-z]+)\/([a-z]+)\.tsv$/.exec(record);
  const under = found ? (TEST262_SLICES as Record<string, string>)[found[2]!] : undefined;
  return found && under && (BACKENDS as readonly string[]).includes(found[1]!) ? { backend: found[1]!, under } : null;
}



export const test262Family:RecordFamily={
pending:()=>[],listedPending:true,pendingFromDelta:true,
 files:()=>TEST262_RECORDS,records:()=>TEST262_RECORDS,
 runs:pending=>[...Map.groupBy(pending,one=>one.record)].sort(([a],[b])=>a.localeCompare(b)).flatMap(([record,listed])=>{const where=test262Slice(record);if(!where)return [];const cases=[...new Set(listed.map(one=>one.name))].sort();return [[relative(SOURCE_ROOT,fileURLToPath(new URL('./conformance262.ts',import.meta.url))),'--suite','test262','--backend',where.backend,'--under',where.under,'--record-pending',record,'--repeats','3',...cases.flatMap(name=>['--case',name])]];}),
 merge:(_file,text,rows)=>{assert.ok(text!==null,'there is no such record; a test262 record is written whole by a full --record');return mergeTest262Record(text,new Map(rows.map(row=>{const one=parseTest262Row(row.after);return [one.path,{outcome:one.outcome,detail:one.detail}];})));},
 sourceDigests:(root,names)=>{const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');return new Map(names.map(name=>{const file=join(root,'third_party/test262',name);return [name,existsSync(file)?hash(JSON.stringify([[name,hash(readFileSync(file))]])):null];}));},
rows:(_file,text)=>lineRows(text).rows,
 changes:(kind,file,before,after)=>changedLines(kind,file,before,after,lineRows),
 validate:(row,bad)=>validateLine(row,lineRows,bad),
 lineHeader:true,
audit:(file,before,after,pending)=>auditLines(file,before,after,pending,{rows:lineRows,accepted:(before,after)=>{return parseTest262Row(before).outcome==='fail'&&parseTest262Row(after).outcome==='pass'?'fail -> pass (improved)':null;},fixedComments:true}),

};
