// The `rust-inputs` gate step (#761): the workspace's Rust tests run once
// under the file observer, through the same tests.mjs route and test-profile.ts
// build as the `tests` step, and every tracked file they opened must be one a
// change to which owes the tests (rust-input-coverage.ts).
//
//   node tooling/gate/rust-inputs.ts          (the gate's `rust-inputs` step)
//
// Selection owes the tests only for what those declarations reach; this step
// is what makes a test that reads a tracked file no change to which would owe
// the tests fail. It is wide:
// the full check runs it, and a red bisects to the commit that added the read.
// The capture lives in the run's registered temporary under a disk claim and
// is removed once checked; coverage.json in the run directory keeps the result.
import {spawnSync} from 'node:child_process';
import {mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAsCommand,exitCommand,isCommandExit,registerCommandCloser} from '../differential/command-entry/main.ts';
import {ENVIRONMENT_CONTEXT} from '../differential/oracle-seal/main.ts';
import type {Context} from './environment-types.ts';
import {TemporaryAdmission} from './admission.ts';
import {durableRecord} from './durable-record.ts';
import {ToolingInstrumentError,publishToolingFailure} from './step-result.ts';
import {coverageOfCaptures,traceCaptures,declaredRustInputs,trackedPaths,describeCoverage,testReach} from './rust-input-coverage.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {gitArguments} from './git-arguments/main.ts';

// The workspace capture measured 4.8 GiB at 1e421fac88 with its validation
// reports beside it (#761 record). A larger capture holds rather than filling
// the disk past its floor.
export const RUST_INPUT_CAPTURE_BYTES=12*2**30;
const TESTS=fileURLToPath(new URL('./tests.mjs',import.meta.url));

runAsCommand(import.meta.url,async()=>{
  const run=process.env.NTS_GATE_RUN_DIR,raw=process.env[ENVIRONMENT_CONTEXT];
  if(!run||!raw)throw new ToolingInstrumentError('tooling-setup','rust-inputs runs inside a gate run (NTS_GATE_RUN_DIR and its environment context)');
  const context=JSON.parse(raw) as Context,capture=join(context.temporary.path,'rust-inputs');
  const admission=new TemporaryAdmission({path:capture,context:{kind:'gate',temporary:context.temporary},reservedBytes:RUST_INPUT_CAPTURE_BYTES});
  const {lease}=await admission.acquire({what:'rust-inputs capture',report:line=>console.log('  '+line)});
  registerCommandCloser('rust-inputs capture and disk claim',{close:()=>{try{rmSync(capture,{recursive:true,force:true});}finally{lease.release();}}});
  const trace=join(capture,'trace'),reports=join(capture,'reports');mkdirSync(trace,{recursive:true});
  // The traced run is this step's own tests.mjs, in this step's environment.
  process.env.NTS_RUST_INPUT_TRACE=trace;
  const tests=spawnSync(process.execPath,[TESTS],{stdio:'inherit'});
  if(tests.error||tests.signal)throw new ToolingInstrumentError('tooling-setup','rust-inputs: traced tests '+(tests.signal?'killed by '+tests.signal:'not started: '+tests.error?.message));
  if(tests.status!==0){console.log(`  the traced tests exited ${tests.status}; their own step reports why`);exitCommand(tests.status??1);}
  const root=infrastructureProbe({purpose:'rust-inputs tree',command:'git',args:gitArguments(['rev-parse','--show-toplevel']),cwd:process.cwd()}).stdout.trim();
  let result;
  try{result=await coverageOfCaptures({root,captures:traceCaptures(root,trace),reports,targets:declaredRustInputs(root),tracked:trackedPaths(root),reach:testReach});}
  catch(error){
    if(isCommandExit(error))throw error;
    const failure=new ToolingInstrumentError('tooling-setup','rust-inputs coverage: '+String(error),{cause:error});
    publishToolingFailure(failure);console.error('NOT MEASURED: '+failure.message);exitCommand(2);
  }
  durableRecord(join(run,'rust-inputs.coverage.json'),{version:1,...result});
  for(const line of describeCoverage(result))console.log(line);
  exitCommand(result.missed.length?1:0);
});
