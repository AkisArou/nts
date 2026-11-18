// Fresh bounded execution; scope launch and admission stay in their owners.
import {writeFileSync,renameSync,writeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {runTooling,runToolingEntry,readToolingRequest,TOOLING_SELF_TEST_FILE,type ToolingRequest,type ToolingResult} from './tooling-test-runner.ts';
import {installTestHost} from './test-host-bootstrap.ts';
import type {ToolingEntryFrame} from './tooling-entry-channel.ts';
import {toolingSlice} from './tooling-slice.ts';
import {publishPressure,publishToolingFailure,PressureError,ToolingInstrumentError} from './step-result.ts';
import {WORKER_ROLE_VARIABLES} from '../census/worker-identity.ts';
import {assignOwnedValues} from './environment-values.ts';
import {hostObservations} from './host-observations.ts';

async function selectorSelfTest():Promise<ToolingResult>{
  // This is an owned command, with the enclosing case reservation intact.
  // A resident census role must not change its native helpers' budgets.
  assignOwnedValues(process.env,Object.fromEntries(WORKER_ROLE_VARIABLES.map(name=>[name,undefined])));
  for(const name of WORKER_ROLE_VARIABLES)delete process.env[name];
  const clock=hostObservations().now,started=clock();
  const {acceptedSourceSelfTest}=await import('./owed.mjs');
  const broken=acceptedSourceSelfTest(),wallMs=clock()-started;
  if(broken)process.stderr.write('selector self-test failed: '+broken+'\n');
  else process.stdout.write('selector self-test passed\n');
  return {status:broken?1:0,completedFailures:broken?1:0,times:{version:1,wallMs,concurrency:1,
    files:[{file:TOOLING_SELF_TEST_FILE,startedMs:0,wallMs,passed:!broken}]}};
}

export async function runToolingWorker(request:ToolingRequest):Promise<void>{
  const resultEnv={NTS_GATE_STEP_RESULT:process.env.NTS_GATE_STEP_RESULT,NTS_GATE_STEP:process.env.NTS_GATE_STEP,NTS_GATE_STEP_ATTEMPT:process.env.NTS_GATE_STEP_ATTEMPT};
  let send:((row:Pick<ToolingEntryFrame,'event'|'id'|'name'|'failed'|'instrument'>)=>void)|undefined;
  try{
    const slice=toolingSlice();
    // Placement is physical wiring, like the independently verified cgroup
    // caps. It deliberately selects the live kernel adapter, not admission's
    // supplied resource observations.
    if(!slice||!hostObservations({}).ownCgroup().includes(`/${slice}/${slice.slice(0,-6)}-f.scope`))
      throw new ToolingInstrumentError('tooling-setup','tooling worker is outside its owned slice/scope');
    assignOwnedValues(process.env,{NTS_GATE_STEP_RESULT:undefined,NTS_GATE_STEP_ATTEMPT:undefined});
    delete process.env.NTS_GATE_STEP_RESULT;delete process.env.NTS_GATE_STEP_ATTEMPT;
    if(request.selectorSelfTest==='include')throw new ToolingInstrumentError('tooling-setup','a suite must dispatch its selector entry through the case pool');
    const bootstrap=fileURLToPath(new URL('./test-host-bootstrap.ts',import.meta.url));
    let result:ToolingResult;
    if(request.singleProcess){
      let sequence=0;
      send=row=>{writeSync(3,JSON.stringify({version:1,nonce:request.nonce,
        file:request.files[0],pid:process.pid,sequence:++sequence,...row})+'\n');};
      send({event:'ready'});installTestHost(request.files[0]!);
      const report=send;
      result=await runToolingEntry(request.files[0]!, (event,id,name,failed)=>{report({event,id,name,failed});});
    }else result=request.selectorSelfTest==='only'?await selectorSelfTest():await runTooling(request.files,
      {idleMs:request.idleMs,execArgv:[...(request.execArgv??[]),'--import',bootstrap],resultEnv});
    const pending=`${request.complete}.${process.pid}`;
    writeFileSync(pending,JSON.stringify({version:2,nonce:request.nonce,...result})+'\n');renameSync(pending,request.complete);
    process.exitCode=result.status;
  }catch(error){
    if(send)try{send({event:'instrument',instrument:{kind:error instanceof PressureError?'memory-pressure':error instanceof ToolingInstrumentError?error.kind:'tooling-setup',reason:String(error)}});}catch{}
    if(error instanceof PressureError)publishPressure(error,resultEnv);
    else publishToolingFailure(error instanceof ToolingInstrumentError?error:new ToolingInstrumentError('tooling-setup',String(error),{cause:error}),resultEnv);
    process.stderr.write((error instanceof Error?error.stack:String(error))+'\n');process.exitCode=2;
  }
}

runAsCommand(import.meta.url,async()=>runToolingWorker(readToolingRequest(JSON.parse(process.argv[2]??'null'))));
