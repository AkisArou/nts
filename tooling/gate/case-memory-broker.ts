// One runner-side owner of case identity, observations and cap registration.
// The token pool transports leases; pooled readers do not size themselves.
import {spawn} from 'node:child_process';
import {basename} from 'node:path';
import {readFileSync} from 'node:fs';
import {CaseMemoryLease,caseIdentity} from './case-memory.ts';
import {caseHistoryFile,readCaseHistory,writeCaseHistory,KEPT_PEAKS,type CaseHistory,type CaseObservation} from './step-scheduling.ts';
import type {HostObservations} from './host-observations.ts';

export type CaseTokenRequest={step:string;lease?:string;context:string|null;answered?:boolean;memory?:CaseMemoryLease};
type WorkerBoundary={group:string;raise(bytes:number):Promise<void>};
type BrokerOptions={root:string;env:NodeJS.ProcessEnv;host:HostObservations;boundary(step:string):WorkerBoundary;report(message:string):void};
function decoded(text:string|null):Record<string,unknown>{
  if(text?.startsWith('json64:'))return JSON.parse(Buffer.from(text.slice(7),'base64url').toString('utf8')) as Record<string,unknown>;
  if(text?.startsWith('path:'))return {project:decodeURIComponent(text.slice(5))};
  throw Error('case memory: a leased token has no declared case identity');
}
function property(unit:string,bytes:number):Promise<void>{
  return new Promise((resolve,reject)=>{
    const child=spawn('systemctl',['--user','set-property','--runtime',unit,`MemoryMax=${bytes}`],{stdio:['ignore','ignore','pipe']});
    let error='';child.stderr.setEncoding('utf8').on('data',(part:string)=>{error+=part;});
    child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(`case memory: cannot set ${unit} cap: ${error||code}`)));
  });
}
async function stopWorker(unit:string):Promise<void>{
  await new Promise<void>((resolve,reject)=>{
    const child=spawn('systemctl',['--user','stop',unit],{stdio:['ignore','ignore','pipe']});let error='';
    child.stderr.setEncoding('utf8').on('data',(part:string)=>{error+=part;});
    child.on('error',reject);child.on('close',code=>code===0||error.includes('not loaded')?resolve():reject(Error(`case memory: cannot drain ${unit}: ${error||code}`)));
  });
}
const under=(parent:string,child:string)=>child.startsWith(parent+'/')&&!child.split('/').includes('..');

export class CaseMemoryBroker {
  #histories=new Map<string,CaseHistory>();
  #completed=new Map<string,CaseObservation[]>();
  #active=new Map<string,Set<CaseMemoryLease>>();
  #options:BrokerOptions;
  constructor(options:BrokerOptions){this.#options=options;}
  prepare(request:CaseTokenRequest):void{
    if(!request.lease)return; // Historical unsized clients keep their protocol.
    const {root,env,host}=this.#options;
    const identity=caseIdentity(request.step,decoded(request.context),root);
    request.memory=new CaseMemoryLease(identity,{
      history:step=>{let history=this.#histories.get(step);if(!history){history=readCaseHistory(caseHistoryFile(step,env,root));this.#histories.set(step,history);}return history;},
      completed:(step,row)=>{
        const rows=this.#completed.get(step)??[];rows.push(row);this.#completed.set(step,rows);
        const history=new Map(this.#histories.get(step));history.set(row.key,[...history.get(row.key)??[],row.peak].slice(-KEPT_PEAKS));this.#histories.set(step,history);
      },
      open:group=>{
        const meter=host.scopeMemoryPeak(group);
        if(!meter.resettable){meter.close();throw Error('case memory: per-case worker peak meter cannot reset');}
        meter.reset();
        return {charge:()=>host.cgroupCharge(group),peak:()=>meter.read(),close:()=>meter.close()};
      },
    });
  }
  caps(step:string):number{return [...this.#active.get(step)??[]].reduce((sum,lease)=>sum+lease.capBytes,0);}
  async attach(request:CaseTokenRequest,{group,cap,scope}:{group:string;cap:number;scope:string}):Promise<void>{
    const lease=request.memory;if(!lease||lease.closed)throw Error('case memory: registration has no live lease');
    const boundary=this.#options.boundary(request.step);
    if(!group||!scope||!under(boundary.group,group)||!under(group,scope)||!Number.isSafeInteger(cap)||cap<1)throw Error('case memory: worker registration escapes its step');
    // Only the worker slice and its exact scope may change. Every intervening
    // real case keeps its bound; no nested child can enlarge its parent.
    for(let at=group.slice(0,group.lastIndexOf('/'));at!==boundary.group;at=at.slice(0,at.lastIndexOf('/'))){
      if(!under(boundary.group,at))throw Error('case memory: invalid worker ancestry');
      const text=readFileSync('/sys/fs/cgroup'+at+'/memory.max','utf8').trim();
      if(text!=='max'&&Number(text)<cap)throw Error(`case memory: case cap ${cap} exceeds enclosing ${at} cap ${text}`);
    }
    lease.attach(group,cap);
    const active=this.#active.get(request.step)??new Set<CaseMemoryLease>();active.add(lease);this.#active.set(request.step,active);
    await boundary.raise(this.caps(request.step));
    await property(basename(group),cap);
    await property(basename(scope),cap);
    for(const at of [group,scope]){
      const actual=Number(readFileSync('/sys/fs/cgroup'+at+'/memory.max','utf8'));
      if(actual>cap||actual<cap-4096)throw Error('case memory: kernel did not enforce registered case cap');
    }
  }
  retire(request:CaseTokenRequest,group:string):void{request.memory?.retire(group);}
  async completed(request:CaseTokenRequest):Promise<void>{
    const lease=request.memory;if(!lease)return;
    const groups=lease.groups;
    try{
      lease.close(Boolean(request.answered));
      // A lost controller cannot return its CPU token while its workers
      // still run. The broker owns these exact authenticated slice names.
      if(!request.answered)for(const group of groups)await stopWorker(basename(group));
    }finally{this.#active.get(request.step)?.delete(lease);}
  }
  flush(step:string):void{
    const rows=this.#completed.get(step);if(!rows?.length)return;
    const warning=writeCaseHistory(caseHistoryFile(step,this.#options.env,this.#options.root),rows);
    if(warning)this.#options.report('case memory history: '+warning);
    this.#completed.delete(step);
  }
}
