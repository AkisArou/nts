// A case's lease follows its asynchronous work, not the controller process:
// one controller may have many independent cases active at the same time.
import {AsyncLocalStorage} from 'node:async_hooks';
import {connect} from 'node:net';
import {ToolingInstrumentError} from './step-result.ts';

export const CASE_LEASE_ADDRESS='NTS_GATE_CASE_LEASE_ADDRESS';
export const CASE_LEASE_ID='NTS_GATE_CASE_LEASE_ID';
export type CaseReceipt={address:string;id:string};
export type TokenRelease=(()=>void)&{case?:CaseReceipt;closed?:Promise<void>};
const current=new AsyncLocalStorage<CaseReceipt>();
const cleanups=new Map<string,Set<()=>void|Promise<void>>>();

export function ownCaseWorker(receipt:CaseReceipt|undefined,close:()=>void|Promise<void>):void{
  if(!receipt)return;
  const owned=cleanups.get(receipt.id)??new Set<()=>void>();owned.add(close);cleanups.set(receipt.id,owned);
}
export async function closeCaseWorkers(receipt:CaseReceipt):Promise<void>{
  const owned=cleanups.get(receipt.id);cleanups.delete(receipt.id);
  const results=await Promise.allSettled([...owned??[]].map(async close=>close()));
  const failure=results.find(result=>result.status==='rejected');
  if(failure?.status==='rejected')throw failure.reason;
}
// A slow broker is not a case outcome. Five minutes detects a wedged peer,
// well beyond loaded manager/ledger startup, and names the cleanup instrument.
export const CASE_RETIRE_HANG_MS=5*60_000;
/** Capture the last peak before the owner removes a worker cgroup. */
export function retireCaseScope(receipt:CaseReceipt|undefined,group:string):Promise<void>{
  if(!receipt)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const label=`case memory: cannot retire lease ${receipt.id} group ${group} through broker ${receipt.address}`;
    const socket=connect({host:'127.0.0.1',port:Number(receipt.address.split(':')[1])});
    let text='',answered=false;
    const timer=setTimeout(()=>fail('wedged broker did not answer within the five-minute cleanup backstop'),CASE_RETIRE_HANG_MS);
    const fail=(reason:string)=>{
      if(answered)return;answered=true;clearTimeout(timer);socket.destroy();
      reject(new ToolingInstrumentError('tooling-cleanup',label+': '+reason));
    };
    socket.setEncoding('utf8');
    socket.once('connect',()=>socket.write(`retire ${receipt.id} ${group}\n`));
    socket.on('data',(part:string)=>{
      text+=part;if(!text.includes('\n'))return;
      if(text.split('\n')[0]!=='ready'){fail(text.trim());return;}
      answered=true;clearTimeout(timer);socket.end();resolve();
    });
    socket.once('error',error=>fail(error.message));
    socket.once('close',()=>fail('broker departed before acknowledging the final sample'));
  });
}

export function caseReceipt(env:NodeJS.ProcessEnv=process.env):CaseReceipt|undefined{
  const local=current.getStore();if(local)return local;
  const address=env[CASE_LEASE_ADDRESS],id=env[CASE_LEASE_ID];
  if(address===undefined&&id===undefined)return;
  if(!address||!/^127\.0\.0\.1:[1-9][0-9]*$/.test(address)||!id||!/^[-a-zA-Z0-9]{1,64}$/.test(id))throw Error('case memory: invalid lease handoff');
  return {address,id};
}
export function caseEnvironment(env:NodeJS.ProcessEnv):NodeJS.ProcessEnv{
  const receipt=caseReceipt(env);
  return receipt?{...env,[CASE_LEASE_ADDRESS]:receipt.address,[CASE_LEASE_ID]:receipt.id}:env;
}
export function runWithToken<T>(release:TokenRelease,run:()=>T):T{
  return release.case?current.run(release.case,run):run();
}
export async function releaseToken(release:TokenRelease):Promise<void>{release();await release.closed;}
export function registerCaseScope(receipt:CaseReceipt|undefined,group:string,cap:number,scope:string):Promise<void>{
  if(!receipt)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const socket=connect({host:'127.0.0.1',port:Number(receipt.address.split(':')[1])});
    let text='',answered=false;
    const fail=(error:Error)=>{if(answered)return;answered=true;socket.destroy();reject(error);};
    socket.setEncoding('utf8');
    socket.once('connect',()=>socket.write(`attach ${receipt.id} ${group} ${cap} ${scope}\n`));
    socket.on('data',(part:string)=>{text+=part;if(!text.includes('\n'))return;if(text.split('\n')[0]!=='ready')return fail(Error('case memory: '+text.trim()));answered=true;socket.end();resolve();});
    socket.once('error',fail);socket.once('close',()=>{if(!answered)fail(Error('case memory: broker ended before bounded entry'));});
  });
}
