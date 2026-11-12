import {gitArguments} from "./git-arguments.ts";
// Measure the complete cold inner build set, without running its test cases.
// Only declared Cargo output roots enter the record; target scratch/evidence
// never does. --cold explicitly discards these idle build caches through Cargo.
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {innerBuildOutputs,clippyTarget} from './build-targets.ts';
import {TEST_PROFILE} from './test-profile.ts';
import {hostObservations,type HostObservations} from './host-observations.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {durableRecord} from './durable-record.ts';
import {treeUsers} from '../landing/tree-users.ts';
import {defaultSlots} from './budget.ts';

export type FootprintSample={elapsedMs:number;allocatedBytes:number;outputs:Record<string,number>};
export type ColdBuildFootprint={version:1;kind:'cold-inner';profile:string;clippyCache:string;source:string;toolchain:string;
  commands:{args:string[];status:number}[];samples:FootprintSample[];peakAllocatedBytes:number;finalAllocatedBytes:number};

export function buildFootprintSample(outputs:readonly {name:string;path:string}[],host:HostObservations,began:number):FootprintSample {
  const measured=Object.fromEntries(outputs.map(output=>[output.name,host.allocatedBytes(output.path)]));
  return {elapsedMs:host.now()-began,allocatedBytes:Object.values(measured).reduce((sum,bytes)=>sum+bytes,0),outputs:measured};
}

export async function measureColdBuild(root:string,target:string,env:NodeJS.ProcessEnv):Promise<ColdBuildFootprint> {
  const host=hostObservations(env),outputs=innerBuildOutputs(target);
  for(const output of outputs){const users=treeUsers(output.path);if(users.length)throw Error('cold build output is in use: '+output.path+' ('+users.map(user=>user.pid).join(', ')+')');}
  const checked=(options:string[])=>{
    const ran=spawnSync('cargo',['clean',...options],{cwd:root,env,stdio:'inherit'});
    if(ran.error||ran.status!==0)throw Error('cold build cache preparation: '+(ran.error?.message??ran.signal??ran.status));
  };
  // Whole Cargo profiles only: no retained fingerprint may name deleted output.
  checked(['--profile',TEST_PROFILE,'--target-dir',target]);
  checked(['--target-dir',clippyTarget(target)]);
  const began=host.now(),samples:FootprintSample[]=[],commands:ColdBuildFootprint['commands']=[];
  const sample=()=>samples.push(buildFootprintSample(outputs,host,began));
  sample();
  const collect=setInterval(sample,500);
  const testOwner=fileURLToPath(new URL('./test-profile.ts',import.meta.url));
  const clippyOwner=fileURLToPath(new URL('./clippy.ts',import.meta.url));
  const steps=[
    {command:process.execPath,args:[clippyOwner],shown:['node','tooling/gate/clippy.ts']},
    {command:'cargo',args:['build','--profile',TEST_PROFILE,'-p','nts-cli'],shown:['cargo','build','--profile',TEST_PROFILE,'-p','nts-cli']},
    {command:process.execPath,args:[testOwner,'workspace','--no-run'],shown:['node','tooling/gate/test-profile.ts','workspace','--no-run']},
  ];
  try{
    for(const step of steps){
      const child=spawn(step.command,step.args,{cwd:root,env:{...env,CARGO_TARGET_DIR:target,CARGO_INCREMENTAL:'1',CARGO_BUILD_JOBS:String(defaultSlots(host.availableWidth()))},stdio:'inherit'});
      const status=await new Promise<number>((done,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>signal?reject(Error('cold build killed by '+signal)):done(code??2));});
      commands.push({args:step.shown,status});sample();
      if(status!==0)throw Error('cold build failed: '+step.shown.join(' ')+' ('+status+')');
    }
  }finally{clearInterval(collect);sample();}
  const source=infrastructureProbe({purpose:'identify the cold build source',command:'git',args:gitArguments(['rev-parse','HEAD']),cwd:root,env}).stdout.trim();
  const toolchain=infrastructureProbe({purpose:'identify the cold build toolchain',command:'rustc',args:['-vV'],cwd:root,env}).stdout.trim();
  return {version:1,kind:'cold-inner',profile:TEST_PROFILE,clippyCache:'clippy',source,toolchain,commands,samples,
    peakAllocatedBytes:Math.max(...samples.map(row=>row.allocatedBytes)),finalAllocatedBytes:samples.at(-1)!.allocatedBytes};
}

runAsCommand(import.meta.url,async()=>{
  const args=process.argv.slice(2);
  if(args.length!==3||args[0]!=='--cold'||args[1]!=='--output')throw Error('usage: build-footprint.ts --cold --output <record.json>');
  const root=fileURLToPath(new URL('../..',import.meta.url)),target=resolve(root,process.env.CARGO_TARGET_DIR??'target');
  // Read before cleaning, so a misspelled workspace cannot remove another cache.
  readFileSync(join(root,'Cargo.toml'));
  const dirty=infrastructureProbe({purpose:'verify committed cold-build inputs',command:'git',args:gitArguments(['status','--porcelain']),cwd:root}).stdout;
  if(dirty.trim())throw Error('cold build measurement requires committed inputs: '+dirty.trim());
  const record=await measureColdBuild(root,target,process.env);
  durableRecord(resolve(args[2]!),record);
  console.log('cold inner build footprint: '+record.peakAllocatedBytes+' allocated bytes, '+record.samples.length+' samples');
  return 0;
});
