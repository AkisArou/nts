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
import {validProcfsTaskAnchor,type CapturedKernelFilesystem,type ProcfsTaskAnchor} from './captured-path.ts';
import {childLoaderFact,type ChildLoaderObservation,type LoaderCacheStatistics} from './rust-loader.ts';
import {IMAGE_READER_COMPILER_DEFINITION,IMAGE_READER_FRAME_BYTES} from './image-reader-protocol.ts';

export type ByteFact={hex:string;error:number;truncated:boolean;null:boolean};
export type PathResolutionFact={state:'unavailable';error:number}|{state:'resolved'|'missing'|'not-directory';path:ByteFact;finalLink:boolean;finalComponent?:boolean;
  namespace:{dev:string;ino:string;rootDev:string;rootIno:string};components:{path:ByteFact;kind:'directory'|'file'|'symlink'|'other'|'missing';dev:string;ino:string;link?:ByteFact;
    filesystem?:CapturedKernelFilesystem;taskAnchor?:ProcfsTaskAnchor}[]};
export type PathFact={arg:number;dirfdArg:number;value:ByteFact;resolution?:PathResolutionFact};
export type DescriptorFact={arg:number;fd:number;target:ByteFact};
export type ExecEntry={source:'syscall-entry';argv:ByteFact;target:ByteFact;environment?:ByteFact};
export type InputAttempt={kind:'attempt';id:string;tid:number;tgid:number;ppid:number;birth:string;parentBirth:string;
  syscall:string;operation:string;outcome:'unknown';canceled:boolean;factsComplete:boolean;args:string[];
  cwd:ByteFact;image:ByteFact;argvRead:boolean;argv:ByteFact;exec?:ExecEntry;imageLoader?:ChildLoaderObservation;paths:PathFact[];dirfds:DescriptorFact[]};
export type ObservationStart={kind:'start';version:2|3|4|5|6|7;mechanism:'seccomp-user-notification';noNewPrivileges:true;imageReaderRecipe?:string|null};
export const LEGACY_OBSERVATION_ROW_BYTES=256*1024;
export const MAX_OBSERVATION_ROW_BYTES=IMAGE_READER_FRAME_BYTES;
const OBSERVATION_ROW_BOUNDS=new Map([[2,LEGACY_OBSERVATION_ROW_BYTES],[3,LEGACY_OBSERVATION_ROW_BYTES],
  [4,LEGACY_OBSERVATION_ROW_BYTES],[5,LEGACY_OBSERVATION_ROW_BYTES],[6,LEGACY_OBSERVATION_ROW_BYTES],[7,MAX_OBSERVATION_ROW_BYTES]]);
export type ImageReaderEnd={kind:'image-reader-end';value:{version:1;kind:'complete';statistics:LoaderCacheStatistics}};
export type ObservationEnd={kind:'complete';complete:boolean;root:number;entered:boolean;execErrno:number;exit:number;signal:number;attempts:number;errors:number;drainComplete:boolean;observerSignal:number;resolutionWalks?:number;resolutionStats?:number};
export type InheritedDescriptor={kind:'inherited';fd:number;flags:number;target:ByteFact};
export type RootExit={kind:'root-exit';root:number;exit:number;signal:number};
export type RootStart={kind:'root-start';root:number};
export type ObservationError={kind:'error';message:string;errno:number};
export type SignalObservation={kind:'signal';signal:number;rootAlive:boolean};
export type ObservationRow=ObservationStart|ObservationEnd|InputAttempt|InheritedDescriptor|RootExit|RootStart|ObservationError|SignalObservation|ImageReaderEnd;
export function canceledLifetime(row:InputAttempt):boolean{
  return row.canceled&&row.operation==='lifetime'&&(row.syscall==='exit'||row.syscall==='exit_group')&&row.paths.length===0&&row.dirfds.length===0;
}

export type FileObserverReceipt={version:1;observedPath:string;artifactPath:string;sha256:string;sourceSha256:string;abi:'linux-x86_64-v1'|'linux-aarch64-v1';imageReader?:{sha256:string;files:{path:string;sha256:string}[]}};
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function imageReaderRecipeValid(value:unknown):value is NonNullable<FileObserverReceipt['imageReader']>{
  if(!value||typeof value!=='object')return false;
  const row=value as NonNullable<FileObserverReceipt['imageReader']>;
  return typeof row.sha256==='string'&&Array.isArray(row.files)&&row.files.length>0&&row.files.length<=4096
    &&row.files.every(item=>item&&typeof item.path==='string'&&isAbsolute(item.path)&&/^[0-9a-f]{64}$/.test(item.sha256))
    &&createHash('sha256').update(JSON.stringify(row.files)).digest('hex')===row.sha256;
}
/** A retained binary supplies the ABI; the decoder's own architecture does not.
 * Its source digest is evidence to bind against the accepted build receipt. */
export function retainedFileObserverReceipt(value:Omit<FileObserverReceipt,'version'|'abi'>):FileObserverReceipt{
  if(!isAbsolute(value.observedPath)||!isAbsolute(value.artifactPath)||!/^([0-9a-f]{64})$/.test(value.sha256)||!/^([0-9a-f]{64})$/.test(value.sourceSha256))
    throw Error('file input observer: invalid observer receipt');
  if(value.imageReader!==undefined&&!imageReaderRecipeValid(value.imageReader))throw Error('file input observer: invalid image-reader recipe');
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
    args:['-O2','-std=c11','-Wall','-Wextra','-Werror','-pthread',IMAGE_READER_COMPILER_DEFINITION,source,'-lz','-o',binary],env});
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
export function byteFact(value:unknown):value is ByteFact{
  const row=object(value);return typeof row.hex==='string'&&/^(?:[0-9a-f]{2})*$/.test(row.hex)&&integer(row.error)&&row.error>=0&&typeof row.truncated==='boolean'&&typeof row.null==='boolean';
}
function pathResolution(value:unknown,task:{tid:number;tgid:number}):boolean{
  const row=object(value);
  if(row.state==='unavailable')return natural(row.error)&&row.error!==0;
  const namespace=object(row.namespace),decimal=(v:unknown)=>typeof v==='string'&&/^\d+$/.test(v);
  return ['resolved','missing','not-directory'].includes(String(row.state))&&byteFact(row.path)&&typeof row.finalLink==='boolean'
    &&(row.finalComponent===undefined||typeof row.finalComponent==='boolean')
    &&['dev','ino','rootDev','rootIno'].every(key=>decimal(namespace[key]))&&Array.isArray(row.components)&&row.components.length>0&&row.components.length<=128
    &&row.components.every(item=>{const part=object(item);return byteFact(part.path)&&['directory','file','symlink','other','missing'].includes(String(part.kind))
      &&decimal(part.dev)&&decimal(part.ino)&&(part.link===undefined||part.kind==='symlink'&&byteFact(part.link))
      &&(part.filesystem===undefined||part.filesystem==='procfs'||part.filesystem==='sysfs')
      &&(part.taskAnchor===undefined||part.kind==='symlink'&&part.filesystem==='procfs'&&part.link===undefined&&validProcfsTaskAnchor(part.taskAnchor,task));});
}
export function readObservationRow(value:unknown):ObservationRow{
  const row=object(value);let valid=false;
  if(row.kind==='start')valid=typeof row.version==='number'&&OBSERVATION_ROW_BOUNDS.has(row.version)&&row.mechanism==='seccomp-user-notification'&&row.noNewPrivileges===true
    &&(row.imageReaderRecipe===undefined||row.imageReaderRecipe===null||typeof row.imageReaderRecipe==='string'&&/^[0-9a-f]{64}$/.test(row.imageReaderRecipe));
  else if(row.kind==='image-reader-end'){
    const end=object(row.value),stats=object(end.statistics);valid=end.version===1&&end.kind==='complete'
      &&['elfHits','elfMisses','loaderHits','loaderMisses'].every(key=>natural(stats[key]))
      &&['contentIdentityHits','contentIdentityMisses','forcedByteFences','hashedBytes'].every(key=>stats[key]===undefined||natural(stats[key]));
  }
  else if(row.kind==='complete')valid=typeof row.complete==='boolean'&&typeof row.entered==='boolean'&&typeof row.drainComplete==='boolean'
    &&['root','execErrno','attempts','errors','observerSignal'].every(key=>natural(row[key]))&&row.root!==0
    &&['resolutionWalks','resolutionStats'].every(key=>row[key]===undefined||natural(row[key]))
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
    &&(row.exec===undefined||(['execve','execveat'].includes(String(row.syscall))&&object(row.exec).source==='syscall-entry'&&byteFact(object(row.exec).argv)&&byteFact(object(row.exec).target)
      &&(object(row.exec).environment===undefined||byteFact(object(row.exec).environment))))
    &&(row.imageLoader===undefined||typeof object(row.imageLoader).namespaceStable==='boolean'&&childLoaderFact(object(row.imageLoader).capture))
    &&Array.isArray(row.paths)&&row.paths.every(value=>{const path=object(value);return integer(path.arg)&&integer(path.dirfdArg)&&byteFact(path.value)&&(path.resolution===undefined||pathResolution(path.resolution,{tid:Number(row.tid),tgid:Number(row.tgid)}));})
    &&Array.isArray(row.dirfds)&&row.dirfds.every(value=>{const fd=object(value);return integer(fd.arg)&&integer(fd.fd)&&byteFact(fd.target);});
  if(!valid)throw Error('file input observer: malformed '+String(row.kind)+' record');
  return row as ObservationRow;
}

/** A raw record is complete only after the native writer has drained every
 * filter peer and closed. Rows stay bounded by the producer's pathname/argv
 * buffers; no entire raw trace is loaded as a string. */
export type CaptureArtifact={sha256:string;bytes:number};
export async function readFileObservation(file:string,visit:(row:ObservationRow)=>void|Promise<void>):Promise<{terminal:ObservationEnd;artifact:CaptureArtifact}>{
  let start=false,version:ObservationStart['version']|undefined,end:ObservationEnd|undefined,attempts=0,root:number|undefined,exited:RootExit|undefined;
  let readerRecipe:string|null|undefined,readerEnded=false;
  const consume=async(value:unknown)=>{
    const row=readObservationRow(value);
    if(end)throw Error('file input observer: data follows completion');
    if(!start){if(row.kind!=='start')throw Error('file input observer: missing header');start=true;version=row.version;readerRecipe=row.imageReaderRecipe;
      if(version>=6&&readerRecipe===undefined)throw Error('file input observer: missing image-reader capability fact');}
    else if(row.kind==='start')throw Error('file input observer: duplicate header');
    if(row.kind==='root-start'){
      if(root!==undefined)throw Error('file input observer: duplicate root start');root=row.root;
    }
    if(row.kind==='root-exit'){
      if(exited||row.root!==root)throw Error('file input observer: inconsistent root exit');exited=row;
    }
    if(row.kind==='attempt'){
      if(readerEnded)throw Error('file input observer: attempt follows image-reader drain');
      if(row.imageLoader&&!readerRecipe)throw Error('file input observer: image receipt has no capture helper');
      attempts++;
      if(version!>=3&&['execve','execveat'].includes(row.syscall)&&!row.exec)throw Error('file input observer: missing exec request arguments');
      if(version!>=6&&row.exec&&!row.exec.environment)throw Error('file input observer: missing stopped exec environment');
      if(version!>=4&&row.paths.some(path=>!path.resolution))throw Error('file input observer: missing capture-time resolution fact');
      if(version!>=5&&row.paths.some(path=>path.resolution?.state!=='unavailable'&&typeof path.resolution?.finalComponent!=='boolean'))
        throw Error('file input observer: missing final-component fact');
      if(!row.factsComplete&&!canceledLifetime(row))throw Error('file input observer: unreadable or truncated attempt facts');
    }
    if(row.kind==='image-reader-end'){
      if(!readerRecipe||readerEnded)throw Error('file input observer: unbound or repeated image-reader drain');readerEnded=true;
    }
    if(row.kind==='complete'){
      if(!!readerRecipe!==readerEnded)throw Error('file input observer: missing image-reader drain');
      if(!exited||row.root!==root||row.exit!==exited.exit||row.signal!==exited.signal)
        throw Error('file input observer: inconsistent terminal root status');
      end=row;
    }
    await visit(row);
  };
  const artifact=await readCompressedRecords(file,consume,header=>OBSERVATION_ROW_BOUNDS.get(Number(object(header).version))!);
  if(!end||!end.complete||!end.drainComplete||end.errors||end.attempts!==attempts)
    throw Error('file input observer: incomplete census'+(end?' (attempts '+attempts+'/'+end.attempts+', errors '+end.errors+')':''));
  return {terminal:end,artifact};
}

/** Shared bounded codec for native records and attributed census indices. */
export async function readCompressedRecords(file:string,visit:(value:unknown)=>void|Promise<void>,rowBound:(header:unknown)=>number):Promise<CaptureArtifact>{
  let pending:Buffer[]=[],pendingBytes=0,bytes=0,limit=LEGACY_OBSERVATION_ROW_BYTES,header=true;
  const digest=createHash('sha256'),input=createReadStream(file);
  input.on('data',(chunk:Buffer)=>{bytes+=chunk.length;digest.update(chunk);});
  const consumeChunk=async(chunk:Buffer)=>{
    let start=0;
    for(;;){
      // Search each arriving byte once. Retain fragments until a complete row
      // can be joined once, rather than copying and rescanning its prefix.
      const at=chunk.indexOf(10,start);if(at<0)break;
      const size=pendingBytes+at-start;
      if(size>limit)throw Error('file input observer: record exceeds bounded row size');
      const tail=chunk.subarray(start,at),line=pending.length?Buffer.concat([...pending,tail],size):tail;
      pending=[];pendingBytes=0;start=at+1;
      const value=JSON.parse(line.toString('utf8')) as unknown;
      await visit(value);
      if(header){limit=rowBound(value);header=false;}
    }
    if(start<chunk.length){pending.push(chunk.subarray(start));pendingBytes+=chunk.length-start;}
    if(pendingBytes>limit)throw Error('file input observer: record exceeds bounded row size');
  };
  await pipeline(input,createGunzip(),new Writable({write(chunk:Buffer,_encoding,callback){
    consumeChunk(chunk).then(()=>callback(),error=>callback(error instanceof Error?error:new Error(String(error))));
  }}));
  if(pendingBytes)throw Error('file input observer: unterminated raw record');
  return {sha256:digest.digest('hex'),bytes};
}
