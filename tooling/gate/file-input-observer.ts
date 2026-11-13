// The native supervisor records attempted operations and actual task facts.
// It never substitutes a syscall result or claims a path was opened.
import {createReadStream,mkdirSync,readFileSync,realpathSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createGunzip} from 'node:zlib';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
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
export function canceledLifetime(row:InputAttempt):boolean{
  return row.canceled&&row.operation==='lifetime'&&(row.syscall==='exit'||row.syscall==='exit_group')&&row.paths.length===0&&row.dirfds.length===0;
}

export type FileObserverReceipt={version:1;observedPath:string;artifactPath:string;sha256:string;sourceSha256:string;abi:'linux-x86_64-v1'|'linux-aarch64-v1'};
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
/** A retained binary supplies the ABI; the decoder's own architecture does not.
 * Its source digest is evidence to bind against the accepted build receipt. */
export function retainedFileObserverReceipt(value:Omit<FileObserverReceipt,'version'|'abi'>):FileObserverReceipt{
  if(!isAbsolute(value.observedPath)||!isAbsolute(value.artifactPath)||!/^([0-9a-f]{64})$/.test(value.sha256)||!/^([0-9a-f]{64})$/.test(value.sourceSha256))
    throw Error('file input observer: invalid observer receipt');
  const bytes=readFileSync(value.artifactPath);
  if(digest(bytes)!==value.sha256)throw Error('file input observer: retained observer digest changed');
  if(bytes.length<20||!bytes.subarray(0,4).equals(Buffer.from([127,69,76,70]))||bytes[4]!==2||bytes[5]!==1)
    throw Error('file input observer: observer has no supported ELF64 little-endian ABI');
  const machine=bytes.readUInt16LE(18),abi=machine===62?'linux-x86_64-v1':machine===183?'linux-aarch64-v1':undefined;
  if(!abi)throw Error('file input observer: unsupported observer ELF machine '+machine);
  return {...value,version:1,abi};
}
export function prepareFileObserver(directory:string,env:NodeJS.ProcessEnv):{executable:string;receipt:FileObserverReceipt}{
  if(!isAbsolute(directory))throw Error('file input observer: preparation directory must be absolute');
  mkdirSync(directory,{recursive:true});const binary=join(directory,'file-input-observer'),source=fileURLToPath(new URL('./file-input-observer.c',import.meta.url)),sourceSha256=digest(readFileSync(source));
  const built=infrastructureProbe({purpose:'build the filesystem input observer',command:'cc',
    args:['-O2','-std=c11','-Wall','-Wextra','-Werror',source,'-lz','-o',binary],env});
  if(built.status!==0)throw Error('file input observer: build failed: '+built.stderr);
  if(digest(readFileSync(source))!==sourceSha256)throw Error('file input observer: source changed during preparation');
  return {executable:binary,receipt:retainedFileObserverReceipt({observedPath:realpathSync(binary),artifactPath:binary,sha256:digest(readFileSync(binary)),sourceSha256})};
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
    &&Array.isArray(row.args)&&row.args.length===6&&row.args.every(arg=>typeof arg==='string'&&/^[0-9a-f]{1,16}$/.test(arg))
    &&byteFact(row.cwd)&&byteFact(row.image)&&typeof row.argvRead==='boolean'&&byteFact(row.argv)
    &&Array.isArray(row.paths)&&row.paths.every(value=>{const path=object(value);return integer(path.arg)&&integer(path.dirfdArg)&&byteFact(path.value);})
    &&Array.isArray(row.dirfds)&&row.dirfds.every(value=>{const fd=object(value);return integer(fd.arg)&&integer(fd.fd)&&byteFact(fd.target);});
  if(!valid)throw Error('file input observer: malformed '+String(row.kind)+' record');
  return row as ObservationRow;
}

/** A raw record is complete only after the native writer has drained every
 * filter peer and closed. Rows stay bounded by the producer's pathname/argv
 * buffers; no entire raw trace is loaded as a string. */
export type CaptureArtifact={sha256:string;bytes:number};
export async function readFileObservation(file:string,visit:(row:ObservationRow)=>void|Promise<void>):Promise<{terminal:ObservationEnd;artifact:CaptureArtifact}>{
  let start=false,end:ObservationEnd|undefined,attempts=0,root:number|undefined,exited:RootExit|undefined;
  const consume=async(value:unknown)=>{
    const row=readObservationRow(value);
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
      if(!row.factsComplete&&!canceledLifetime(row))throw Error('file input observer: unreadable or truncated attempt facts');
    }
    if(row.kind==='complete'){
      if(!exited||row.root!==root||row.exit!==exited.exit||row.signal!==exited.signal)
        throw Error('file input observer: inconsistent terminal root status');
      end=row;
    }
    await visit(row);
  };
  const artifact=await readCompressedRecords(file,consume);
  if(!end||!end.complete||!end.drainComplete||end.errors||end.attempts!==attempts)
    throw Error('file input observer: incomplete census'+(end?' (attempts '+attempts+'/'+end.attempts+', errors '+end.errors+')':''));
  return {terminal:end,artifact};
}

export const MAX_OBSERVATION_ROW_BYTES=256*1024;
/** Shared bounded codec for native records and attributed census indices. */
export async function readCompressedRecords(file:string,visit:(value:unknown)=>void|Promise<void>):Promise<CaptureArtifact>{
  let pending=Buffer.alloc(0),bytes=0;
  const digest=createHash('sha256'),input=createReadStream(file);
  input.on('data',(chunk:Buffer)=>{bytes+=chunk.length;digest.update(chunk);});
  const consumeChunk=async(chunk:Buffer)=>{
    pending=Buffer.concat([pending,chunk]);
    for(;;){
      const at=pending.indexOf(10);if(at<0)break;
      if(at>MAX_OBSERVATION_ROW_BYTES)throw Error('file input observer: record exceeds bounded row size');
      const line=pending.subarray(0,at);pending=pending.subarray(at+1);
      await visit(JSON.parse(line.toString('utf8')) as unknown);
    }
    if(pending.length>MAX_OBSERVATION_ROW_BYTES)throw Error('file input observer: record exceeds bounded row size');
  };
  await pipeline(input,createGunzip(),new Writable({write(chunk:Buffer,_encoding,callback){
    consumeChunk(chunk).then(()=>callback(),error=>callback(error instanceof Error?error:new Error(String(error))));
  }}));
  if(pending.length)throw Error('file input observer: unterminated raw record');
  return {sha256:digest.digest('hex'),bytes};
}
