import {readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digestSources,type RecordFamily} from '../records/recorder-core.ts';
import {auditLines,lineRows,changedLines,validateLine,mergeLines} from '../records/recorder-format.ts';
import {acceptedChange,improves,type OutcomeTransition} from '../conformance/outcome-transition.ts';
import type {DeltaRow} from '../records/delta.ts';
import {dataDirectory} from '../gate/reader-inputs/main.ts';
const TYPESCRIPT_CASES=dataDirectory(new URL('../../tests/typescript/',import.meta.url));
const SOURCE_ROOT=fileURLToPath(new URL('../..',import.meta.url));
const read=(root:string,file:string)=>readFileSync(join(root,file),'utf8');
const label=(transition:OutcomeTransition)=>improves(transition)?'improved':'refuses differently';
import {selectTypescript} from './suites/typescript.ts';
import {parseTypeScriptRecord,pendingCases,compareTypeScriptObservation,mergeTypeScriptRecord,parseObservation} from './typescript-record.ts';
import {BACKENDS,typescriptRecord} from '../records/record-paths.ts';

export const typescriptFamily:RecordFamily={
pending:root=>{const sources=selectTypescript(root,relative(SOURCE_ROOT,fileURLToPath(TYPESCRIPT_CASES))).map(row=>row.path);return BACKENDS.flatMap(backend=>pendingCases(parseTypeScriptRecord(read(root,typescriptRecord(backend))),sources).map(name=>({name,record:typescriptRecord(backend)})));},
 files:()=>BACKENDS.map(typescriptRecord),
 runs:pending=>BACKENDS.filter(backend=>pending.some(one=>one.record===typescriptRecord(backend))).map(backend=>[relative(SOURCE_ROOT,fileURLToPath(new URL('./conformance262.ts',import.meta.url))),'--suite','typescript','--backend',backend,'--record-pending',typescriptRecord(backend)]),
 records:()=>BACKENDS.map(typescriptRecord),
 merge:(_file,text,rows,header)=>mergeLines(text,rows,header,(text,updates)=>mergeTypeScriptRecord(text,new Map(updates.map(one=>[one.path,one.value])))),
rows:(_file,text)=>lineRows(text).rows,
 changes:(kind,file,before,after)=>changedLines(kind,file,before,after,lineRows),
 validate:(row,bad)=>validateLine(row,lineRows,bad),
 lineHeader:true,
audit:(file,before,after,pending)=>auditLines(file,before,after,pending,{rows:lineRows,accepted:(before,after)=>{const value=(line:string)=>JSON.parse(line.split('\t')[1]!);const was=parseObservation(value(before)),now=parseObservation(value(after)),change=compareTypeScriptObservation(was,now);return acceptedChange(change)?`${JSON.stringify(was)} -> ${JSON.stringify(now)} (${label(change)})`:null;}}),
sourceDigests:(root,names)=>digestSources(root,names.map(name=>({name,paths:[name],except:null}))),

};
