// Shell commands share the standalone entry's admission and sealed lifetime.
import {spawnSync} from 'node:child_process';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {withPreparedOracle} from './canonical-environment.ts';
import {ToolingInstrumentError} from './step-result.ts';
runAsCommand(import.meta.url,async()=>{
  const args=process.argv.slice(2);
  if(!args[0])throw Error('usage: oracle-entry.ts <node script> [arguments...]');
  return withPreparedOracle(env=>{
    const result=spawnSync(process.execPath,[...process.execArgv,...args],{env,stdio:'inherit'});
    if(result.error||result.signal||result.status===null)throw new ToolingInstrumentError('tooling-setup','oracle command did not finish: '+(result.error??result.signal??'missing status'));
    return result.status;
  },{entry:import.meta.url});
});
