// A directly launched oracle test owns the same canonical services as tooling.
import {rmSync} from 'node:fs';
import {newTestScratch} from '../gate/test-scratch.ts';

import {after} from 'node:test';
import {ENVIRONMENT_CONTEXT, gateEnvironment, oracleToolchainLocation, sealOracleRun, type GateEnvironment} from '../gate/canonical-environment.ts';
import {finishRunTemporary, removable} from '../gate/run-temporary.ts';

let setup:Promise<void>|undefined,finish:(()=>void)|undefined;
// Setup may be requested lazily inside a test, but the cached environment
// belongs to this test file. Register its cleanup at module (file) scope.
after(()=>finish?.());
export function setupOracleTestEnvironment():Promise<void>{return setup??=ownOracleTestEnvironment();}

async function ownOracleTestEnvironment():Promise<void>{
  if(process.env[ENVIRONMENT_CONTEXT]){
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
    planned=gateEnvironment(process.env,{run:root,standalone:true});
    planned=await sealOracleRun(planned);
    for(const name of Object.keys(process.env))delete process.env[name];
    Object.assign(process.env,planned.env);
  }catch(error){cleanup();throw error;}
}
