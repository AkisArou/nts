// The `rust-inputs` gate step (#761): the workspace's Rust tests run once
// under the file observer, through the same tests.mjs route and test-profile.ts
// build as the `tests` step, and every tracked file they opened must be one a
// change to which owes the tests (rust-input-coverage.ts).
//
//   node tooling/gate/rust-inputs.ts          (the gate's `rust-inputs` step)
//
// Selection owes the tests only for what those declarations reach; this step
// is what makes a test that reads a tracked file no change to which would owe
// the tests fail. The observer follows every process a test starts, and
// records directory listings and failed lookups beside opens.
//
// One run sees only the reads of the conditions it ran under: a read taken
// only under another environment, input or host is unseen until a run takes
// it. So the step runs on every wide run, never once: drift is red at the
// first wide run that makes the read, and the culprit search bisects that red
// to the commit that added it.
// The capture lives in the step's own temporary, which the runner claims on
// disk before the step's slots and memory and hands to it (run.mjs,
// NTS_GATE_STEP_DISK); the step proves the claim is held, writes only beneath
// it, and removes it once checked. coverage.json in the run directory keeps
// the result.
import {spawnSync} from 'node:child_process';
import {mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAsCommand,exitCommand,isCommandExit,registerCommandCloser} from '../differential/command-entry/main.ts';
import {ENVIRONMENT_CONTEXT} from '../differential/oracle-seal/main.ts';
import type {Context} from './environment-types.ts';
import {DiskCapacity} from './disk-capacity.ts';
import {durableRecord} from './durable-record.ts';
import {ToolingInstrumentError,publishToolingFailure} from './step-result.ts';
import {coverageOfCaptures,traceCaptures,declaredRustInputs,trackedPaths,describeCoverage,testReach} from './rust-input-coverage.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {gitArguments} from './git-arguments/main.ts';
import {stepPhaseClient} from './step-phase.ts';

const TESTS=fileURLToPath(new URL('./tests.mjs',import.meta.url));

runAsCommand(import.meta.url,async()=>{
  const enterPhase=stepPhaseClient();
  const run=process.env.NTS_GATE_RUN_DIR,raw=process.env[ENVIRONMENT_CONTEXT];
  if(!run||!raw)throw new ToolingInstrumentError('tooling-setup','rust-inputs runs inside a gate run (NTS_GATE_RUN_DIR and its environment context)');
  const context=JSON.parse(raw) as Context,capture=join(context.temporary.path,'rust-inputs');
  // The runner's claim, held for exactly this temporary: never one of the step's own.
  const handed=process.env.NTS_GATE_STEP_DISK;
  if(!handed)throw new ToolingInstrumentError('tooling-setup','rust-inputs runs with the disk claim its runner hands it (NTS_GATE_STEP_DISK)');
  const claim=JSON.parse(handed) as {path:string;bytes:number;id:string},held=new DiskCapacity({}).heldTemporary(claim.id);
  if(claim.path!==capture||!held||held.path!==capture||held.bytes!==claim.bytes)throw new ToolingInstrumentError('tooling-setup',`rust-inputs: its runner's disk claim ${claim.id} is not held for ${capture}`);
  console.log(`  capture: ${capture}, under its runner's claim of ${(claim.bytes/2**30).toFixed(1)} GiB`);
  registerCommandCloser('rust-inputs capture',{close:()=>{rmSync(capture,{recursive:true,force:true});}});
  const trace=join(capture,'trace'),reports=join(capture,'reports');mkdirSync(trace,{recursive:true});
  // The traced run is this step's own tests.mjs, in this step's environment.
  process.env.NTS_RUST_INPUT_TRACE=trace;
  const tests=spawnSync(process.execPath,[TESTS],{stdio:'inherit'});
  if(tests.error||tests.signal)throw new ToolingInstrumentError('tooling-setup','rust-inputs: traced tests '+(tests.signal?'killed by '+tests.signal:'not started: '+tests.error?.message));
  if(tests.status!==0){console.log(`  the traced tests exited ${tests.status}; their own step reports why`);exitCommand(tests.status??1);}
  await enterPhase('coverage');
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
