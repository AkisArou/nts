// The native supervisor records attempted operations and actual task facts.
// It never substitutes a syscall result or claims a path was opened.
import {createReadStream,mkdirSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {infrastructureProbe} from './infrastructure-probe.ts';

export type ByteFact={hex:string;error:number;truncated:boolean;null:boolean};
export type PathFact={arg:number;dirfdArg:number;value:ByteFact};
export type DescriptorFact={arg:number;fd:number;target:ByteFact};
export type InputAttempt={kind:'attempt';id:string;tid:number;tgid:number;ppid:number;birth:string;parentBirth:string;
  syscall:string;operation:string;outcome:'unknown';canceled:boolean;factsComplete:boolean;args:string[];
  cwd:ByteFact;image:ByteFact;argvRead:boolean;argv:ByteFact;paths:PathFact[];dirfds:DescriptorFact[]};
export type ObservationStart={kind:'start';version:2;mechanism:'seccomp-user-notification';noNewPrivileges:true};
export type ObservationEnd={kind:'complete';complete:boolean;root:number;entered:boolean;execErrno:number;exit:number;signal:number;attempts:number;errors:number;drainComplete:boolean;observerSignal:number};
export type InheritedDescriptor={kind:'inherited';fd:number;flags:number;target:ByteFact};
export type RootExit={kind:'root-exit';root:number;exit:number;signal:number};
export type RootStart={kind:'root-start';root:number};
export type ObservationError={kind:'error';message:string;errno:number};
export type ObservationRow=ObservationStart|ObservationEnd|InputAttempt|InheritedDescriptor|RootExit|RootStart|ObservationError;

export function prepareFileObserver(directory:string,env:NodeJS.ProcessEnv):string{
  if(!isAbsolute(directory))throw Error('file input observer: preparation directory must be absolute');
  mkdirSync(directory,{recursive:true});const binary=join(directory,'file-input-observer');
  const built=infrastructureProbe({purpose:'build the filesystem input observer',command:'cc',
    args:['-O2','-std=c11','-Wall','-Wextra','-Werror',fileURLToPath(new URL('./file-input-observer.c',import.meta.url)),'-o',binary],env});
  if(built.status!==0)throw Error('file input observer: build failed: '+built.stderr);
  return binary;
}
export function fileObserverArguments(record:string,command:string,args:readonly string[]):string[]{
  if(!isAbsolute(record))throw Error('file input observer: record must be absolute');
  return [record,'--',command,...args];
}
export function byteFactText(fact:ByteFact,purpose:string):string{
  if(fact.error||fact.truncated||fact.null)throw Error('file input observer: '+purpose+' is unreadable, null or truncated');
  try{return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(fact.hex,'hex'));}
  catch(error){throw Error('file input observer: '+purpose+' is not UTF-8',{cause:error});}
}
function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('file input observer: expected record object');
  return value as Record<string,unknown>;
}
function integer(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value);}
function byteFact(value:unknown):value is ByteFact{
  const row=object(value);return typeof row.hex==='string'&&/^(?:[0-9a-f]{2})*$/.test(row.hex)&&integer(row.error)&&row.error>=0&&typeof row.truncated==='boolean'&&typeof row.null==='boolean';
}
export function readObservationRow(value:unknown):ObservationRow{
  const row=object(value);let valid=false;
  if(row.kind==='start')valid=row.version===2&&row.mechanism==='seccomp-user-notification'&&row.noNewPrivileges===true;
  else if(row.kind==='complete')valid=typeof row.complete==='boolean'&&typeof row.entered==='boolean'&&typeof row.drainComplete==='boolean'
    &&['root','execErrno','exit','signal','attempts','errors','observerSignal'].every(key=>integer(row[key]));
  else if(row.kind==='root-start')valid=integer(row.root)&&row.root>0;
  else if(row.kind==='root-exit')valid=['root','exit','signal'].every(key=>integer(row[key]));
  else if(row.kind==='error')valid=typeof row.message==='string'&&integer(row.errno);
  else if(row.kind==='inherited')valid=integer(row.fd)&&integer(row.flags)&&byteFact(row.target);
  else if(row.kind==='attempt')valid=typeof row.id==='string'&&/^\d+$/.test(row.id)&&['tid','tgid','ppid'].every(key=>integer(row[key]))
    &&typeof row.birth==='string'&&/^\d+$/.test(row.birth)&&typeof row.parentBirth==='string'&&/^\d+$/.test(row.parentBirth)
    &&typeof row.syscall==='string'&&typeof row.operation==='string'&&row.outcome==='unknown'&&typeof row.canceled==='boolean'&&typeof row.factsComplete==='boolean'
    &&Array.isArray(row.args)&&row.args.length===6&&row.args.every(arg=>typeof arg==='string'&&/^[0-9a-f]+$/.test(arg))
    &&byteFact(row.cwd)&&byteFact(row.image)&&typeof row.argvRead==='boolean'&&byteFact(row.argv)
    &&Array.isArray(row.paths)&&row.paths.every(value=>{const path=object(value);return integer(path.arg)&&integer(path.dirfdArg)&&byteFact(path.value);})
    &&Array.isArray(row.dirfds)&&row.dirfds.every(value=>{const fd=object(value);return integer(fd.arg)&&integer(fd.fd)&&byteFact(fd.target);});
  if(!valid)throw Error('file input observer: malformed '+String(row.kind)+' record');
  return row as ObservationRow;
}

/** A raw record is complete only after the native writer has drained every
 * filter peer and closed. Rows stay bounded by the producer's pathname/argv
 * buffers; no entire raw trace is loaded as a string. */
export async function readFileObservation(file:string,visit:(row:ObservationRow)=>void):Promise<ObservationEnd>{
  const lines=createInterface({input:createReadStream(file),crlfDelay:Infinity});let start=false,end:ObservationEnd|undefined,attempts=0;
  for await(const line of lines){
    if(Buffer.byteLength(line)>256*1024)throw Error('file input observer: record exceeds bounded row size');
    const row=readObservationRow(JSON.parse(line) as unknown);
    if(end)throw Error('file input observer: data follows completion');
    if(!start){if(row.kind!=='start')throw Error('file input observer: missing header');start=true;}
    else if(row.kind==='start')throw Error('file input observer: duplicate header');
    if(row.kind==='attempt')attempts++;
    if(row.kind==='complete')end=row;
    visit(row);
  }
  if(!end||!end.complete||!end.drainComplete||end.errors||end.attempts!==attempts)
    throw Error('file input observer: incomplete census'+(end?' (attempts '+attempts+'/'+end.attempts+', errors '+end.errors+')':''));
  return end;
}
