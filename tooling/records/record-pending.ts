// Full-check composition: the only production list of record families, in recording order.
import {typescriptFamily} from '../census/typescript-record-family.ts';
import {test262Family} from '../census/test262-record-family.ts';
import {compileFamily} from '../bench/compile-record-family.ts';
import {runFamily} from '../bench/run-record-family.ts';
import {outcomesFamily} from '../conformance/outcomes-record-family.ts';
import {dexFamily} from '../android/dex-record-family.ts';
import {oracleFamily} from '../differential/oracle-record-family.ts';
import {compileTimesFamily} from '../gate/compile-times-record-family.ts';
import {typeChecksFamily} from '../gate/type-checks-record-family.ts';
import {rustSelectorFamily} from '../gate/rust-selector-record-family.ts';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {WIDE} from '../gate/owed.mjs';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {createRecorderCommand,recorderRequest} from './recorder-command.ts';
import {createRecorder} from './recorder-core.ts';
import {withPreparedOracle} from '../gate/canonical-environment.ts';
import {oracleCommandOptions} from '../gate/oracle-entry-options.ts';
import type {RecordTable,RecordFamily,Part} from './recorder-core.ts';
const ROOT=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const member=(family:RecordFamily,steps:readonly string[])=>({family,steps,part:(steps.some(step=>WIDE.has(step))?'wide':'core') as Part});
export const RECORD_FAMILIES={
"oracle-counts":member(oracleFamily,[]),
"typescript":member(typescriptFamily,["typescript-c", "typescript-llvm", "typescript-jvm"]),
"test262":member(test262Family,["test262-census-c", "test262-census-llvm", "test262-census-jvm"]),
"benchmarks":member(compileFamily,["benches"]),
"benchmark-runs":member(runFamily,["bench-agree"]),
"outcomes":member(outcomesFamily,["outcomes"]),
"dex":member(dexFamily,["dex"]),
"compile-times":member(compileTimesFamily,["compile-time", "compile-time-rc"]),
"type-checks":member(typeChecksFamily,["tooling-types"]),
"rust-selector":member(rustSelectorFamily,["records"]),
} satisfies RecordTable;
export type Kind=keyof typeof RECORD_FAMILIES;
export const recorder=createRecorder(RECORD_FAMILIES);
export const KINDS=Object.keys(RECORD_FAMILIES) as Kind[];
export const {partOf,acceptedIn,findPending,recorderRuns,auditRecord,sourceDigests,recordPending,applyDelta,applyCommand}=recorder;
export const KIND_STEPS=Object.fromEntries(Object.entries(RECORD_FAMILIES).map(([kind,row])=>[kind,row.steps])) as Readonly<Record<Kind,readonly string[]>>;
runAsCommand(import.meta.url,async()=>{
 const request=recorderRequest(process.argv.slice(2),KINDS,process.env);
 if('apply' in request){process.exitCode=await recorder.applyCommand(ROOT,request.apply);return;}
 if('status' in request){process.exitCode=request.status;return;}
 process.exitCode=await withPreparedOracle(env=>createRecorderCommand(RECORD_FAMILIES,env).command(request,ROOT),{entry:import.meta.url,ambient:true,owned:oracleCommandOptions(process.env,{NTS_BIN:'text'})})??0;
});
