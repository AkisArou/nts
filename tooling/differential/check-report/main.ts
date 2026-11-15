import {runAsCommand} from '../command-entry/main.ts';
import assert from 'node:assert/strict';
import {withPreparedOracle} from '../../gate/canonical-environment.ts';
import {runCheck,runConsumer} from '../check-command.ts';
import {finishCheckStep,projectCheck,reportCheckFailure} from '../check-report.ts';
runAsCommand(import.meta.url,async()=>{
  const [command,requested,binary,project]=process.argv.slice(2);
  try{
    if(command==='finish'){process.exitCode=finishCheckStep(Number(requested));return;}
    assert.ok(binary&&project,'usage: check-report/main.ts consume|project <consumer> <nts> <project>');
    assert.ok(command==='project'||command==='consume','unknown check command');
    if(command==='project')assert.ok(requested==='compiled-answers'||requested==='backend-refusals','unknown check projection');
    else assert.ok(requested==='program'||requested==='benchmark'||requested==='refusal','unknown check consumer');
    await withPreparedOracle(()=>{}, {entry:import.meta.url,ambient:true});
    if(command==='project'){
      const projection=requested as 'compiled-answers'|'backend-refusals';
      const {record}=await runCheck(binary,project);
      for(const line of projectCheck(record,projection))console.log(line);
    }else{
      const {result,exitCode}=await runConsumer(binary,project,requested as 'program'|'benchmark'|'refusal');
      process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.exitCode=exitCode;
    }
  }catch(error){console.error('check NOT MEASURED:',error instanceof Error?error.message:String(error));process.exitCode=reportCheckFailure(error);}
});
