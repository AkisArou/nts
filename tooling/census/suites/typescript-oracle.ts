// Oracle execution is separate from source selection and read-only identity.
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {oracleToolchainLocation} from '../../gate/host-environment.ts';
import {REPOSITORY} from '../../differential/oracle-services.ts';
import {OracleWorker,oracleExecution,oracleLoaderReady,closeOracleExecution,finishOracleSnapshot} from '../../differential/oracle-emit.ts';
import {removeOracleSnapshot} from '../../differential/oracle-snapshot.ts';
import {ToolingInstrumentError} from '../../gate/step-result.ts';
import {captureTypeScriptOracle,type TypeScriptOracleCapture} from '../typescript-oracle-capture.ts';
import {materialiseTypeScriptOracle} from './typescript.ts';
import {flagsOf,harnessObservations} from '../project.ts';
/** A completed failure is a case observation; missing execution is held. */
export type OracleRejection={exit:number;error:string};
export type OracleVerdict={ok:true}|{ok:false;why:string;rejection?:OracleRejection};
export type OracleReferenceCapture={projectDirectory:string;outputDirectory:string;record:(capture:TypeScriptOracleCapture)=>void};

/** Transform the one-file harness and case, then execute its captured JS.
 * Type errors are the native compiler's question, not Node's admission rule.
 * One pinned transpileModule path handles every TypeScript case. */
export async function oracle(source:string,scratch:string,printed?:(output:string,errors:string)=>void,worker?:OracleWorker,reference?:OracleReferenceCapture):Promise<OracleVerdict>{
  const own=reference?.projectDirectory??(worker?join(scratch,'oracle-project'):mkdtempSync(join(scratch,'oracle-project-')));
  mkdirSync(own,{recursive:true});
  let producer=worker,snapshotOwner:Awaited<ReturnType<OracleWorker['prepare']>>|undefined,execution:ReturnType<typeof oracleExecution>|undefined,finalized=false;
  try{
    const file=materialiseTypeScriptOracle(source,own),project=join(own,'tsconfig.json');
    const config=reference?join(REPOSITORY,'tsconfig.fixtures.json'):join(scratch,'tsconfig.json');
    writeFileSync(project,JSON.stringify({extends:existsSync(config)?config:join(REPOSITORY,'tsconfig.fixtures.json'),files:[file],include:[]})+'\n');
    producer??=new OracleWorker(join(own,'producer'),oracleToolchainLocation());
    const entry=join(own,'oracle.js');writeFileSync(entry,'');
    const transformed=producer.transpileModule(file,project);
    writeFileSync(entry,transformed.text);
    if(transformed.map)writeFileSync(entry+'.map',transformed.map);
    snapshotOwner=await producer.prepare({toolchain:oracleToolchainLocation(),entry,project:null,roots:[entry],
      observations:[...transformed.observations,...harnessObservations()],directory:reference?.outputDirectory??join(own,'oracle-emit')});
    if(JSON.parse(readFileSync(snapshotOwner.manifest,'utf8')).groups.length!==0)throw new ToolingInstrumentError('tooling-setup','transpiled TypeScript case required an unplanned checked Program');
    execution=oracleExecution(snapshotOwner);
    const run=spawnSync(process.execPath,[...execution.args,'--no-warnings',entry],{encoding:'utf8',timeout:30_000,env:{...process.env,...execution.env}});
    const snapshot=finishOracleSnapshot(execution);finalized=true;
    if(!snapshot.ready)return {ok:false,why:snapshot.why};
    printed?.(run.stdout??'',run.stderr??'');
    const loader=oracleLoaderReady(execution);
    if(!loader.ready)return {ok:false,why:loader.why};
    if(run.signal||run.error||run.status===null)return {ok:false,why:`node was not measured: ${run.signal??run.error?.message??'missing exit status'}`};
    reference?.record(captureTypeScriptOracle(snapshotOwner));
    if(run.status!==0){
      const said=(run.stderr??'')+(run.stdout??''),line=said.split('\n').find(text=>/Error|error/.test(text))??said.split('\n')[0]??'';
      const error=line.trim().slice(0,200)||`node exited ${run.status}`;
      return {ok:false,why:error,rejection:{exit:run.status,error}};
    }
    if(flagsOf(source).includes('async')&&!/^Test262:AsyncTestComplete$/m.test(run.stdout??'')){
      const failure=/^Test262:AsyncTestFailure:.*$/m.exec(run.stdout??'')?.[0],error=(failure??'the async case never called $DONE').slice(0,200);
      return {ok:false,why:error,...(failure?{rejection:{exit:run.status,error}}:{})};
    }
    return {ok:true};
  }finally{
    try{if(snapshotOwner&&!finalized){const result=finishOracleSnapshot(snapshotOwner);if(!result.ready)throw new ToolingInstrumentError('tooling-setup',result.why);}}
    finally{
      if(execution)closeOracleExecution(execution);
      if(!worker)producer?.close();
      if(reference)removeOracleSnapshot(reference.outputDirectory);
      else if(worker)removeOracleSnapshot(own);
    }
  }
}
