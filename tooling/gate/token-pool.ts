// One token is one connection, retained until its case and descendants end.
// Sized tokens account for their case; old unsized clients retain the protocol.
import {createServer,type Server,type Socket} from 'node:net';
import type {CaseMemoryLease} from './case-memory.ts';

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
};
export type TokenPool={
  addr:string|null;server:Server|null;held:Map<string,number>;sized:Map<string,{count:number;bytes:number}>;
  peak:Map<string,number>;used:Map<string,number>;total:number;waiting:TokenRequest[];active:Set<TokenRequest>;last:number;
  account():void;grant():void;start():Promise<string|null>;close():void;
};

export function createTokenPool({free,claim,eligible=()=>true,answering=()=>null,known=()=>true,released=()=>{},observe=()=>{},prepare=()=>{},attach=async()=>{},completed=()=>{},retire=()=>{},failed=error=>{throw error;}}:TokenOptions):TokenPool{
  const pool:TokenPool={addr:null,server:null,held:new Map(),sized:new Map(),peak:new Map(),used:new Map(),total:0,waiting:[],active:new Set(),last:Date.now(),
    account:()=>{},grant:()=>{},start:async()=>null,close:()=>{pool.server?.close();}};
  let requests=0;
  const trace=(event:string,w?:TokenRequest)=>{
    try{observe({event,request:w?.id,step:w?.step,pid:w?.pid,context:w?.context,bytes:w?.bytes});}catch{/* Telemetry cannot grant work or change its status. */}
  };
  pool.account=()=>{
    for(const w of [...pool.waiting,...pool.active])if(w.memory){w.memory.sample();w.bytes=w.memory.bytes;}
    for(const step of pool.sized.keys())pool.sized.set(step,{count:0,bytes:0});
    for(const w of pool.active)if(w.bytes!==undefined){const row=pool.sized.get(w.step)??{count:0,bytes:0};pool.sized.set(w.step,{count:row.count+1,bytes:row.bytes+w.bytes});}
    const now=Date.now(),dt=(now-pool.last)/1000;pool.last=now;
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
    pool.account();const now=Date.now();
    while(pool.waiting.length&&free()>0){
      const {oldest,chosen}=candidates();let best:{w:TokenRequest;c:number}|null=null;
      for(const [step,w] of chosen){const c=claim(step,{held:pool.held.get(step)??0,used:pool.used.get(step)??0,waitedS:(now-oldest.get(step)!)/1000});if(!best||c>best.c)best={w,c};}
      if(!best)break;
      const w=best.w;pool.waiting.splice(pool.waiting.indexOf(w),1);trace('token.grant',w);
      w.granted=true;pool.active.add(w);
      const n=(pool.held.get(w.step)??0)+1;pool.held.set(w.step,n);
      if(w.bytes!==undefined){const s=pool.sized.get(w.step)??{count:0,bytes:0};pool.sized.set(w.step,{count:s.count+1,bytes:s.bytes+w.bytes});}
      pool.total++;if(n>(pool.peak.get(w.step)??0))pool.peak.set(w.step,n);
      const ready=w.bytes===undefined?null:answering(w.step,w);
      const go=()=>{if(!w.gone)w.sock.write('go\n');};
      if(ready)void ready.then(go,error=>w.sock.end(`error: ${String(error)}\n`));else go();
      trace('pool.change');
    }
  };
  pool.start=()=>new Promise(resolve=>{
    const server=createServer({allowHalfOpen:true},sock=>{
      const w:TokenRequest={sock,id:++requests,step:'',pid:0,context:'',since:Date.now(),granted:false,gone:false};
      let buf='';sock.setEncoding('utf8');
      sock.on('data',(data:string)=>{
        if(w.step!==''){if(data.includes('done\n'))w.answered=true;return;}
        buf+=data;const nl=buf.indexOf('\n');if(nl<0)return;
        const words=buf.slice(0,nl).split(' ');
        if(words[0]==='retire'){
          w.step='registration';const [,id,group]=words;
          const owner=[...pool.active].find(entry=>entry.lease===id);
          try{if(owner&&group)retire(owner,group);sock.end('ready\n');}catch(error){sock.end(`error: ${String(error)}\n`);}return;
        }
        if(words[0]==='attach'){
          w.step='registration';const [,id,group,cap,scope]=words;
          const owner=[...pool.active].find(entry=>entry.lease===id);
          if(!owner||!group||!scope){sock.end('error: case lease has ended or registration is incomplete\n');return;}
          void Promise.resolve().then(()=>attach(owner,{group,cap:Number(cap),scope})).then(()=>sock.end('ready\n'),error=>sock.end(`error: ${String(error)}\n`));return;
        }
        if(words[0]!=='want'){sock.destroy();return;}
        const step=words[1]??'?';w.pid=Number(words[2]);let rest=words.slice(3);
        if(rest[0]?.startsWith('bytes:')){
          const bytes=Number(rest[0].slice(6));if(!/^bytes:[1-9][0-9]*$/.test(rest[0])||!Number.isSafeInteger(bytes)){sock.destroy();return;}
          w.bytes=bytes;rest=rest.slice(1);
        }
        if(rest[0]?.startsWith('lease:')){w.lease=rest[0].slice(6);if(!/^[-a-zA-Z0-9]{1,64}$/.test(w.lease)){sock.destroy();return;}rest=rest.slice(1);}
        w.context=rest.join(' ');w.step=known(step)?step:'?';w.since=Date.now();
        try{prepare(w);if(w.memory)w.bytes=w.memory.bytes;}catch(error){sock.end(`error: ${String(error)}\n`);return;}
        pool.waiting.push(w);trace('token.request',w);pool.grant();trace('pool.change');
      });
      const gone=async()=>{
        if(w.gone)return;w.gone=true;
        if(w.granted){
          pool.account();await completed(w);trace('token.release',w);pool.active.delete(w);pool.held.set(w.step,(pool.held.get(w.step)??0)-1);
          if(w.bytes!==undefined){const s=pool.sized.get(w.step)!;pool.sized.set(w.step,{count:s.count-1,bytes:s.bytes-w.bytes});}
          pool.total--;released();pool.grant();trace('pool.change');
        }else {trace('token.cancel',w);if(w.step!=='')pool.waiting=pool.waiting.filter(x=>x!==w);}
      };
      // FIN is the completion acknowledgement. A normal client retains its
      // readable socket until the final meter and worker drain have finished.
      sock.on('end',()=>{void gone().then(()=>sock.end(),failed);});
      sock.on('close',()=>{void gone().catch(failed);});sock.on('error',()=>{void gone().catch(failed);});
    });
    server.on('error',()=>resolve(null));server.listen(0,'127.0.0.1',()=>{
      server.unref();pool.server=server;const address=server.address();
      if(!address||typeof address==='string'){resolve(null);return;}
      pool.addr=`127.0.0.1:${address.port}`;resolve(pool.addr);
    });
  });
  return pool;
}
