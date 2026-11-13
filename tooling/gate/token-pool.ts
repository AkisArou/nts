// One token is one connection, retained until its case and descendants end.
// Every request names an explicit case or step lease. The broker sizes it.
import {createServer,type Server,type Socket} from 'node:net';
import type {CaseMemoryLease} from './case-memory.ts';
import {hostObservations} from './host-observations.ts';

export type TokenRequest={sock:Socket;id:number;step:string;pid:number;context:string;since:number;granted:boolean;gone:boolean;answered?:boolean;bytes?:number;lease?:string;memory?:CaseMemoryLease};
type TokenEvent={event:string;request?:number;step?:string;pid?:number;context?:string;bytes?:number};
type TokenOptions={
  free():number;
  claim(step:string,claim:{held:number;used:number;waitedS:number}):number;
  eligible?(step:string,bytes:number|undefined,request:TokenRequest):boolean;
  answering?(step:string,request:TokenRequest):Promise<unknown>|null|void;
  known?(step:string):boolean;released?():void;observe?(event:TokenEvent):void;
  prepare?(request:TokenRequest):void;
  attach?(request:TokenRequest,scope:{group:string;cap:number;scope:string}):Promise<void>;
  completed?(request:TokenRequest):void|Promise<void>;
  retire?(request:TokenRequest,group:string):void;
  failed?(error:unknown):void;
  now?():number;
};
export type TokenPool={
  addr:string|null;server:Server|null;held:Map<string,number>;sized:Map<string,{count:number;bytes:number}>;
  peak:Map<string,number>;used:Map<string,number>;total:number;waiting:TokenRequest[];active:Set<TokenRequest>;last:number;
  account():void;grant():void;start():Promise<string|null>;cancel():void;close():void;closed:Promise<void>;
};

export function createTokenPool({free,claim,eligible=()=>true,answering=()=>null,known=()=>true,released=()=>{},observe=()=>{},prepare=()=>{},attach=async()=>{},completed=()=>{},retire=()=>{},failed=error=>{throw error;},now=hostObservations().now}:TokenOptions):TokenPool{
  let cancelled=false,closing=false,finishClose!:()=>void,rejectClose!:(error:unknown)=>void;
  const closed=new Promise<void>((resolve,reject)=>{finishClose=resolve;rejectClose=reject;});
  void closed.catch(()=>{});
  const finalizing=new Set<Promise<void>>(),failures:unknown[]=[];
  const pool:TokenPool={addr:null,server:null,held:new Map(),sized:new Map(),peak:new Map(),used:new Map(),total:0,waiting:[],active:new Set(),last:now(),
    account:()=>{},grant:()=>{},start:async()=>null,closed,
    cancel:()=>{cancelled=true;for(const request of pool.waiting)request.sock.end('error: token pool is shutting down\n');},
    close:()=>{
      if(closing)return;closing=true;pool.cancel();
      const finish=async()=>{
        await Promise.allSettled([...finalizing]);
        if(failures.length===1)rejectClose(failures[0]);
        else if(failures.length)rejectClose(new AggregateError(failures,'token pool final retirement failed'));
        else finishClose();
      };
      if(pool.server)pool.server.close(error=>{if(error)failures.push(error);void finish();});else void finish();
    }};
  let requests=0;
  const trace=(event:string,w?:TokenRequest)=>{
    try{observe({event,request:w?.id,step:w?.step,pid:w?.pid,context:w?.context,bytes:w?.bytes});}catch{/* Telemetry cannot grant work or change its status. */}
  };
  pool.account=()=>{
    for(const w of [...pool.waiting,...pool.active])if(w.memory){w.memory.sample();w.bytes=w.memory.bytes;}
    for(const step of pool.sized.keys())pool.sized.set(step,{count:0,bytes:0});
    for(const w of pool.active)if(w.bytes!==undefined){const row=pool.sized.get(w.step)??{count:0,bytes:0};pool.sized.set(w.step,{count:row.count+1,bytes:row.bytes+w.bytes});}
    const at=now(),dt=(at-pool.last)/1000;pool.last=at;
    for(const [step,n] of pool.held)pool.used.set(step,(pool.used.get(step)??0)+n*dt);
  };
  const candidates=()=>{
    const oldest=new Map<string,number>(),chosen=new Map<string,TokenRequest>(),asked=new Map<string,boolean>();
    for(const w of pool.waiting){
      if(!oldest.has(w.step))oldest.set(w.step,w.since);
      if(chosen.has(w.step))continue;
      const key=`${w.step}\0${w.bytes??''}`;
      if(!asked.has(key))asked.set(key,eligible(w.step,w.bytes,w));
      if(asked.get(key))chosen.set(w.step,w);
    }
    return {oldest,chosen};
  };
  pool.grant=()=>{
    if(cancelled)return;
    pool.account();const at=now();
    while(pool.waiting.length&&free()>0){
      const {oldest,chosen}=candidates();let best:{w:TokenRequest;c:number}|null=null;
      for(const [step,w] of chosen){const c=claim(step,{held:pool.held.get(step)??0,used:pool.used.get(step)??0,waitedS:(at-oldest.get(step)!)/1000});if(!best||c>best.c)best={w,c};}
      if(!best)break;
      const w=best.w;pool.waiting.splice(pool.waiting.indexOf(w),1);trace('token.grant',w);
      w.granted=true;pool.active.add(w);
      const n=(pool.held.get(w.step)??0)+1;pool.held.set(w.step,n);
      if(w.bytes!==undefined){const s=pool.sized.get(w.step)??{count:0,bytes:0};pool.sized.set(w.step,{count:s.count+1,bytes:s.bytes+w.bytes});}
      pool.total++;if(n>(pool.peak.get(w.step)??0))pool.peak.set(w.step,n);
      const ready=w.bytes===undefined?null:answering(w.step,w);
      const go=()=>{if(!w.gone){if(cancelled)w.sock.end('error: token pool is shutting down\n');else w.sock.write('go\n');}};
      if(ready)void ready.then(go,error=>w.sock.end(`error: ${String(error)}\n`));else go();
      trace('pool.change');
    }
  };
  pool.start=()=>new Promise(resolve=>{
    if(cancelled)throw Error('token pool cannot start after cancellation');
    const server=createServer({allowHalfOpen:true},sock=>{
      const w:TokenRequest={sock,id:++requests,step:'',pid:0,context:'',since:now(),granted:false,gone:false};
      let buf='';sock.setEncoding('utf8');
      sock.on('data',(data:string)=>{
        if(w.step!==''){
          buf+=data;
          const lines=buf.split('\n');buf=lines.pop()??'';
          if(lines.includes('done'))w.answered=true;
          return;
        }
        buf+=data;const nl=buf.indexOf('\n');if(nl<0)return;
        const words=buf.slice(0,nl).split(' ');buf=buf.slice(nl+1);
        if(words[0]==='retire'){
          w.step='registration';const [,id,group]=words;
          if(!id||!group){sock.end('error: incomplete case scope retirement\n');return;}
          const owner=[...pool.active].find(entry=>entry.lease===id);
          if(!owner){sock.end(`error: case lease has ended (no live owner): ${id}\n`);return;}
          try{retire(owner,group);sock.end('ready\n');}catch(error){sock.end(`error: ${String(error)}\n`);}return;
        }
        if(words[0]==='attach'){
          w.step='registration';const [,id,group,cap,scope]=words;
          if(!id||!group||!cap||!scope){sock.end('error: incomplete case scope registration\n');return;}
          const owner=[...pool.active].find(entry=>entry.lease===id);
          if(!owner){sock.end(`error: case lease has ended (no live owner): ${id}\n`);return;}
          void Promise.resolve().then(()=>attach(owner,{group,cap:Number(cap),scope})).then(()=>sock.end('ready\n'),error=>sock.end(`error: ${String(error)}\n`));return;
        }
        if(words[0]!=='want'){sock.destroy();return;}
        if(cancelled){sock.end('error: token pool is shutting down\n');return;}
        const step=words[1]??'?';w.pid=Number(words[2]);let rest=words.slice(3);
        if(rest[0]?.startsWith('bytes:')){
          const bytes=Number(rest[0].slice(6));if(!/^bytes:[1-9][0-9]*$/.test(rest[0])||!Number.isSafeInteger(bytes)){sock.destroy();return;}
          w.bytes=bytes;rest=rest.slice(1);
        }
        if(rest[0]?.startsWith('lease:')){w.lease=rest[0].slice(6);if(!/^[-a-zA-Z0-9]{1,64}$/.test(w.lease)){sock.destroy();return;}rest=rest.slice(1);}
        if(!w.lease){sock.end('error: token request requires an explicit case or step lease\n');return;}
        w.context=rest.join(' ');w.step=known(step)?step:'?';w.since=now();
        try{prepare(w);if(w.memory)w.bytes=w.memory.bytes;}catch(error){sock.end(`error: ${String(error)}\n`);return;}
        pool.waiting.push(w);trace('token.request',w);pool.grant();trace('pool.change');
      });
      const gone=async()=>{
        if(w.gone)return;w.gone=true;
        if(w.granted){
          pool.account();await completed(w);trace('token.release',w);pool.active.delete(w);pool.held.set(w.step,(pool.held.get(w.step)??0)-1);
          if(w.bytes!==undefined){const s=pool.sized.get(w.step)!;pool.sized.set(w.step,{count:s.count-1,bytes:s.bytes-w.bytes});}
          pool.total--;released();pool.grant();trace('pool.change');
        }else if(w.step!=='registration'){trace('token.cancel',w);if(w.step!=='')pool.waiting=pool.waiting.filter(x=>x!==w);}
      };
      // FIN is the completion acknowledgement. A normal client retains its
      // readable socket until the final meter and worker drain have finished.
      const finish=()=>{
        const work=gone();finalizing.add(work);
        void work.then(()=>{finalizing.delete(work);if(!sock.destroyed&&!sock.writableEnded)sock.end();},error=>{finalizing.delete(work);failures.push(error);failed(error);});
      };
      sock.on('end',finish);sock.on('close',finish);sock.on('error',finish);
    });
    server.on('error',()=>resolve(null));server.listen(0,'127.0.0.1',()=>{
      server.unref();pool.server=server;const address=server.address();
      if(!address||typeof address==='string'){resolve(null);return;}
      pool.addr=`127.0.0.1:${address.port}`;resolve(pool.addr);
    });
  });
  return pool;
}
