import {existsSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digestSources,type RecordFamily} from '../records/recorder-core.ts';
import {auditLines,lineRows,changedLines,validateLine,mergeLines} from '../records/recorder-format.ts';
import {acceptedChange,improves,type OutcomeTransition} from '../conformance/outcome-transition.ts';
const SOURCE_ROOT=fileURLToPath(new URL('../..',import.meta.url));
const read=(root:string,file:string)=>readFileSync(join(root,file),'utf8');
const label=(transition:OutcomeTransition)=>improves(transition)?'improved':'refuses differently';
import {compareDex,DEX_RECORD,dexOutcome,written,dexTargets,recordedTargets} from './dex-record.ts';
import {inventory} from '../records/pending.ts';

export const dexFamily:RecordFamily={
pending:root=>inventory(existsSync(join(root,DEX_RECORD))?recordedTargets(read(root,DEX_RECORD)):[],dexTargets(root)).pending.map(name=>({name,record:DEX_RECORD})),
 files:()=>[DEX_RECORD],records:()=>[DEX_RECORD],runs:()=>[[relative(SOURCE_ROOT,fileURLToPath(new URL('./dex-record.ts',import.meta.url))),'record-pending']],
 merge:(_file,text,rows,header)=>mergeLines(text,rows,header,written),
rows:(_file,text)=>lineRows(text).rows,
 changes:(kind,file,before,after)=>changedLines(kind,file,before,after,lineRows),
 validate:(row,bad)=>validateLine(row,lineRows,bad),
 lineHeader:true,
audit:(file,before,after,pending)=>auditLines(file,before,after,pending,{rows:lineRows,accepted:(before,after)=>{const value=(line:string)=>JSON.parse(line.split('\t')[1]!);const path=before.split('\t')[0]!,was=dexOutcome(path,value(before)),now=dexOutcome(path,value(after)),change=compareDex(was,now);return acceptedChange(change)?`${JSON.stringify(was)} -> ${JSON.stringify(now)} (${label(change)})`:null;},allowCreate:true}),
sourceDigests:(root,names)=>digestSources(root,names.map(name=>({name,paths:[name],except:null}))),

};
