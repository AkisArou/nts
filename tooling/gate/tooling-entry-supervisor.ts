// The controller survives a file's synchronous body and its finite scope cap.
import type {ChildProcess} from 'node:child_process';
import type {Readable} from 'node:stream';
import {CommandActivitySampler,commandCpuFrequency,commandProcessIdentity,COMMAND_ACTIVITY_POLL_MS} from './active-process.ts';
import {CommandLiveness,COMMAND_STARTUP_BOUND_MS} from './command-liveness.ts';
import {hostObservations} from './host-observations.ts';
import {ToolingInstrumentError} from './step-result.ts';
import {ToolingEntryEvidence} from './tooling-entry-channel.ts';

const sampler=new CommandActivitySampler();
export class ToolingEntrySupervisor {
  readonly evidence:ToolingEntryEvidence;
  hung:string|undefined;
  error:ToolingInstrumentError|undefined;
  private readonly clock=hostObservations().now;
  private readonly live:CommandLiveness;
  private cancelWatch=()=>{};
  private readonly timer:ReturnType<typeof setInterval>;
  private pending='';
  private closed=false;
  private observed=false;
  private readonly channel:Readable;
  private readonly child:ChildProcess;
  private readonly stop:()=>void;
  constructor(child:ChildProcess,file:string,nonce:string,idleMs:number,stop:()=>void){
    this.child=child;this.stop=stop;
    if(!child.pid)throw new ToolingInstrumentError('tooling-setup','tooling entry has no spawned identity');
    this.evidence=new ToolingEntryEvidence(file,nonce,child.pid);
    this.live=new CommandLiveness(file,{idleMs,startupMs:COMMAND_STARTUP_BOUND_MS,budgetOwner:'enclosing-step'},this.clock(),commandCpuFrequency());
    const channel=child.stdio[3];
    if(!channel||!('setEncoding' in channel))throw new ToolingInstrumentError('tooling-setup','tooling entry has no private descriptor');
    this.channel=channel as Readable;this.channel.setEncoding('utf8');this.channel.on('data',this.data);this.channel.on('error',this.broken);
    this.channel.on('end',this.end);
    child.once('spawn',this.spawned);
    const period=Math.min(COMMAND_ACTIVITY_POLL_MS,idleMs);
    this.timer=setInterval(()=>{try{sampler.sample();}catch(error){this.broken(error);}},period);
  }
  touch=():void=>{if(!this.closed&&!this.hung&&!this.error)try{this.live.output(this.clock());}catch(error){this.broken(error);}};
  private spawned=():void=>{
    try{
      const pid=this.child.pid!,identity=commandProcessIdentity(pid);
      if(!identity||identity.parent!==process.pid)throw Error('tooling entry has no matching spawned parent identity');
      this.observed=true;this.live.baseline(identity.cpu);
      this.cancelWatch=sampler.watch({group:pid,started:identity.started,parent:identity.parent,scope:'descendants',
        pollMs:Math.min(COMMAND_ACTIVITY_POLL_MS,this.live.idle),broken:this.broken,
        sample:(cpu,own,busy,processOwn)=>{
          if(this.closed||this.hung||this.error)return;
          try{
            const decision=this.live.sample({now:this.clock(),cpu,own,busy,processOwn,entered:this.evidence.ready});
            if(!decision)return;
            if(decision.kind==='startup')return this.broken(Error(decision.reason));
            if(decision.kind!=='hung')throw Error('tooling entry received an undelegated budget decision');
            this.hung=`tooling file NOT RUN (hung): ${this.evidence.file}; ${decision.reason}; open tests: ${[...this.evidence.open.values()].join(', ')}`;
            this.evidence.seal();this.stop();
          }catch(error){this.broken(error);}
        }});
    }catch(error){this.broken(error);}
  };
  private data=(chunk:string):void=>{
    try{
      this.pending+=chunk;
      if(this.pending.length>256*1024)throw Error('tooling entry channel exceeded its frame bound');
      let at:number;
      while((at=this.pending.indexOf('\n'))>=0){
        const line=this.pending.slice(0,at);this.pending=this.pending.slice(at+1);
        this.evidence.accept(JSON.parse(line));this.touch();
      }
    }catch(error){this.broken(error);}
  };
  private end=():void=>{if(this.pending)this.broken(Error('tooling entry channel ended mid-frame'));};
  private broken=(error:unknown):void=>{
    if(this.error||this.closed)return;
    this.error=error instanceof ToolingInstrumentError?error:new ToolingInstrumentError('tooling-setup','cannot observe tooling entry: '+String(error));
    this.evidence.seal();
    try{this.stop();}catch(cleanup){this.error=new ToolingInstrumentError('tooling-cleanup',this.error.message+'; '+String(cleanup));}
  };
  finish():void{
    if(this.closed)return;this.closed=true;this.evidence.seal();clearInterval(this.timer);this.cancelWatch();
    this.child.off('spawn',this.spawned);this.channel.off('data',this.data);this.channel.off('error',this.broken);this.channel.off('end',this.end);
    if(!this.observed&&!this.error)this.error=new ToolingInstrumentError('tooling-setup','missing tooling entry process observation');
  }
}
