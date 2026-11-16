import {readFileSync,rmSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {digestSources,type RecordFamily} from '../records/recorder-core.ts';
import {auditLines,lineRows,changedLines,validateLine,mergeLines} from '../records/recorder-format.ts';
import {acceptedChange,improves,type OutcomeTransition} from '../conformance/outcome-transition.ts';
import type {DeltaRow} from '../records/delta.ts';
const SOURCE_ROOT=fileURLToPath(new URL('../..',import.meta.url));
const read=(root:string,file:string)=>readFileSync(join(root,file),'utf8');
const label=(transition:OutcomeTransition)=>improves(transition)?'improved':'refuses differently';
import {benchmarkCases,benchmarkIdentities} from './build-records.ts';
import {compileKey} from './compile-producer.ts';
import {parseBenchmarkRecord,compareBenchmarkOutcome,mergeBenchmarkRecord,parseBenchmarkOutcome} from './outcomes.ts';
import {BACKENDS,benchmarkRecord} from '../records/record-paths.ts';
import {inventory} from '../records/pending.ts';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {homedir} from 'node:os';
export type BenchmarkDigests = (root: string, paths: readonly string[]) => Promise<Map<string, { source: string; driver: string }>>;

/** build-records.ts's own identities of these benchmarks, computed in `root`. */
export const benchmarkDigests: BenchmarkDigests = async (root, paths) => {
  const base = process.env.TMPDIR ?? join(homedir(), ".cache/nts/benchmark-records");
  mkdirSync(base, { recursive: true });
  const scratch = mkdtempSync(join(base, "apply-"));
  try {
    const sources = await benchmarkIdentities(root, [...paths], scratch), driver = compileKey(root);
    return new Map(paths.map(path => [path, { source: sources.get(path)!, driver }]));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
};


const compileRows=(text:string)=>lineRows(text,(name,value)=>`${name}\0${JSON.parse(value).scope}`);
export const compileFamily:RecordFamily={
pending:root=>BACKENDS.flatMap(backend=>{const recorded=parseBenchmarkRecord(read(root,benchmarkRecord(backend))).rows.filter(row=>row.scope==='compile').map(row=>row.path);return inventory(recorded,benchmarkCases(root)).pending.map(name=>({name,record:benchmarkRecord(backend)}));}),
 files:()=>BACKENDS.map(benchmarkRecord),records:()=>BACKENDS.map(benchmarkRecord),
 runs:()=>[[relative(SOURCE_ROOT,fileURLToPath(new URL('./build-records.ts',import.meta.url))),'--record-pending']],
 merge:(_file,text,rows,header)=>mergeLines(text,rows,header,(text,updates)=>mergeBenchmarkRecord(text,updates.map(one=>({path:one.path,...one.value})))),
 sourceAtApply:(_root,row)=>row.sources,
 checkSources:async(root,rows,options)=>{let digests=new Map<string,{source:string;driver:string}>(),failure='';try{digests=await(options.identities??benchmarkDigests)(root,[...new Set(rows.map(row=>row.case))]);}catch(error){failure=`: ${error instanceof Error?error.message:String(error)}`;}const refused=new Map<DeltaRow,string>();for(const row of rows){const cell=JSON.parse(row.after.slice(row.after.indexOf('\t')+1)) as {source:string;driver:string},here=digests.get(row.case);const why=!here?`its source digest cannot be computed here${failure}`:cell.source!==here.source?`its source digest is ${here.source.slice(0,12)} here, not the recorded ${cell.source.slice(0,12)}`:cell.driver!==here.driver?`its compile driver's digest is ${here.driver.slice(0,12)} here, not the recorded ${cell.driver.slice(0,12)}`:null;if(why)refused.set(row,why);}return refused;},
rows:(_file,text)=>compileRows(text).rows,
 changes:(kind,file,before,after)=>changedLines(kind,file,before,after,compileRows),
 validate:(row,bad)=>validateLine(row,compileRows,bad),
 lineHeader:true,
audit:(file,before,after,pending)=>auditLines(file,before,after,pending,{rows:compileRows,accepted:(before,after)=>{const value=(line:string)=>JSON.parse(line.split('\t')[1]!);const was=value(before),now=value(after);if(was.source!==now.source||was.driver!==now.driver)return null;const change=compareBenchmarkOutcome(parseBenchmarkOutcome(was.outcome),parseBenchmarkOutcome(now.outcome));return acceptedChange(change)?`${JSON.stringify(was.outcome)} -> ${JSON.stringify(now.outcome)} (${label(change)})`:null;}}),
sourceDigests:(root,names)=>digestSources(root,names.map(name=>({name,paths:[name],except:null}))),

};
