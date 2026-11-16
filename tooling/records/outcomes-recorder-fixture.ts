import {fileURLToPath} from 'node:url';
import {createRecorderCommand,recorderRequest} from './recorder-command.ts';
import {createRecorder} from './recorder-core.ts';
import {outcomesFamily} from '../conformance/outcomes-record-family.ts';
import {withPreparedOracle} from '../gate/canonical-environment.ts';
import {oracleCommandOptions} from '../gate/oracle-entry-options.ts';
import {runAsCommand} from '../differential/command-entry/main.ts';
const table={outcomes:{family:outcomesFamily,steps:['outcomes'],part:'core' as const}},recorder=createRecorder(table);
runAsCommand(import.meta.url,async()=>{
 const request=recorderRequest(process.argv.slice(2),recorder.KINDS,process.env);
 if('apply' in request){process.exitCode=await recorder.applyCommand(fileURLToPath(new URL('../..',import.meta.url)),request.apply);return;}
 if('status' in request){process.exitCode=request.status;return;}
 process.exitCode=await withPreparedOracle(env=>createRecorderCommand(table,env).command(request),{entry:import.meta.url,ambient:true,owned:oracleCommandOptions(process.env,{NTS_BIN:'text'})})??0;
});
