// One synchronous entry boundary for modules that are also commands.
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

type Command=()=>number|void|Promise<number|void>;
/** Importing the module never starts its command or makes its graph async.
 * Commands keep their own handled diagnostics and statuses. Unhandled errors
 * share one stderr/exit policy; a void result preserves a status set by main.
 * An unsettled command fails when the loop drains, as top-level await did.
 * realpath retains the entry semantics of commands accepting symlink aliases. */
export function runAsCommand(url:string,main:Command,{realpath=false}:{realpath?:boolean}={}):void{
  const entry=process.argv[1];
  if(!entry||pathToFileURL(realpath?realpathSync(entry):resolve(entry)).href!==url)return;
  const unsettled=()=>{
    console.error(`INSTRUMENT: command entry ${url}: main did not settle before the event loop drained`);
    process.exitCode=13;
  };
  const finished=()=>process.removeListener('beforeExit',unsettled);
  const failed=(error:unknown)=>{finished();console.error(error);process.exitCode=1;};
  process.once('beforeExit',unsettled);
  try{void Promise.resolve(main()).then(code=>{finished();if(code!==undefined)process.exitCode=code;}).catch(failed);}
  catch(error){failed(error);}
}
