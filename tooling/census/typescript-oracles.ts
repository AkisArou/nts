import {runAsCommand} from "../differential/command-entry/main.ts";
// A run's three backend steps share one measured Node answer per case. Only
// original inputs and authenticated evidence survive each admitted attempt;
// its executable snapshot is finalized and removed before the next dispatch.
import { mkdirSync,readFileSync } from 'node:fs';
import {join} from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
import { REPOSITORY } from '../differential/oracle-emit.ts';
import { acquireToken } from '../gate/tokens.mjs';
import { ToolingInstrumentError,publishToolingFailure } from '../gate/step-result.ts';
import { populationOf } from './project.ts';
import { parseTypeScriptRecord } from './typescript-record.ts';
import { selectTypescript,typescriptOracleIdentity,materialiseTypeScriptOracleProject,type Selected } from './suites/typescript.ts';
import { ownCensusScratch } from './census-scratch.ts';
import { memoryRun,closeMemoryRun } from './worker-memory.ts';
import { runMemoryWorkers } from './worker-pool.ts';
import { createTypeScriptOracleResults,oracleResultHash,type TypeScriptOracleResult } from './typescript-oracle-results.ts';
import { typeScriptOracleDirectory } from './typescript-oracle-capture.ts';
import type { NodeResolutionSession } from '../differential/oracle-runtime.ts';

/** Use precisely each backend's population rule, then take its union. Pending
 * cases with no recorded row are left to the record policy, not executed here. */
export function typeScriptOraclePopulation(records:Selected[],named:{backend:string;file:string;text:string}[],sample=0):string[]{
  const wanted=new Set<string>();
  for(const record of named){
    const selected=populationOf(records,{sample,backend:record.backend,named:record});
    if('refused' in selected)throw new ToolingInstrumentError('tooling-setup',selected.refused);
    for(const row of selected.population)wanted.add(row.path);
  }
  return records.filter(row=>wanted.has(row.path)).map(row=>row.path);
}

export async function produceTypeScriptOracles({sample=0,jobs=Math.min(8,availableParallelism())}={}):Promise<void>{
  const {path:scratch,cleanup}=ownCensusScratch(closeMemoryRun);
  try{
    const directory=typeScriptOracleDirectory(),inputs=join(directory,'inputs'),results=join(directory,'results');
    mkdirSync(inputs,{recursive:true});mkdirSync(results,{recursive:true});
    const records=selectTypescript(REPOSITORY,'tests/typescript');
    const named=['c','llvm','jvm'].map(backend=>{
      const file=join(REPOSITORY,'results/typescript',backend,'cases.tsv'),text=readFileSync(file,'utf8');
      const parsed=parseTypeScriptRecord(text);
      if(parsed.metadata.backend!==backend||parsed.metadata.under!=='tests/typescript')throw new ToolingInstrumentError('tooling-setup','TypeScript oracle record selection differs: '+file);
      return {backend,file,text};
    });
    const paths=typeScriptOraclePopulation(records,named,sample);
    if(!Number.isSafeInteger(jobs)||jobs<1||!Number.isSafeInteger(sample)||sample<0)throw new ToolingInstrumentError('tooling-setup','invalid TypeScript oracle worker or sample count');
    // These are small original program inputs, not snapshots. Make their
    // namespace stable before any captured directory listing is consulted.
    for(const path of paths)materialiseTypeScriptOracleProject(readFileSync(join(REPOSITORY,path),'utf8'),join(inputs,oracleResultHash(path)));
    const writer=createTypeScriptOracleResults(results,oracleResultHash(JSON.stringify(typescriptOracleIdentity())));
    let done=0;
    const errors:string[]=[],report=(message:string)=>process.stderr.write('  '+message+'\n');
    if(paths.length)await runMemoryWorkers({
      paths,jobs:Math.min(jobs,paths.length),memory:memoryRun(),workerBytes:Number(process.env.NTS_CENSUS_MEMORY_CAP_KB??6_000_000)*1024,
      key:'typescript-oracles',what:'TypeScript oracle references',token:(path,signal)=>acquireToken({project:path,backend:'node'},signal),
      args:index=>[fileURLToPath(new URL('./attempt262-worker.ts',import.meta.url)),join(scratch,'w'+index),'','',REPOSITORY,'0','','c','roots','oracle',inputs],
      report,onRow:(row:{path:string;bucket:string;why?:string;result?:TypeScriptOracleResult;session?:NodeResolutionSession})=>{
        if(row.bucket!=='oracle-reference'||!row.result||!row.session)errors.push(row.path+': '+(row.why??row.bucket));
        else writer.add(row.result,row.session);
        if(++done%500===0)report(`${done}/${paths.length} oracle references finalized`);
      },
    });
    if(errors.length)throw new ToolingInstrumentError('tooling-setup','TypeScript oracle references were not measured:\n'+errors.join('\n'));
    if(done!==paths.length)throw new ToolingInstrumentError('tooling-setup',`TypeScript oracle references incomplete: ${done}/${paths.length}`);
    // Drain scopes and remove worker snapshots before the last input replay
    // and publication. Retained originals are under the run's capture owner.
    cleanup();
    const ready=writer.publish();
    process.stdout.write(`  TypeScript oracle references: ${ready.count} measured once for C, LLVM and the JVM\n`);
  }finally{cleanup();}
}

runAsCommand(import.meta.url,async()=>{
  const value=(name:string,fallback:number)=>{const at=process.argv.indexOf(name);return at<0?fallback:Number(process.argv[at+1]);};
  try{await produceTypeScriptOracles({sample:value('--sample',0),jobs:value('--jobs',Math.min(8,availableParallelism()))});}
  catch(error){const failure=error instanceof ToolingInstrumentError?error:new ToolingInstrumentError('tooling-setup',String(error instanceof Error?error.stack:error));publishToolingFailure(failure);process.stderr.write(failure.message+'\n');process.exitCode=2;}
});
