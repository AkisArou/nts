// The collector owns this private namespace. A preload records the actual
// entry identity before its body; descendants never inherit the receipt flag.
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {CommandActivitySampler,commandCpuFrequency,commandProcessIdentity,COMMAND_ACTIVITY_POLL_MS} from './active-process.ts';
import {durableRecord} from './durable-record.ts';
import {ToolingInstrumentError} from './step-result.ts';

export type ToolingActivitySample={cpu:number;own:number;busy:boolean;processOwn:{pid:number;cpu:number}};
type Receipt={version:1;nonce:string;file:string;pid:number;started:number;parent:number};
const receiptPath=(directory:string,file:string)=>join(directory,createHash('sha256').update(file).digest('hex')+'.json');

export function readToolingEntry(value:unknown,nonce:string,file:string,parent:number):Receipt{
  if(typeof value!=='object'||value===null)throw new ToolingInstrumentError('tooling-setup','missing tooling entry identity');
  const row=value as Receipt;
  if(row.version!==1||row.nonce!==nonce||row.file!==file||row.parent!==parent||
      !Number.isSafeInteger(row.pid)||row.pid<1||!Number.isSafeInteger(row.started)||row.started<1)
    throw new ToolingInstrumentError('tooling-setup',`tooling entry identity disagrees with its collector: ${file}`);
  return {...row};
}

export class ToolingEntryActivity {
  readonly frequency=commandCpuFrequency();
  readonly preload:string;
  private readonly directory:string;
  private readonly nonce=randomUUID();
  private readonly sampler=new CommandActivitySampler();
  private readonly pending=new Map<string,{sample:(value:ToolingActivitySample)=>void;broken:(error:unknown)=>void;cancel?:()=>void}>();
  private timer:ReturnType<typeof setInterval>|undefined;
  constructor(files:ReadonlySet<string>){
    const temporary=process.env.TMPDIR??join(homedir(),'.cache/nts-tooling');
    mkdirSync(temporary,{recursive:true});
    this.directory=mkdtempSync(join(temporary,'tooling-activity-'));
    try{durableRecord(join(this.directory,'owner.json'),{version:1,nonce:this.nonce,collector:process.pid,files:[...files]});}
    catch(error){rmSync(this.directory,{recursive:true,force:true});throw error;}
    const preload=new URL('./tooling-entry-activity.ts',import.meta.url);preload.searchParams.set('activity',this.directory);
    this.preload=preload.href;
  }
  watch=(file:string,sample:(value:ToolingActivitySample)=>void,broken:(error:unknown)=>void):(()=>void)=>{
    const entry={sample,broken} as {sample:typeof sample;broken:typeof broken;cancel?:()=>void};
    this.pending.set(file,entry);this.attach();
    this.timer??=setInterval(()=>this.attach(),COMMAND_ACTIVITY_POLL_MS);
    return()=>{entry.cancel?.();this.pending.delete(file);if(!this.pending.size&&this.timer){clearInterval(this.timer);this.timer=undefined;}};
  };
  private attach():void{
    for(const [file,entry] of this.pending){
      if(entry.cancel)continue;
      try{
        const path=receiptPath(this.directory,file);if(!existsSync(path))continue;
        if(statSync(path).size>4096)throw Error('oversized tooling entry identity');
        const receipt=readToolingEntry(JSON.parse(readFileSync(path,'utf8')),this.nonce,file,process.pid);
        entry.cancel=this.sampler.watch({group:receipt.pid,started:receipt.started,parent:receipt.parent,scope:'descendants',pollMs:COMMAND_ACTIVITY_POLL_MS,
          sample:(cpu,own,busy,processOwn)=>entry.sample({cpu,own,busy,processOwn}),broken:entry.broken});
      }catch(error){entry.broken(error);}
    }
  }
  sample=():void=>{this.attach();this.sampler.sample();};
  close():void{
    if(this.timer)clearInterval(this.timer);this.timer=undefined;
    for(const entry of this.pending.values())entry.cancel?.();this.pending.clear();
    rmSync(this.directory,{recursive:true,force:true});
  }
}

const activity=new URL(import.meta.url).searchParams.get('activity');
if(activity!==null){
  const own=import.meta.url;
  process.execArgv=process.execArgv.filter((flag,index,all)=>!(flag==='--import'&&all[index+1]===own||index>0&&all[index-1]==='--import'&&flag===own||flag==='--import='+own));
  if(process.env.NODE_TEST_CONTEXT){
    const owner=JSON.parse(readFileSync(join(activity,'owner.json'),'utf8')) as {version:number;nonce:string;collector:number;files:string[]};
    const file=resolve(process.argv[1]!),identity=commandProcessIdentity(process.pid);
    if(owner.version!==1||owner.collector!==process.ppid||!owner.files.includes(file)||!identity)
      throw new ToolingInstrumentError('tooling-setup','tooling entry has no matching collector owner');
    durableRecord(receiptPath(activity,file),{version:1,nonce:owner.nonce,file,pid:process.pid,started:identity.started,parent:process.ppid} satisfies Receipt);
  }
}
