// Compiler builds and doctest prerequisite compilation share one admitted
// build lifetime. Listing examples builds their exact Cargo graph without
// executing or compiling the examples themselves.
import {rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {cargoSync} from './cargo.ts';
import {DiskCapacity} from './disk-capacity.ts';
import {runTestProfile} from './test-profile.ts';
import {runAsCommand,isCommandExit} from '../differential/command-entry/main.ts';
import {ToolingInstrumentError,publishToolingFailure} from './step-result.ts';

export async function build(args:readonly string[],env:NodeJS.ProcessEnv=process.env,cwd=process.cwd()):Promise<number>{
  const [flag,profile,...tail]=args,gate=tail.indexOf('--gate'),rest=gate<0?tail:tail.slice(0,gate);
  if(flag!=='--profile'||!['release','nts-dev'].includes(profile??'')||rest.some(arg=>arg!=='--no-compiler'))
    throw new ToolingInstrumentError('tooling-setup','build: expected --profile <release|nts-dev> [--no-compiler] [--gate steps...]');
  if(gate>=0){
    const requested=tail.slice(gate+1),raw=requested.length?requested.join(' '):env.NTS_GATE_STEPS;
    if(requested.length&&env.NTS_GATE_STEPS?.trim())throw new ToolingInstrumentError('tooling-setup','build: gate steps supplied both as arguments and NTS_GATE_STEPS');
    const selected=raw===undefined||raw.trim()===''||raw.trim().split(/\s+/).includes('doctests');
    if(selected&&!env.NTS_GATE_RUN_DIR)throw new ToolingInstrumentError('tooling-setup','build: doctest preparation needs the gate run directory');
    env={...env,NTS_BUILD_DOCTESTS:selected?'1':'0',
      NTS_DOCTEST_PREPARATION:selected?join(env.NTS_GATE_RUN_DIR!,'doctest-build.json'):undefined};
  }
  const preparation=env.NTS_BUILD_DOCTESTS==='1'?env.NTS_DOCTEST_PREPARATION:undefined;
  if(env.NTS_BUILD_DOCTESTS==='1'&&(!preparation||resolve(preparation)!==preparation))
    throw new ToolingInstrumentError('tooling-setup','build: doctests needs an absolute preparation receipt');
  if(preparation)rmSync(preparation,{force:true});
  const release=(profile==='nts-dev'||preparation)?new DiskCapacity({env}).beginBuild({root:cwd,target:resolve(cwd,env.CARGO_TARGET_DIR??'target'),outputs:['nts-dev']}):()=>{};
  try{
    if(!rest.includes('--no-compiler')){
      const ran=cargoSync(['build','--profile',profile!],{cwd,env,stdio:'inherit'});
      if(ran.error||ran.signal)throw new ToolingInstrumentError('tooling-setup','build: Cargo '+(ran.error?.message??'killed by '+ran.signal));
      if(ran.status!==0)return ran.status??2;
    }
    return preparation?await runTestProfile('doctests-build',[],env,cwd,{artifacts:preparation}):0;
  }finally{release();}
}

runAsCommand(import.meta.url,async()=>{
  try{return await build(process.argv.slice(2));}
  catch(error){
    if(isCommandExit(error))throw error;
    if(error instanceof ToolingInstrumentError){publishToolingFailure(error);console.error('NOT MEASURED: '+String(error));return 2;}
    throw error;
  }
});
