import {existsSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digestSources,type RecordFamily} from '../records/recorder-core.ts';
import {auditLines,lineRows,changedLines,validateLine,mergeLines} from '../records/recorder-format.ts';
import {acceptedChange,improves,type OutcomeTransition} from '../conformance/outcome-transition.ts';
const SOURCE_ROOT=fileURLToPath(new URL('../..',import.meta.url));
const read=(root:string,file:string)=>readFileSync(join(root,file),'utf8');
const label=(transition:OutcomeTransition)=>improves(transition)?'improved':'refuses differently';
import {benchmarkCases} from './build-records.ts';
import {BENCH_AGREE_BACKENDS,parseRunRecord,pendingRuns,runsRecord,parseBenchmarkRun,compareBenchmarkRun,mergeRunRecord} from './run-outcomes.ts';

export const runFamily:RecordFamily={
pending:root=>BENCH_AGREE_BACKENDS.flatMap(backend=>{const record=runsRecord(backend);return pendingRuns(existsSync(join(root,record))?parseRunRecord(read(root,record)):null,benchmarkCases(root)).map(name=>({name,record}));}),
 files:()=>BENCH_AGREE_BACKENDS.map(runsRecord),records:()=>BENCH_AGREE_BACKENDS.map(runsRecord),
 runs:()=>[[relative(SOURCE_ROOT,fileURLToPath(new URL('../differential/check-consumers.ts',import.meta.url))),'benchmarks','--record-pending']],
 merge:(_file,text,rows,header)=>mergeLines(text,rows,header,(text,updates)=>mergeRunRecord(text,new Map(updates.map(one=>[one.path,one.value])))),
rows:(_file,text)=>lineRows(text).rows,
 changes:(kind,file,before,after)=>changedLines(kind,file,before,after,lineRows),
 validate:(row,bad)=>validateLine(row,lineRows,bad),
 lineHeader:true,
audit:(file,before,after,pending)=>auditLines(file,before,after,pending,{rows:lineRows,accepted:(before,after)=>{const value=(line:string)=>JSON.parse(line.split('\t')[1]!);const was=parseBenchmarkRun(value(before)),now=parseBenchmarkRun(value(after)),change=compareBenchmarkRun(was,now);return acceptedChange(change)?`${JSON.stringify(was)} -> ${JSON.stringify(now)} (${label(change)})`:null;},allowCreate:true}),
sourceDigests:(root,names)=>digestSources(root,names.map(name=>({name,paths:[name],except:null}))),

};
