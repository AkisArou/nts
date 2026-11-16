import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertSealedOracleRun} from '../differential/oracle-seal/main.ts';
import {DELTA_FILE} from './delta.ts';
import {createRecorder,type Pending,type RecordTable,type Runner} from './recorder-core.ts';
// **Each recorder runs under the shared supervisor** (tooling/gate/case-bound.ts):
// its cases are bounded one by one inside it, and these bound the recorder
// itself, so one past them fails here instead of holding the full check.
export const RECORDER_CPU_SECONDS = 4 * 3600;
export const RECORDER_IDLE_SECONDS = 30 * 60;
const CASE_BOUND = fileURLToPath(new URL("../gate/case-bound.ts", import.meta.url));
/** The command one recorder run is: node, through the supervisor. */
export function recorderCommand(args: readonly string[]): [string, string[]] {
  return [process.execPath, [CASE_BOUND, "--cpu", String(RECORDER_CPU_SECONDS), "--idle", String(RECORDER_IDLE_SECONDS), "--", process.execPath, ...args]];
}
const runNode = (args:string[],root:string,env:NodeJS.ProcessEnv):number => {
  const [command, argv] = recorderCommand(args);
  return spawnSync(command, argv, { cwd: root, stdio: "inherit", env }).status ?? 1;
};

export type RecordingRequest={kinds:readonly string[];after:{part:'core'|'wide';run:string}|null;delta:string|undefined};
export type RecorderRequest={apply:readonly string[]}|{status:2}|RecordingRequest;
/** Decode before preparing: wrong calls and pure delta application create no oracle session. */
export function recorderRequest(argv:readonly string[],KINDS:readonly string[],env:NodeJS.ProcessEnv):RecorderRequest{
 if(argv[0]==='--apply')return {apply:argv.slice(1)};
 const after=argv[0]==='--after'?{part:argv[1],run:argv[2]}:null;
 let named=after?argv.slice(3):argv;
 let delta=after?.run?join(after.run,DELTA_FILE):undefined,badDelta=false;
 if(named[0]==='--delta'){delta=named[1];badDelta=!delta;named=named.slice(2);}
 const unknown=named.filter(kind=>!KINDS.includes(kind));
 const badAfter=after&&((after.part!=='core'&&after.part!=='wide')||!after.run||!existsSync(after.run));
 if(unknown.length||badAfter||badDelta||!env.NTS_BIN){
  console.error(`usage: NTS_BIN=<main's pin> node tooling/records/record-pending.ts [--after core|wide <run>] [--delta <file>] [${KINDS.join('|')} ...]`
   +` | node tooling/records/record-pending.ts --apply <delta>${unknown.length?`; unknown: ${unknown.join(' ')}`:''}`
   +`${badAfter?'; --after needs core or wide and an existing run folder':''}${badDelta?'; --delta needs a file':''}`);
  return {status:2};
 }
 return {kinds:named.length?named:KINDS,after:after as RecordingRequest['after'],delta:delta&&resolve(delta)};
}
/** The entry supplies a prepared context. Library construction never prepares or samples the ambient environment. */
export function createRecorderCommand(table:RecordTable,env:NodeJS.ProcessEnv){
 assertSealedOracleRun(env);
 const run:Runner=(args,root)=>runNode(args,root,env),recorder=createRecorder(table,run);
 function command(request:RecordingRequest,root=resolve(fileURLToPath(new URL('../..',import.meta.url)))):number{
  const {after,delta}=request,kinds=request.kinds.filter(kind=>!after||recorder.partOf(kind)===after.part);
  const accepted=after?recorder.acceptedIn(root,after.run):{byKind:new Map<string,Pending[]>(),pendingByKind:new Map<string,Pending[]>(),unowned:[]};
  for(const record of accepted.unowned)console.log(`an accepted change names ${record}, which no kind records; skipped`);
  return recorder.recordPending(root,kinds,run,line=>console.log(line),accepted.byKind,delta,accepted.pendingByKind);
 }
 return {...recorder,command};
}
