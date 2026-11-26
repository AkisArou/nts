// The common resident pool admits one entry before sending its path. Each
// entry still executes in a fresh node:test child; the resident owns reports.
import {getHeapStatistics} from 'node:v8';
import {createInterface} from 'node:readline';
import {mkdtempSync,rmSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runAsCommand,isCommandExit} from '../differential/command-entry/main.ts';
import {inResidentWorker} from '../census/worker-memory.ts';
import {runScopedTooling} from './tooling-runner.ts';
import {readToolingRequest,TOOLING_SELF_TEST_FILE,type ToolingEntryReply} from './tooling-test-runner.ts';
import {readStepInstrument,ToolingInstrumentError} from './step-result.ts';
import {assignOwnedValues} from './environment-values.ts';
import {readLimits} from './scopes/memory-limits.ts';

export type ToolingFileReply=ToolingEntryReply;

runAsCommand(import.meta.url,async()=>{
  if(!inResidentWorker())throw new ToolingInstrumentError('tooling-setup','tooling file worker requires its bounded resident scope');
  // Fixture-created services follow this file's boundary too, rather than
  // becoming siblings under the collector and escaping its peak and cap.
  assignOwnedValues(process.env,{NTS_TOOLING_SLICE:basename(process.env.NTS_CENSUS_WORKER_GROUP!)});
  // Revoke the enclosing compiler telemetry packet before relabelling a file's
  // diagnostic step. Synthetic fixture compiles are not run cost evidence;
  // nested runners and explicit private observations acquire their own owner.
  assignOwnedValues(process.env,{NTS_GATE_CASE_COSTS_DIR:undefined,NTS_GATE_CHECK_CHANNEL:undefined,NTS_GATE_CHECK_CAPABILITY:undefined});
  const bootstrapMemoryMax=readLimits(process.env.NTS_CENSUS_WORKER_GROUP!).max;
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
    let memoryMax:number|undefined;
    try{
      assignOwnedValues(process.env,resultEnv);
      // The broker finishes registering the worker cap before dispatching
      // this path. Startup may have observed only its bootstrap allowance.
      memoryMax=readLimits(process.env.NTS_CENSUS_WORKER_GROUP!).max;
      // The file's slice owns fixture-created services as well as its test
      // process. Join that entire drain before reporting to the case pool.
      const selectorSelfTest=request.selectorSelfTest==='include'&&path===TOOLING_SELF_TEST_FILE?'only':undefined;
      const result=await runScopedTooling([path],{idleMs:request.idleMs,execArgv:request.execArgv,selectorSelfTest,memoryMax,output:process.stderr});
      const instrument=readStepInstrument(frame,'tooling-file',nonce);
      reply={path,bucket:'tooling',result,...(instrument?{instrument}:{})};
      if(result.status===0)rmSync(directory,{recursive:true,force:true});
    }catch(error){
      if(isCommandExit(error))throw error;
      reply={path,bucket:'infrastructure-error',why:error instanceof Error?error.stack:String(error)};
      try{const instrument=readStepInstrument(frame,'tooling-file',nonce);if(instrument)reply.instrument=instrument;}
      catch(observation){reply.why+='; '+String(observation);}
    }finally{
      assignOwnedValues(process.env,{NTS_GATE_STEP:step,NTS_GATE_STEP_ATTEMPT:undefined,NTS_GATE_STEP_RESULT:undefined});
      delete process.env.NTS_GATE_STEP_ATTEMPT;delete process.env.NTS_GATE_STEP_RESULT;
    }
    const heap=getHeapStatistics();
    process.stderr.write('tooling controller heap: '+JSON.stringify({file:path,controller:process.pid,usedBytes:heap.used_heap_size,totalBytes:heap.total_heap_size,limitBytes:heap.heap_size_limit,bootstrapBoundBytes:bootstrapMemoryMax,fileBoundBytes:memoryMax})+'\n');
    process.stdout.write(JSON.stringify(reply)+'\n');
  }
});
