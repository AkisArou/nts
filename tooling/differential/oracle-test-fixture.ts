// A directly launched oracle test owns the same canonical services as tooling.
import {rmSync} from 'node:fs';
import {newTestScratch,testScratch} from '../gate/test-scratch.ts';
import {ownMemoryEnv} from '../gate/test-memory.ts';
import {testEnvironment} from '../gate/test-environment.ts';

import {after} from 'node:test';
import {dependencySealReady,ownsDependencyRun} from './oracle-runtime.ts';
import type {DependencyCapability} from './oracle-dependencies.ts';
import {ToolingInstrumentError} from '../gate/step-result.ts';
import {ENVIRONMENT_CONTEXT, gateEnvironment, oracleToolchainLocation, sealOracleRun, type GateEnvironment} from '../gate/canonical-environment.ts';
import {finishRunTemporary, removable} from '../gate/run-temporary.ts';

let setup:Promise<void>|undefined,finish:(()=>void)|undefined;
// Setup may be requested lazily inside a test, but the cached environment
// belongs to this test file. Register its cleanup at module (file) scope.
after(()=>finish?.());
export function setupOracleTestEnvironment():Promise<void>{return setup??=ownOracleTestEnvironment();}

/**
 * The environment a real oracle test's tools run in: this process's, with a
 * memory reading and a ledger of the test's own in place of any reservation
 * the test runs inside, so host load never decides it and no fake reading
 * reaches the machine's ledger.
 */
export function oracleTestEnvironment(t:{after(fn:()=>void):void}):NodeJS.ProcessEnv{
  return ownMemoryEnv(testScratch(t,'oracle-test-memory'));
}

/** A caller-supplied canonical context must already own its pinned services.
 * Otherwise each capture silently gets a separate resolution holder. */
export function requireSealedOracleTestEnvironment(env:NodeJS.ProcessEnv):void{
  const raw=env.NTS_ORACLE_DEPENDENCIES;
  let cap:DependencyCapability|undefined;
  try{cap=raw?JSON.parse(raw) as DependencyCapability:undefined;}catch{ /* named setup refusal below */ }
  const context=JSON.parse(env[ENVIRONMENT_CONTEXT]??'null') as {resolutionOwner?:unknown}|null;
  if(!cap?.seal||process.platform==='linux'&&!context?.resolutionOwner)
    throw new ToolingInstrumentError('tooling-setup','supplied gate environment is not sealed for oracle runs; seal it with sealOracleRun');
  ownsDependencyRun(cap,env,true);dependencySealReady(cap,env);
}

async function ownOracleTestEnvironment():Promise<void>{
  if(process.env[ENVIRONMENT_CONTEXT]){
    requireSealedOracleTestEnvironment(process.env);
    oracleToolchainLocation();
    if(!process.env.NTS_ORACLE_DEPENDENCIES)throw Error('oracle test has no owned dependency capability');
    return;
  }
  const root=newTestScratch('oracle-test-fixtures');
  let planned:GateEnvironment|undefined,closed=false;
  const cleanup=()=>{
    if(closed)return;closed=true;
    if(planned)finishRunTemporary(planned.temporary,planned.env.HOME!,true);
    removable(root);rmSync(root,{recursive:true,force:true});
  };
  finish=cleanup;
  try{
    planned=gateEnvironment(testEnvironment(),{run:root,standalone:true});
    planned=await sealOracleRun(planned);
    for(const name of Object.keys(process.env))delete process.env[name];
    Object.assign(process.env,planned.env);
  }catch(error){cleanup();throw error;}
}
