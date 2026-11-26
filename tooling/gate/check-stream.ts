// One run owns publication; compiler processes own only their Unix connection.
import {createServer,type Server,type Socket} from 'node:net';
import {chmodSync,mkdirSync,rmSync,openSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {durableRecordStream} from './durable-record.ts';

export const CHECK_CHANNEL='NTS_GATE_CHECK_CHANNEL';
export const CHECK_CAPABILITY='NTS_GATE_CHECK_CAPABILITY';
export const MAX_CHECK_ROW_BYTES=1024*1024;
const MAX_PENDING_BYTES=8*1024*1024;
type Step={capability:string;members:()=>readonly number[]};
type Peer={socket:Socket;step?:string;pid?:number;producer?:number;pending:string;ended:boolean;sessions:Set<number>;totals:Set<number>};
// Two check turns include a poll turn even when reap itself ran in IO. This
// drains kernel EOF notifications after the step's last descriptor closed;
// it is an event-loop yield, not a wall-time grace period or drain deadline.
const pollTurn=()=>new Promise<void>(resolve=>setImmediate(()=>setImmediate(resolve)));

export class CheckStream {
  readonly path:string;
  #directory:number;
  #socketPath:string;
  readonly errors:string[]=[];
  #server:Server;
  #steps=new Map<string,Step>();
  #peers=new Set<Peer>();
  #identities=new Map<string,Peer>();
  #producer=0;
  #pendingBytes=0;
  #append!:(chunk:string|Uint8Array)=>Promise<void>;
  #writes:Promise<void>=Promise.resolve();
  #finish!:()=>void;
  #publication:Promise<void>;
  #failed=false;
  #closing=false;
  #closed:Promise<void>|undefined;
  readonly ready:Promise<void>;
  constructor(costs:string,temporary:string,publish:typeof durableRecordStream=durableRecordStream){
    mkdirSync(costs,{recursive:true});mkdirSync(temporary,{recursive:true});
    this.#socketPath=join(temporary,'checks.sock');
    // sockaddr_un is short even when the run path is long. A retained directory
    // descriptor resolves to this run's actual tmp; it is closed at run end.
    this.#directory=openSync(temporary,'r');
    this.path=`/proc/${process.pid}/fd/${this.#directory}/checks.sock`;
    // Acquire the close handoff before invoking a fallible publication owner.
    // Failure before its producer runs must still release this directory FD.
    const ending=new Promise<void>(resolve=>{this.#finish=resolve;});
    let started!:()=>void,failed!:(error:unknown)=>void;
    const writing=new Promise<void>((resolve,reject)=>{started=resolve;failed=reject;});
    this.#publication=Promise.resolve().then(()=>publish(join(costs,'check-worker-0.jsonl.gz'),async append=>{
      this.#append=append;started();await ending;await this.#writes;
    },{gzip:true}));
    void this.#publication.catch(error=>{this.#failed=true;this.#error(`publication failed: ${String(error)}`);failed(error);});
    this.#server=createServer({allowHalfOpen:true},socket=>this.#accept(socket));
    const listening=new Promise<void>((resolve,reject)=>{
      this.#server.on('error',error=>{this.#error(`listener failed: ${String(error)}`);reject(error);});
      this.#server.listen(this.path,()=>{
        this.#server.unref();
        try{chmodSync(this.#socketPath,0o600);resolve();}
        catch(error){this.#error(`listener preparation failed: ${String(error)}`);reject(error);}
      });
    });
    // Dispatch cannot start a compiler until both transport and sink exist.
    this.ready=Promise.all([listening,writing]).then(()=>{});
  }
  #error(message:string){this.errors.push(`check telemetry: ${message}`);}
  environment(step:string,members:()=>readonly number[]):Record<string,string>{
    if(this.#closing||this.#steps.has(step))throw Error('check telemetry: duplicate or closed step '+step);
    const capability=randomBytes(32).toString('hex');this.#steps.set(step,{capability,members});
    return {[CHECK_CHANNEL]:this.path,[CHECK_CAPABILITY]:capability};
  }
  #publish(line:string):void{
    if(this.#failed)return;
    const bytes=Buffer.byteLength(line);
    if(this.#pendingBytes+bytes>MAX_PENDING_BYTES){this.#failed=true;this.#error('bounded publication queue exhausted');return;}
    this.#pendingBytes+=bytes;
    this.#writes=this.#writes.then(async()=>{
      if(!this.#failed)await this.#append(line);
    }).catch(error=>{this.#failed=true;this.#error(`write failed: ${String(error)}`);}).finally(()=>{this.#pendingBytes-=bytes;});
  }
  #accept(socket:Socket):void{
    const peer:Peer={socket,pending:'',ended:false,sessions:new Set(),totals:new Set()};this.#peers.add(peer);
    const refuse=(message:string)=>{this.#error(message);socket.destroy();};
    socket.setEncoding('utf8');
    socket.on('data',(part:string)=>{
      peer.pending+=part;
      try{
        let nl:number;
        while((nl=peer.pending.indexOf('\n'))>=0){
          const text=peer.pending.slice(0,nl);peer.pending=peer.pending.slice(nl+1);
          if(Buffer.byteLength(text)>MAX_CHECK_ROW_BYTES)throw Error('oversized record');
          const row=JSON.parse(text) as Record<string,unknown>;
          if(!row||typeof row!=='object'||Array.isArray(row))throw Error('invalid record');
          if(peer.producer===undefined){
            const step=typeof row.step==='string'?this.#steps.get(row.step):undefined;
            if(row.kind!=='check.producer'||!step||row.capability!==step.capability)throw Error('unknown, crossed or reaped step capability');
            if(!Number.isSafeInteger(row.pid)||(row.pid as number)<=0)throw Error('invalid producer PID');
            // The capability is the authority. PID is self-reported and checked
            // only for consistency with the dispatched step, not authenticated.
            if(!step.members().includes(row.pid as number))throw Error('producer PID is outside its dispatched step');
            const identity=`${row.step}:${row.pid}`;
            if(this.#identities.has(identity))throw Error('duplicate live producer '+identity);
            peer.step=row.step as string;peer.pid=row.pid as number;peer.producer=++this.#producer;
            this.#identities.set(identity,peer);
            // The compiler waits for registration before starting any timer,
            // keeping its short-lived PID present during the consistency check.
            socket.write('ready\n');
          }else{
            if(!Number.isSafeInteger(row.session)||(row.session as number)<0)throw Error('invalid session identity');
            if(row.event==='case'){
              if(row.pid!==peer.pid||row.step!==peer.step||peer.sessions.has(row.session as number))throw Error('duplicate or mismatched case identity');
              peer.sessions.add(row.session as number);
            }else if(!peer.sessions.has(row.session as number))throw Error('record without its session header');
            if(row.event==='end'&&row.phase==='check.total')peer.totals.add(row.session as number);
            // Preserve the original JSON spelling as well as every double
            // bit (in particular -0); validation must not reserialize it.
            this.#publish(`{"producer":${peer.producer},"pid":${peer.pid},"record":${text}}\n`);
          }
        }
        if(Buffer.byteLength(peer.pending)>MAX_CHECK_ROW_BYTES)throw Error('oversized unfinished record');
      }catch(error){refuse(String(error));}
    });
    socket.on('end',()=>{peer.ended=true;if(peer.pending)this.#error('incomplete final record from '+peer.pid);socket.end();});
    socket.on('error',error=>this.#error(`producer ${peer.pid??'unknown'}: ${error.message}`));
    socket.on('close',()=>{
      if(peer.step)this.#identities.delete(`${peer.step}:${peer.pid}`);
      for(const id of peer.sessions)if(!peer.totals.has(id))this.#error(`producer ${peer.pid} session ${id} has no completed check.total`);
      this.#peers.delete(peer);
    });
  }
  /** Called after scope drain/reap, before dropping the dispatched scope. */
  async reaped(step:string):Promise<void>{
    this.#steps.delete(step);
    for(;;){
      const remaining=[...this.#peers].filter(peer=>peer.step===step&&!peer.ended&&!peer.socket.destroyed);
      if(!remaining.length)break;
      const before=new Map(remaining.map(peer=>[peer,peer.socket.bytesRead]));
      await pollTurn();await this.#writes;
      for(const peer of remaining)if(!peer.ended&&!peer.socket.destroyed&&peer.socket.bytesRead===before.get(peer)){
        // A departed local writer can leave several socket buffers behind.
        // Keep consuming while bytes advance, through EOF. After a full poll
        // with no bytes, an open descriptor cannot be a departed producer's
        // buffered tail. Refuse it without spending a wall-time deadline.
        this.#error(`producer ${peer.pid} connection still open after ${step} was reaped`);peer.socket.destroy();
      }
    }
    await pollTurn();await this.#writes;
  }
  close():Promise<void>{return this.#closed??=this.#close();}
  async #close():Promise<void>{
    this.#closing=true;
    try{for(const step of [...this.#steps.keys()])await this.reaped(step);}
    finally{
      for(const peer of this.#peers){this.#error('unidentified producer still open at run end');peer.socket.destroy();}
      try{await new Promise<void>(resolve=>this.#server.close(()=>resolve()));}
      finally{
        this.#finish();
        try{await this.#publication.catch(()=>{});}
        finally{try{rmSync(this.#socketPath,{force:true});}finally{closeSync(this.#directory);}}
      }
    }
  }
}
