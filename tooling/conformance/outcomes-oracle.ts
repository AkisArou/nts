// Node's observation protocol, shared by the producer and standalone checks.
import {spawnSync} from 'node:child_process';
import {oracleExecution,oracleLoaderReady,closeOracleExecution,finishOracleSnapshot,type OraclePrepared} from '../differential/oracle-emit.ts';
import {OUTCOME_ORACLE_PRELOADS} from './outcomes-project.ts';
import {beforeTerminalDiagnostic} from './output-prefix.ts';

export function observeOutcomeNode(owner:OraclePrepared,entry:string,directory:string){
  const execution=oracleExecution(owner);
  const finish=()=>{const result=finishOracleSnapshot(owner);if(!result.ready)throw Error(result.why);};
  try{
    const ran=spawnSync(process.execPath,[...execution.args,'--no-warnings',...OUTCOME_ORACLE_PRELOADS.flatMap(file=>['--import',file]),entry],
      {encoding:'utf8',timeout:30_000,cwd:directory,env:{...process.env,...execution.env}});
    const printed={stdout:ran.stdout??'',stderr:ran.stderr??''};
    finish();const loaded=oracleLoaderReady(execution);if(!loaded.ready)throw Error('Node oracle loader: '+loaded.why);
    if(ran.signal||ran.error)return {result:`node ${ran.signal??ran.error!.message}`,printed,complete:false};
    const lines=printed.stderr.split('\n'),uncaught=lines.find(line=>line.startsWith('nts: uncaught '));
    if(uncaught)return {result:`exit ${ran.status}; ${uncaught}`,printed:{...printed,stderr:ran.status!==0?beforeTerminalDiagnostic(printed.stderr,'uncaught'):printed.stderr},complete:true};
    const early=lines.find(line=>/^\w*Error(?: \[\w+\])?: /.test(line));
    return {result:`exit ${ran.status}${early?`; before running: ${early.trim()}`:''}`,printed,complete:ran.status===0};
  }finally{try{finish();}finally{closeOracleExecution(execution);}}
}
