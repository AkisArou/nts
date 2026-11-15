// A parent owns the persistent image reader independently of the stopped
// subject. Its protocol pipes are passed explicitly to the native observer;
// subject execs never inherit them, and completion waits for both processes.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {closeSync,openSync,readFileSync,mkdirSync,rmSync,writeSync,constants} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {moduleGraph} from './module-closure.ts';
import {executableModuleSource} from './reader-inputs/main.ts';
import {ToolingInstrumentError} from './step-result.ts';
import type {FileObserverReceipt} from './file-input-observer.ts';
import {registerCommandCloser} from '../differential/command-entry/main.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';

const ENTRY=new URL('./rust-child-loader.ts',import.meta.url),ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
export function prepareObserverImageReader(){
  const graph=moduleGraph({sourceRoot:ROOT});let files:{path:string;sha256:string}[];
  try{
    const members=graph.describe([fileURLToPath(ENTRY)]).moduleFiles.filter(executableModuleSource),generation=new Map(graph.sourceInputs().map(row=>[row.path,row.sha256]));
    files=members.sort().map(path=>{const absolute=resolve(ROOT,path),digest=generation.get(path)??generation.get(absolute);
      if(!digest||sha(readFileSync(absolute))!==digest)throw Error('image-reader source generation changed: '+path);
      return {path:absolute,sha256:digest};});
  }finally{graph.close();}
  const recipe={sha256:sha(JSON.stringify(files)),files};
  return {recipe,verify(){for(const row of files)if(sha(readFileSync(row.path))!==row.sha256)throw Error('image-reader source changed: '+row.path);}};
}
export function observerImageSession(prepared:ReturnType<typeof prepareObserverImageReader>,receipt:FileObserverReceipt,log:string,env:NodeJS.ProcessEnv){
  prepared.verify();
  const cleanups:(()=>void)[]=[],cleanup=(primary?:unknown)=>{
    const errors:unknown[]=[];
    for(const close of [...cleanups].reverse())try{close();}catch(error){errors.push(error);}
    cleanups.length=0;
    if(errors.length)throw new ToolingInstrumentError('tooling-cleanup','image-reader drain failed: '+[...(primary===undefined?[]:[primary]),...errors].map(String).join('; '),
      {cause:new AggregateError([...(primary===undefined?[]:[primary]),...errors])});
    if(primary!==undefined)throw primary;
  };
  try{
    const directory=log+'.pipes';mkdirSync(directory,{mode:0o700});cleanups.push(()=>rmSync(directory,{recursive:true}));
    const toReader=join(directory,'requests'),fromReader=join(directory,'responses');
    infrastructureProbe({purpose:'create private native image-reader protocol',command:'mkfifo',args:['-m','600',toReader,fromReader],env});
    // Numeric descriptors have one protocol consumer. A Node Readable would
    // compete with the native descriptor and could pre-buffer its reply.
    const input=openSync(toReader,constants.O_RDWR);cleanups.push(()=>closeSync(input));
    const output=openSync(fromReader,constants.O_RDWR);cleanups.push(()=>closeSync(output));
    const descriptor=openSync(log,'wx');cleanups.push(()=>closeSync(descriptor));
    const child=spawn(process.execPath,[fileURLToPath(ENTRY)],{env,stdio:[input,output,descriptor]});
    const ended=new Promise<{status:number|null;signal:NodeJS.Signals|null}>((done,reject)=>{
      child.once('error',reject);child.once('close',(status,signal)=>done({status,signal}));
    });
    void ended.catch(()=>{});
    let closed:Promise<void>|undefined;
    const finish=()=>closed??=(async()=>{
      let primary:unknown;
      try{writeSync(input,'{"kind":"close"}\n');const result=await ended;
        if(result.status!==0||result.signal)throw Error('image reader did not drain: '+JSON.stringify(result));prepared.verify();
      }catch(error){primary=error;}
      cleanup(primary);
    })();
    cleanups.push(registerCommandCloser('filesystem image reader',{close:finish}));
    const bound:FileObserverReceipt={...receipt,imageReader:prepared.recipe};
    return {receipt:bound,input,output,arguments(record:string,command:string,args:readonly string[]){return [record,'--image-reader',prepared.recipe.sha256,'--',command,...args];},finish};
  }catch(error){return cleanup(error) as never;}
}
