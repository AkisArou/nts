// The common resident pool admits one entry before sending its path. Each
// entry still executes in a fresh node:test child; the resident owns reports.
import {createInterface} from 'node:readline';
import {mkdtempSync,rmSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runAsCommand,isCommandExit} from '../differential/command-entry/main.ts';
import {inResidentWorker} from '../census/worker-memory.ts';
import {readToolingRequest,runScopedTooling,type ToolingResult} from './tooling-runner.ts';
import {readStepInstrument,ToolingInstrumentError,type InstrumentResult} from './step-result.ts';
import {assignOwnedValues} from './environment-values.ts';
import {readLimits} from './scopes/memory-limits.ts';

export type ToolingFileReply={path:string;bucket:string;result?:ToolingResult;instrument?:InstrumentResult;why?:string};

runAsCommand(import.meta.url,async()=>{
  if(!inResidentWorker())throw new ToolingInstrumentError('tooling-setup','tooling file worker requires its bounded resident scope');
  // Fixture-created services follow this file's boundary too, rather than
  // becoming siblings under the collector and escaping its peak and cap.
  assignOwnedValues(process.env,{NTS_TOOLING_SLICE:basename(process.env.NTS_CENSUS_WORKER_GROUP!)});
  const memoryMax=readLimits(process.env.NTS_CENSUS_WORKER_GROUP!).max;
  const request=readToolingRequest(JSON.parse(process.argv[2]??'null')),files=new Set(request.files.map(file=>resolve(file)));
  const step=process.env.NTS_GATE_STEP;
  // Only the collector owns the public step result. Each file's diagnostic
  // travels with its completed assertion evidence through the pool protocol.
  delete process.env.NTS_GATE_STEP_RESULT;delete process.env.NTS_GATE_STEP_ATTEMPT;
  for await(const path of createInterface({input:process.stdin,crlfDelay:Infinity})){
    if(!files.has(path))throw new ToolingInstrumentError('tooling-setup','unowned tooling file dispatch: '+path);
    const directory=mkdtempSync(join(dirname(request.complete),'file-')),nonce=randomUUID(),frame=join(directory,'instrument.json');
    const resultEnv={NTS_GATE_STEP:'tooling-file',NTS_GATE_STEP_ATTEMPT:nonce,NTS_GATE_STEP_RESULT:frame};
    let reply:ToolingFileReply;
    try{
      assignOwnedValues(process.env,resultEnv);
      // The file's slice owns fixture-created services as well as its test
      // process. Join that entire drain before reporting to the case pool.
      const result=await runScopedTooling([path],{idleMs:request.idleMs,execArgv:request.execArgv,memoryMax,output:process.stderr});
      const instrument=readStepInstrument(frame,'tooling-file',nonce);
      reply={path,bucket:'tooling',result,...(instrument?{instrument}:{})};
      if(result.status===0)rmSync(directory,{recursive:true,force:true});
    }catch(error){
      if(isCommandExit(error))throw error;
      reply={path,bucket:'infrastructure-error',why:error instanceof Error?error.stack:String(error)};
    }finally{
      assignOwnedValues(process.env,{NTS_GATE_STEP:step,NTS_GATE_STEP_ATTEMPT:undefined,NTS_GATE_STEP_RESULT:undefined});
      delete process.env.NTS_GATE_STEP_ATTEMPT;delete process.env.NTS_GATE_STEP_RESULT;
    }
    process.stdout.write(JSON.stringify(reply)+'\n');
  }
});
