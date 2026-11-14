// Read-only acquisition from the pinned Node spawn channel. Reports are not
// needed to discover a test entry, and this observer gains no signal owner.
import {ChildProcess} from 'node:child_process';
import {tracingChannel} from 'node:diagnostics_channel';
import {resolve} from 'node:path';
import {CommandActivitySampler,commandCpuFrequency,commandProcessIdentity,COMMAND_ACTIVITY_POLL_MS} from './active-process.ts';
import {ToolingInstrumentError} from './step-result.ts';

export type ToolingActivitySample={cpu:number;own:number;busy:boolean;processOwn:{pid:number;cpu:number}};
type Identity={pid:number;started:number;parent:number;cpu:number;own:number;busy:boolean};
export function ownedToolingSpawn(value:unknown,files:ReadonlySet<string>):{file:string;child:ChildProcess}|undefined{
  if(typeof value!=='object'||value===null)return;
  const row=value as {process?:unknown;options?:{file?:unknown;args?:unknown;envPairs?:unknown}};
  if(!(row.process instanceof ChildProcess)||row.options?.file!==process.execPath||!Array.isArray(row.options.args)
      ||!row.options.args.every((value:unknown)=>typeof value==='string')||!Array.isArray(row.options.envPairs)
      ||!row.options.envPairs.includes('NODE_TEST_CONTEXT=child-v8'))return;
  const args=row.options.args;
  if(args[0]!==process.execPath)return;
  // The pinned runner passes normalized single-token Node options, with only
  // its explicit preload pairs separate. NODE_OPTIONS' allowed flag set rules
  // out eval/print/run and other alternate entry modes without parsing JS.
  for(let index=1;index<args.length-1;index++){
    const flag=args[index] as string;
    if(flag==='--'){if(index!==args.length-2)return;break;}
    if(!process.allowedNodeEnvironmentFlags.has(flag))return;
    if(['--import','--require','-r','--loader','--experimental-loader'].includes(flag)){
      if(++index>=args.length-1)return;
    }
  }
  const entry=row.options.args.at(-1);if(typeof entry!=='string'||!files.has(resolve(entry)))return;
  return {file:resolve(entry),child:row.process};
}
const spawnChannel=tracingChannel('child_process.spawn').start;
export class ToolingEntryActivity {
  readonly frequency=commandCpuFrequency();
  private readonly sampler=new CommandActivitySampler();
  private readonly identities=new Map<string,Identity>();
  private readonly entries=new Map<string,{sample:(value:ToolingActivitySample)=>void;broken:(error:unknown)=>void;cancel?:()=>void}>();
  private readonly listeners=new Set<()=>void>();
  private readonly subscription:(value:unknown)=>void;
  constructor(files:ReadonlySet<string>,started:(file:string)=>void,broken:(error:unknown)=>void){
    this.subscription=value=>{
      const observed=ownedToolingSpawn(value,files);if(!observed)return;
      const {file,child}=observed;
      // The channel's start identifies the actual launch before PID assignment.
      // It arms a named setup backstop even if no spawn/report arrives.
      started(file);
      const forget=()=>{child.off('spawn',spawned);child.off('error',failed);this.listeners.delete(forget);};
      const failed=(error:Error)=>{forget();broken(new ToolingInstrumentError('tooling-setup',`cannot spawn tooling entry ${file}: ${error.message}`));};
      const spawned=()=>{
        forget();
        try{
          const identity=commandProcessIdentity(child.pid!);
          if(!identity||identity.parent!==process.pid)throw Error('spawned tooling entry has no matching parent identity');
          this.identities.set(file,{pid:child.pid!,started:identity.started,parent:identity.parent,cpu:identity.cpu,own:identity.own,busy:identity.busy});
          this.attach(file);started(file);
        }catch(error){broken(error);}
      };
      this.listeners.add(forget);child.once('spawn',spawned);child.once('error',failed);
    };
    spawnChannel.subscribe(this.subscription);
  }
  watch=(file:string,sample:(value:ToolingActivitySample)=>void,broken:(error:unknown)=>void):(()=>void)=>{
    const entry={sample,broken} as {sample:typeof sample;broken:typeof broken;cancel?:()=>void};
    this.entries.set(file,entry);this.attach(file);
    return()=>{entry.cancel?.();this.entries.delete(file);};
  };
  private attach(file:string):void{
    const entry=this.entries.get(file),identity=this.identities.get(file);if(!entry||entry.cancel||!identity)return;
    entry.sample({cpu:identity.cpu,own:identity.own,busy:identity.busy,processOwn:{pid:identity.pid,cpu:identity.own}});
    entry.cancel=this.sampler.watch({group:identity.pid,started:identity.started,parent:identity.parent,scope:'descendants',pollMs:COMMAND_ACTIVITY_POLL_MS,
      sample:(cpu,own,busy,processOwn)=>entry.sample({cpu,own,busy,processOwn}),broken:entry.broken});
  }
  sample=():void=>{this.sampler.sample();};
  close():void{
    spawnChannel.unsubscribe(this.subscription);
    for(const forget of this.listeners)forget();
    for(const entry of this.entries.values())entry.cancel?.();this.entries.clear();this.identities.clear();
  }
}
