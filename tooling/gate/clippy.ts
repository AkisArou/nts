// The same Cargo command and cache for contributors, inner and the gate.
import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {assertClippyTarget,clippyTarget} from './build-targets.ts';
import {completeBuild} from './build-completion.ts';
import {DiskCapacity} from './disk-capacity.ts';

export const CLIPPY_ARGUMENTS=['clippy','--workspace','--all-targets','--','-D','warnings'] as const;
export function clippyEnvironment(basis:'root'|'cache',env:NodeJS.ProcessEnv,cwd:string):NodeJS.ProcessEnv {
  const selected=basis==='cache'&&env.CARGO_TARGET_DIR!==undefined?assertClippyTarget(env.CARGO_TARGET_DIR)
    :clippyTarget(env.CARGO_TARGET_DIR??join(cwd,'target'));
  return {...env,CARGO_TARGET_DIR:selected};
}

runAsCommand(import.meta.url,()=>{
  const args=process.argv.slice(2);
  if(args.length>1||args.length===1&&args[0]!=='--cache')throw Error('usage: clippy.ts [--cache]');
  const env=clippyEnvironment(args[0]==='--cache'?'cache':'root',process.env,process.cwd());
  const release=new DiskCapacity({env}).beginBuild({root:process.cwd(),target:dirname(env.CARGO_TARGET_DIR!),outputs:['clippy']});
  try{
  const ran=spawnSync('cargo',CLIPPY_ARGUMENTS,{env,stdio:'inherit'});
  if(ran.error||ran.signal)throw Error('Clippy command: '+(ran.error?.message??'killed by '+ran.signal));
  if(ran.status===0)completeBuild(process.cwd(),'clippy',env.CARGO_TARGET_DIR!);
  return ran.status??2;
  }finally{release();}
});
