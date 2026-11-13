// One synchronous entry boundary for modules that are also commands.
import {realpathSync,writeSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

type Command=()=>number|void|Promise<number|void>;
export type CommandSignal='SIGINT'|'SIGTERM'|'SIGHUP';
export type CloseReason={kind:'completion'}|{kind:'failure';error?:unknown}|{kind:'signal';signal:CommandSignal};
export type CloseContext={reason:CloseReason;code:number;failures:readonly string[]};
export type CommandCloser={cancel?:(reason:Exclude<CloseReason,{kind:'completion'}>)=>void;close:(context:CloseContext)=>void|Promise<void>;closed?:()=>Promise<void>};
export const COMMAND_CLOSE_MS=5*60_000;
type CloseHost={arm:(callback:()=>void,milliseconds:number)=>()=>void;report:(line:string)=>void;exit:(code:number)=>void};
const signalCode={SIGINT:130,SIGTERM:143,SIGHUP:129} as const;

/** One terminal drain, including repeated signals and resources registered
 * during cancellation. Cancellation never destroys a peer's reply transport.
 * Destruction follows reverse acquisition order, under one total wedge guard. */
export class CommandLifetime{
  #resources=new Map<number,{name:string;owner:CommandCloser;cancelled:boolean}>();
  #next=0;
  #reason:CloseReason={kind:'completion'};
  #code=0;
  #closing:Promise<number>|undefined;
  #ended=false;
  #problems:string[]=[];
  readonly host:CloseHost;
  constructor(host:CloseHost){this.host=host;}
  register(name:string,owner:CommandCloser):()=>void{
    if(!name.trim()||typeof owner.close!=='function')throw Error('command closer needs a name and close function');
    if(this.#ended)throw Error('INSTRUMENT: command resource acquired after shutdown: '+name);
    const id=++this.#next,row={name,owner,cancelled:false};this.#resources.set(id,row);
    this.#cancel(row);
    return()=>{this.#resources.delete(id);};
  }
  #problem(name:string,error:unknown):void{
    const line=`INSTRUMENT: command cleanup ${name}: ${String(error)}`;
    this.#problems.push(line);this.host.report(line);
  }
  #cancel(row:{name:string;owner:CommandCloser;cancelled:boolean}):void{
    if(this.#reason.kind==='completion'||row.cancelled)return;
    row.cancelled=true;
    try{row.owner.cancel?.(this.#reason);}catch(error){this.#problem(row.name+' cancellation',error);}
  }
  close(code:number,reason:CloseReason={kind:'completion'}):Promise<number>{
    if(this.#ended)return this.#closing!;
    if(this.#reason.kind!=='signal'){
      this.#reason=reason;
      if(reason.kind==='signal')this.#code=signalCode[reason.signal];
      else if(this.#code===0)this.#code=code;
    }
    for(const row of this.#resources.values())this.#cancel(row);
    if(this.#closing)return this.#closing;
    let resolve!:(code:number)=>void;
    this.#closing=new Promise<number>(done=>{resolve=done;});
    const result=()=>this.#code||(this.#problems.length?2:0);
    const cancel=this.host.arm(()=>{
      if(this.#ended)return;
      this.#ended=true;
      this.#problem('wedged drain',`did not finish within ${COMMAND_CLOSE_MS} ms; remaining: ${[...this.#resources.values()].map(row=>row.name).join(', ')||'<none>'}`);
      const code=result();resolve(code);this.host.exit(code);
    },COMMAND_CLOSE_MS);
    const drain=async()=>{
      for(;;){
        const next=[...this.#resources.entries()].at(-1);if(!next)break;
        const [id,row]=next;
        try{await row.owner.close({reason:this.#reason,code:result(),failures:[...this.#problems]});}catch(error){if(!this.#ended)this.#problem(row.name,error);}
        // Read completion after close starts it, including when close throws.
        try{await row.owner.closed?.();}catch(error){if(!this.#ended)this.#problem(row.name+' completion',error);}
        if(this.#ended)return;
        this.#resources.delete(id);
      }
      if(this.#ended)return;
      this.#ended=true;cancel();resolve(result());
    };
    void drain();return this.#closing;
  }
}

type ProcessOwner={lifetime:CommandLifetime;pendingMain:boolean;signal?:CommandSignal;explicitCode?:number;finish:(code:number,reason?:CloseReason)=>Promise<void>};
let owner:ProcessOwner|undefined;
function processOwner():ProcessOwner{
  if(owner)return owner;
  const report=(line:string)=>{try{writeSync(2,line+'\n');}catch{/* a departed output reader cannot prevent cleanup */}};
  const lifetime=new CommandLifetime({report,exit:code=>process.exit(code),arm:(callback,milliseconds)=>{
    const timer=setTimeout(callback,milliseconds);return()=>clearTimeout(timer);
  }});
  const onSignal=(signal:CommandSignal)=>{
    state.signal??=signal;
    void state.finish(signalCode[signal],{kind:'signal',signal}).then(()=>process.exit(signalCode[state.signal!]));
  };
  const signals={SIGINT:()=>onSignal('SIGINT'),SIGTERM:()=>onSignal('SIGTERM'),SIGHUP:()=>onSignal('SIGHUP')};
  const failed=(error:unknown)=>{state.pendingMain=false;console.error(error);void state.finish(Number(process.exitCode)||1,{kind:'failure',error}).then(()=>process.exit(Number(process.exitCode)||1));};
  // An unsettled body can own unref'd resources. Drain those too, but only
  // the actual exit decides its exit13; another beforeExit listener may
  // still settle main, whose eventual nonzero status remains authoritative.
  const beforeExit=()=>{void state.finish(Number(process.exitCode??0));};
  const detach=()=>{
    process.off('beforeExit',beforeExit);process.off('uncaughtException',failed);process.off('unhandledRejection',failed);
    for(const signal of Object.keys(signals) as CommandSignal[])process.off(signal,signals[signal]);
  };
  const state:ProcessOwner={lifetime,pendingMain:false,finish:async(code,reason)=>{
    const drained=await lifetime.close(code,reason);
    process.exitCode=state.signal?signalCode[state.signal]:(state.explicitCode??code)||drained||Number(process.exitCode??0);detach();
  }};
  owner=state;
  process.on('beforeExit',beforeExit);process.on('uncaughtException',failed);process.on('unhandledRejection',failed);
  for(const signal of Object.keys(signals) as CommandSignal[])process.on(signal,signals[signal]);
  return state;
}

/** Resource acquisition lends its cleanup to the process's one command owner.
 * An eval parent and a standalone entry use the same beforeExit boundary. */
export function registerCommandCloser(name:string,closer:CommandCloser):()=>void{return processOwner().lifetime.register(name,closer);}

/** execve resets caught signal dispositions, unlike ignored dispositions. */
export function prepareCommandExec():void{
  processOwner();
  for(const signal of ['SIGPIPE','SIGXFSZ'] as const)process.on(signal,()=>{});
}

/** A terminal verdict drains resources before flushing both output streams.
 * Flush callbacks cannot end a process while a sampler still owns its log. */
export function exitAfterOutput(code:number):void{
  process.exitCode=code;
  const state=processOwner();
  state.pendingMain=false;state.explicitCode??=code;
  void state.finish(code).then(()=>{
    let open=2;
    const flushed=()=>{if(--open===0)process.exit(Number(process.exitCode??code));};
    process.stdout.write('',flushed);process.stderr.write('',flushed);
  });
}
/** Importing the module never starts its command or makes its graph async.
 * Commands keep their own handled diagnostics and statuses. Unhandled errors
 * share one stderr/exit policy; a void result preserves a status set by main.
 * An unsettled command fails at exit after loop drain, as top-level await did.
 * realpath retains the entry semantics of commands accepting symlink aliases. */
export function runAsCommand(url:string,main:Command,{realpath=false}:{realpath?:boolean}={}):void{
  const entry=process.argv[1];
  if(!entry||pathToFileURL(realpath?realpathSync(entry):resolve(entry)).href!==url)return;
  const state=processOwner();state.pendingMain=true;
  const unsettled=()=>{
    if(!state.pendingMain||state.signal)return;
    writeSync(2,`INSTRUMENT: command entry ${url}: main did not settle before the event loop drained\n`);
    process.exitCode=13;
  };
  const arm=()=>process.once('exit',unsettled);
  const finished=()=>{process.removeListener('beforeExit',arm);process.removeListener('exit',unsettled);};
  const complete=(code:number|void)=>{
    finished();state.pendingMain=false;
    return state.finish(code??Number(process.exitCode??0));
  };
  const failed=(error:unknown)=>{
    finished();state.pendingMain=false;
    console.error(error);return state.finish(1,{kind:'failure',error});
  };
  process.once('beforeExit',arm);
  try{void Promise.resolve(main()).then(complete,failed);}
  catch(error){void failed(error);}
}
