// The pool owns admission, tokens and this process's complete resident group.
import {writeFileSync,mkdirSync,openSync,readFileSync,readSync,writeSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {OracleWorker,REPOSITORY,finishOracleSnapshot,oracleSnapshotReady,removeOracleSnapshot,type OraclePrepared} from './oracle-emit.ts';
import {requestOracleImprovement} from './oracle-records.ts';
import {runOraclePlanner,type OracleBudget} from './oracle-execution.ts';
import {resultHash,type ProgramAnswer} from './oracle-results.ts';
import {OracleFilesystem} from './oracle-filesystem.ts';
import type {ProgramMemory,ProgramOracleTask} from './program-oracles.ts';
import {captureProgramOracle} from './oracle-result-capture.ts';
import {compileSync,inResidentWorker} from '../census/worker-memory.ts';
import {oracleToolchainLocation} from '../gate/canonical-environment.ts';
import {observeOutcomeNode} from '../conformance/outcomes-oracle.ts';
import {OUTCOME_ORACLE_PRELOADS,outcomeSourceAssets} from '../conformance/outcomes-project.ts';

const scratch=process.argv[2],executables=process.argv[3];
if(!scratch||!executables)throw Error('program oracle worker has no owned scratch');
if(!inResidentWorker())throw Error('program oracle worker requires its bounded scope');
mkdirSync(scratch,{recursive:true});mkdirSync(executables,{recursive:true});
// The run builds and pins siblings together, in its chosen Cargo profile.
const planner=join(dirname(resolve(process.env.NTS_BIN??join(process.env.CARGO_TARGET_DIR??join(REPOSITORY,'target'),'release/nts'))),'oracle-plan');
const tools={nts:process.env.NTS_BIN??'',cc:'cc',memoryCapKb:6_000_000};
const worker=new OracleWorker(join(scratch,'sdk'),oracleToolchainLocation());
const plannerEnv={...process.env,NTS_BACKEND:'c'};
// The plan's supervisor bounds the Node execution it runs (oracle-execution.ts).
function execute(args:string[]){
  const result=compileSync(tools,planner,['--execute',...args],{encoding:'utf8',maxBuffer:64*1024**2,env:plannerEnv});
  if(result.status!==0||result.signal||result.error)throw Error('program oracle supervisor held: '+result.stdout+result.stderr);
  return result.stdout;
}
// What this worker's scope holds at most over one program: its memory.peak,
// reset for each program through a descriptor of its own (Linux 6.12 and
// later); where the kernel cannot reset it, the program is not measured.
const peakFile=join('/sys/fs/cgroup',readFileSync('/proc/self/cgroup','utf8').trim().replace(/^0::/,''),'memory.peak');
let peakFd:number|null=null;
try{peakFd=openSync(peakFile,'r+');}catch{peakFd=null;}
const resetPeak=()=>{if(peakFd===null)return false;try{writeSync(peakFd,'reset\n');return true;}catch{return false;}};
const readPeak=()=>{const buffer=Buffer.alloc(32);const n=readSync(peakFd!,buffer,0,buffer.length,0);return Number(buffer.toString('utf8',0,n).trim());};
try{for await(const path of createInterface({input:process.stdin,crlfDelay:Infinity})){
  if(!path)continue;
  const measuring=resetPeak();let oraclePeakBytes:number|null=null;
  let owner:OraclePrepared|undefined,directory:string|undefined,keep=false;
  try{
    const taskFiles=new OracleFilesystem(),taskText=taskFiles.readFile(path);
    if(taskText===null)throw Error('program oracle task disappeared: '+path);
    const task=JSON.parse(taskText) as ProgramOracleTask;
    directory=join(executables,resultHash(task.subject));
    removeOracleSnapshot(directory);mkdirSync(directory,{recursive:true});
    const request={project:task.project,entry:task.entry,directory,observations:[...task.observations,...taskFiles.captured()],
      ...(task.mode==='observation'?{preloads:[...OUTCOME_ORACLE_PRELOADS],sourceAssets:outcomeSourceAssets()}:{} )};
    owner=await (task.program?worker.prepare(request):worker.prepareTranspiled(request));
    let answer:ProgramAnswer;
    if(task.mode==='calls'){
      const planned=await runOraclePlanner(planner,[task.project],{env:plannerEnv});
      if('budget' in planned)answer={version:1,subject:task.subject,project:task.project,entry:task.entry,kind:'budget',budget:planned.budget};
      else{
        const planText=planned.plan,plan=JSON.parse(planText) as {driver:string;case_count:number};
        const file=join(scratch,'plan.json');writeFileSync(file,planText);
        const result=JSON.parse(execute([file,resultHash(planText),owner.manifest,scratch])) as
          {version:number;provisional:boolean;rows:string[];stdout:number[];stderr:number[];budget?:OracleBudget&{phase:'prepare'|'execute'};residentPeakBytes?:number|null};
        if(Number.isSafeInteger(result.residentPeakBytes)&&result.residentPeakBytes!>0)oraclePeakBytes=result.residentPeakBytes!;
        if(result.version!==1||result.provisional!==true)throw Error('program oracle supervisor returned no provisional answer');
        answer=result.budget?{version:1,subject:task.subject,project:task.project,entry:task.entry,kind:'budget',driverSha256:resultHash(plan.driver),budget:result.budget}
          :{version:1,subject:task.subject,project:task.project,entry:task.entry,kind:'calls',driverSha256:resultHash(plan.driver),count:plan.case_count,
            rows:result.rows,stdout:result.stdout,stderr:result.stderr,replay:owner};
      }
    }else{
      const observation=observeOutcomeNode(owner,task.entry,dirname(task.project));
      if(!observation.complete)throw Error('outcome oracle did not complete: '+observation.result);
      answer={version:1,subject:task.subject,project:task.project,entry:task.entry,kind:'observation',observation:{...observation,complete:true}};
    }
    const final=finishOracleSnapshot(owner);if(!final.ready)throw Error(final.why);
    if(!oracleSnapshotReady(owner).ready)throw Error('program oracle finalizer did not complete');
    const capture=captureProgramOracle(owner);
    if(answer.kind==='calls')requestOracleImprovement(REPOSITORY,task.entry);
    if(answer.kind==='budget')console.error('ORACLE BUDGET: '+task.subject+': '+JSON.stringify(answer.budget));
    // Only executable data needed by rare selected-window replays survives.
    // The warm SDK and its captured package bytes are never retained here.
    keep=answer.kind==='calls';
    if(!keep)removeOracleSnapshot(directory);
    const scopePeakBytes=measuring?readPeak():0;
    const memory:ProgramMemory|undefined=Number.isSafeInteger(scopePeakBytes)&&scopePeakBytes>0?{scopePeakBytes,oraclePeakBytes}:undefined;
    process.stdout.write(JSON.stringify({path,bucket:'oracle-reference',answer,capture,...(memory?{memory}:{})})+'\n');
  }catch(error){process.stdout.write(JSON.stringify({path,bucket:'infrastructure-error',why:error instanceof Error?error.stack:String(error)})+'\n');}
  finally{if(directory&&!keep)removeOracleSnapshot(directory);}
}}finally{worker.close();}
