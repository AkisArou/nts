// Admission is per source entry, through the same case owner as corpus work.
// No historical whole-tooling peak is needed before the first file may run.
import {relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MemoryRun,workerCapBytes} from '../census/worker-memory.ts';
import {runMemoryWorkers} from '../census/worker-pool.ts';
import {isCommandExit} from '../differential/command-entry/main.ts';
import {tokenClient} from './tokens.mjs';
import {publishHung,ToolingInstrumentError,PressureError} from './step-result.ts';
import {readToolingCompletion,type ToolingFileTime,type ToolingTimes,type ToolingResult,type ToolingRequest} from './tooling-runner.ts';
import type {ToolingFileReply} from './tooling-file-worker.ts';
import {hostObservations} from './host-observations.ts';
import {longestFirst,recordCosts} from './costs.mjs';
import {caseIdentity} from './case-memory.ts';
import type {CaseToken} from './admission.ts';

const ROOT=fileURLToPath(new URL('../..',import.meta.url));

/** Preserve dispatch order while a lease waits. Granted files execute
 * concurrently; only the next admission waits for the preceding grant. */
export function orderedToolingAdmission(acquire:CaseToken):CaseToken {
  let pending=Promise.resolve();
  return (path,signal)=>{
    const granted=pending.then(()=>acquire(path,signal));
    pending=granted.then(()=>{},()=>{});
    return granted;
  };
}

/** Completed assertions survive unfinished neighbours and observation errors. */
export function toolingFileResults(files:readonly string[],replies:readonly ToolingFileReply[],times:ToolingTimes,
  resultEnv:NodeJS.ProcessEnv={},poolFailure?:unknown):ToolingResult {
  const expected=new Set(files),seen=new Set<string>(),problems:string[]=[],hung:string[]=[];
  let failed=false,completedFailures=0;
  for(const row of replies){
    if(!expected.has(row.path)||seen.has(row.path)){problems.push('duplicate or unowned tooling file result: '+row.path);continue;}
    seen.add(row.path);
    if(row.bucket!=='tooling'||!row.result){problems.push(row.path+': '+(row.why??row.bucket));continue;}
    let result:ToolingResult;
    try{result=readToolingCompletion({version:2,nonce:'file',...row.result},'file',row.result.status);}
    catch(error){problems.push(row.path+': '+String(error));continue;}
    failed||=result.status===1;completedFailures+=result.completedFailures;
    if(result.observationFailure)problems.push(row.path+': '+result.observationFailure.reason);
    if(row.instrument?.kind==='hung'||result.status===2)hung.push(row.instrument?.reason??row.path+': tooling file did not finish');
    else if(row.instrument)problems.push(row.path+': '+row.instrument.reason);
  }
  for(const file of files)if(!seen.has(file))problems.push('missing tooling file result: '+file);
  if(poolFailure!==undefined)problems.push(String(poolFailure));
  if(hung.length)publishHung(hung.join('\n'),resultEnv,completedFailures);
  if(problems.length){
    const reason=problems.join('\n');
    if(!completedFailures){if(poolFailure instanceof PressureError)throw poolFailure;throw new ToolingInstrumentError('tooling-setup',reason);}
    process.stderr.write('tooling observation failures beside completed assertions:\n'+reason+'\n');
    return {status:1,completedFailures,times,observationFailure:{kind:'tooling-setup',reason}};
  }
  return {status:failed?1:hung.length?2:0,completedFailures,times};
}

/** Ordering may change dispatch time, never the selected inventory. */
export function toolingFileDispatch(files:readonly string[],step:string,root=ROOT):string[]{
  const entries=new Map<string,string>();
  for(const source of files){
    const file=resolve(root,source),key=caseIdentity(step,{project:file,backend:'node'},root).path;
    if(entries.has(key))throw new ToolingInstrumentError('tooling-setup','duplicate tooling file dispatch: '+key);
    entries.set(key,file);
  }
  return longestFirst('tooling-files',[...entries.keys()],key=>resolve(root,key),{untimedFirst:true}).map(key=>entries.get(key)!);
}

export async function runToolingFiles(request:ToolingRequest,options:{resultEnv:NodeJS.ProcessEnv}):Promise<ToolingResult>{
  const where=process.env.NTS_GATE_TOKENS,step=process.env.NTS_GATE_STEP;
  if(!where||!step||process.env.NTS_GATE_TOKEN_HELD)throw new ToolingInstrumentError('tooling-setup','tooling file admission requires the enclosing gate broker');
  const host=hostObservations(),files=request.files.map(file=>resolve(file)),jobs=Math.max(host.availableWidth()-1,1),client=tokenClient(where,step);
  const ordered=toolingFileDispatch(files,step);
  const started=host.now(),replies:ToolingFileReply[]=[],times=new Map<string,ToolingFileTime>();
  let poolFailure:unknown;
  try{
    await runMemoryWorkers({paths:ordered,jobs,memory:new MemoryRun(),workerBytes:workerCapBytes(),
      key:'tooling-files',what:'tooling test files',
      token:orderedToolingAdmission((path,signal)=>client.acquire({project:path,backend:'node'},signal)),
      args:()=>[fileURLToPath(new URL('./tooling-file-worker.ts',import.meta.url)),JSON.stringify({...request,files})],
      report:line=>process.stderr.write(line+'\n'),
      onRow:(row:ToolingFileReply)=>{
        replies.push(row);
        const measured=row.result?.times?.files.find(entry=>entry.file===row.path),elapsed=host.now()-started;
        times.set(row.path,measured&&measured.startedMs!==null&&measured.wallMs!==null
          ?{...measured,startedMs:Math.max(0,elapsed-measured.wallMs)}:{file:row.path,startedMs:null,wallMs:null,passed:null});
      }});
  }catch(error){if(isCommandExit(error))throw error;poolFailure=error;}
  const measured:ToolingTimes={version:1,wallMs:host.now()-started,concurrency:jobs,
    files:files.map(file=>times.get(file)??{file,startedMs:null,wallMs:null,passed:null})};
  recordCosts('tooling-files',Object.fromEntries(measured.files.flatMap(row=>row.wallMs===null?[]:[[relative(ROOT,row.file),row.wallMs/1000]])));
  return toolingFileResults(files,replies,measured,options.resultEnv,poolFailure);
}
