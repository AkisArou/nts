// The native supervisor records attempted operations and actual task facts.
// It never substitutes a syscall result or claims a path was opened.
import {createReadStream,mkdirSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGunzip} from 'node:zlib';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
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
export type SignalObservation={kind:'signal';signal:number;rootAlive:boolean};
export type ObservationRow=ObservationStart|ObservationEnd|InputAttempt|InheritedDescriptor|RootExit|RootStart|ObservationError|SignalObservation;

export function prepareFileObserver(directory:string,env:NodeJS.ProcessEnv):string{
  if(!isAbsolute(directory))throw Error('file input observer: preparation directory must be absolute');
  mkdirSync(directory,{recursive:true});const binary=join(directory,'file-input-observer');
  const built=infrastructureProbe({purpose:'build the filesystem input observer',command:'cc',
    args:['-O2','-std=c11','-Wall','-Wextra','-Werror',fileURLToPath(new URL('./file-input-observer.c',import.meta.url)),'-lz','-o',binary],env});
  if(built.status!==0)throw Error('file input observer: build failed: '+built.stderr);
  return binary;
}
export function fileObserverArguments(record:string,command:string,args:readonly string[]):string[]{
  if(!isAbsolute(record))throw Error('file input observer: record must be absolute');
  return [record,'--',command,...args];
}
/** The recorder shell keeps this identity when it execs the doctest. The same
 * native /proc reader supplies notification and publication birth facts. */
export function fileObserverBirth(binary:string,pid:number,env:NodeJS.ProcessEnv):string{
  if(!Number.isSafeInteger(pid)||pid<1)throw Error('file input observer: invalid recorder PID');
  const result=infrastructureProbe({purpose:'bind a Rust doctest recorder to its process birth',command:binary,args:['--birth',String(pid)],env});
  const birth=result.stdout.trim();
  if(result.status!==0||!/^\d+$/.test(birth)||birth==='0')throw Error('file input observer: recorder process identity unavailable: '+result.stderr);
  return birth;
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
function natural(value:unknown):value is number{return integer(value)&&value>=0;}
function exitStatus(exit:unknown,signal:unknown):boolean{
  return integer(exit)&&exit>=-1&&exit<=255&&natural(signal)&&signal<128&&(signal===0?exit>=0:exit===-1);
}
function byteFact(value:unknown):value is ByteFact{
  const row=object(value);return typeof row.hex==='string'&&/^(?:[0-9a-f]{2})*$/.test(row.hex)&&integer(row.error)&&row.error>=0&&typeof row.truncated==='boolean'&&typeof row.null==='boolean';
}
export function readObservationRow(value:unknown):ObservationRow{
  const row=object(value);let valid=false;
  if(row.kind==='start')valid=row.version===2&&row.mechanism==='seccomp-user-notification'&&row.noNewPrivileges===true;
  else if(row.kind==='complete')valid=typeof row.complete==='boolean'&&typeof row.entered==='boolean'&&typeof row.drainComplete==='boolean'
    &&['root','execErrno','attempts','errors','observerSignal'].every(key=>natural(row[key]))&&row.root!==0
    &&exitStatus(row.exit,row.signal)&&!(row.entered&&row.execErrno!==0);
  else if(row.kind==='root-start')valid=integer(row.root)&&row.root>0;
  else if(row.kind==='root-exit')valid=natural(row.root)&&row.root>0&&exitStatus(row.exit,row.signal);
  else if(row.kind==='error')valid=typeof row.message==='string'&&integer(row.errno);
  else if(row.kind==='signal')valid=integer(row.signal)&&row.signal>0&&typeof row.rootAlive==='boolean';
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
  let start=false,end:ObservationEnd|undefined,attempts=0,root:number|undefined,exited:RootExit|undefined;
  let pending=Buffer.alloc(0);
  const consume=(line:Buffer)=>{
    const row=readObservationRow(JSON.parse(line.toString('utf8')) as unknown);
    if(end)throw Error('file input observer: data follows completion');
    if(!start){if(row.kind!=='start')throw Error('file input observer: missing header');start=true;}
    else if(row.kind==='start')throw Error('file input observer: duplicate header');
    if(row.kind==='root-start'){
      if(root!==undefined)throw Error('file input observer: duplicate root start');root=row.root;
    }
    if(row.kind==='root-exit'){
      if(exited||row.root!==root)throw Error('file input observer: inconsistent root exit');exited=row;
    }
    if(row.kind==='attempt'){
      attempts++;
      if(!row.factsComplete)throw Error('file input observer: unreadable or truncated attempt facts');
    }
    if(row.kind==='complete'){
      if(!exited||row.root!==root||row.exit!==exited.exit||row.signal!==exited.signal)
        throw Error('file input observer: inconsistent terminal root status');
      end=row;
    }
    visit(row);
  };
  const consumeChunk=(chunk:Buffer)=>{
    pending=Buffer.concat([pending,chunk]);
    for(;;){
      const at=pending.indexOf(10);if(at<0)break;
      if(at>256*1024)throw Error('file input observer: record exceeds bounded row size');
      consume(pending.subarray(0,at));pending=pending.subarray(at+1);
    }
    if(pending.length>256*1024)throw Error('file input observer: record exceeds bounded row size');
  };
  await pipeline(createReadStream(file),createGunzip(),new Writable({write(chunk:Buffer,_encoding,callback){
    try{consumeChunk(chunk);callback();}
    catch(error){callback(error instanceof Error?error:new Error(String(error)));}
  }}));
  if(pending.length)throw Error('file input observer: unterminated raw record');
  if(!end||!end.complete||!end.drainComplete||end.errors||end.attempts!==attempts)
    throw Error('file input observer: incomplete census'+(end?' (attempts '+attempts+'/'+end.attempts+', errors '+end.errors+')':''));
  return end;
}
