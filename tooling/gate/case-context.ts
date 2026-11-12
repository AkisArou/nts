// A case's lease follows its asynchronous work, not the controller process:
// one controller may have many independent cases active at the same time.
import {AsyncLocalStorage} from 'node:async_hooks';
import {connect} from 'node:net';
import {spawnSync} from 'node:child_process';

export const CASE_LEASE_ADDRESS='NTS_GATE_CASE_LEASE_ADDRESS';
export const CASE_LEASE_ID='NTS_GATE_CASE_LEASE_ID';
export type CaseReceipt={address:string;id:string};
export type TokenRelease=(()=>void)&{case?:CaseReceipt;closed?:Promise<void>};
const current=new AsyncLocalStorage<CaseReceipt>();
const cleanups=new Map<string,Set<()=>void>>();

export function ownCaseWorker(receipt:CaseReceipt|undefined,close:()=>void):void{
  if(!receipt)return;
  const owned=cleanups.get(receipt.id)??new Set<()=>void>();owned.add(close);cleanups.set(receipt.id,owned);
}
export function closeCaseWorkers(receipt:CaseReceipt):void{
  const owned=cleanups.get(receipt.id);cleanups.delete(receipt.id);for(const close of owned??[])close();
}
/** Capture the last peak before the owner removes a worker cgroup. Bash's
 * built-in socket avoids starting another Node process for this handshake. */
export function retireCaseScope(receipt:CaseReceipt|undefined,group:string):void{
  if(!receipt)return;
  const source='address=$1; id=$2; group=$3; exec {fd}<>"/dev/tcp/${address%:*}/${address##*:}" || exit 1; printf "retire %s %s\\n" "$id" "$group" >&"$fd"; IFS= read -r answer <&"$fd" || exit 1; [ "$answer" = ready ] || { printf "%s\\n" "$answer" >&2; exit 1; }';
  const result=spawnSync('bash',['--noprofile','--norc','-c',source,'case memory retirement',receipt.address,receipt.id,group],{encoding:'utf8',timeout:30_000});
  if(result.status!==0)throw Error('case memory: cannot retire owned scope: '+(result.stderr||result.error?.message||result.signal));
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
