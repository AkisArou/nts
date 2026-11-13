// Cargo, rather than executable filename conventions, binds a trace to its
// target source. Declarations and the selector use that same source identity.
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {basename,isAbsolute,relative,resolve,sep} from 'node:path';
import {durableRecord,durableRecordStream} from './durable-record.ts';
import {byteFactText,canceledLifetime,fileObserverBirth,MAX_OBSERVATION_ROW_BYTES,readCompressedRecords,readFileObservation,readObservationRow,retainedFileObserverReceipt,type ByteFact,type InputAttempt,type InheritedDescriptor,type ObservationEnd,type FileObserverReceipt,type CaptureArtifact} from './file-input-observer.ts';

export type RustTarget={package:string;name:string;kind:string[];source:string};
const inside=(root:string,path:string)=>{const part=relative(root,path);return !isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep);};
function fail(message:string):never{throw Error('Rust test inputs: '+message);}

/** Cargo's owner publishes its exit separately from the observer's status. */
export function testBuildStatus(value:unknown):number{
  if(!value||typeof value!=='object')fail('missing Cargo artifact evidence');
  const row=value as {version?:unknown;status?:unknown;buildFinished?:unknown;artifacts?:unknown};
  if(row.version!==1||typeof row.status!=='number'||!Number.isInteger(row.status)||row.status<0||row.status>255
    ||typeof row.buildFinished!=='boolean'||!Array.isArray(row.artifacts))fail('invalid Cargo completion evidence');
  return row.status;
}
export function readTestBuildStatus(file:string):number{return testBuildStatus(JSON.parse(readFileSync(file,'utf8')));}

export function testArtifactTargets(value:unknown,root:string):Map<string,RustTarget>{
  if(!value||typeof value!=='object')fail('missing Cargo artifact evidence');
  const evidence=value as {version?:unknown;status?:unknown;buildFinished?:unknown;artifacts?:unknown};
  testBuildStatus(value);
  if(evidence.version!==1||evidence.status!==0||evidence.buildFinished!==true||!Array.isArray(evidence.artifacts))fail('incomplete Cargo artifact evidence');
  const targets=new Map<string,RustTarget>();
  for(const row of evidence.artifacts){
    if(!row||typeof row!=='object')fail('invalid Cargo artifact');
    const artifact=row as {executable?:unknown;package_id?:unknown;profile?:{test?:unknown};target?:{name?:unknown;kind?:unknown;src_path?:unknown}};
    if(artifact.profile?.test!==true||artifact.executable===null||artifact.executable===undefined)continue;
    const target=artifact.target;
    if(typeof artifact.executable!=='string'||!isAbsolute(artifact.executable)||typeof artifact.package_id!=='string'
      ||!target||typeof target.name!=='string'||typeof target.src_path!=='string'||!isAbsolute(target.src_path)
      ||!inside(root,target.src_path)||!Array.isArray(target.kind)||target.kind.some(kind=>typeof kind!=='string'))fail('invalid test target identity');
    const identity:RustTarget={package:artifact.package_id,name:target.name,kind:target.kind,source:relative(root,target.src_path).split(sep).join('/')};
    const previous=targets.get(artifact.executable);if(previous&&JSON.stringify(previous)!==JSON.stringify(identity))fail('conflicting target for '+artifact.executable);
    targets.set(artifact.executable,identity);
  }
  if(!targets.size)fail('Cargo named no test executable');
  return targets;
}

export type TracePhase={phase:'cargo-setup'|'rustdoc-setup'|'doctest-runtime'|'test-runtime';source?:string};
export type DoctestCall={version:1;pid:number;birth:string;cwd:string;argv:string[]};
export function recordDoctestCall(directory:string,observer:string,pid:number,argv:string[],env:NodeJS.ProcessEnv):void{
  if(!isAbsolute(directory)||!argv[0]||!isAbsolute(argv[0]))fail('invalid doctest recorder command');
  const birth=fileObserverBirth(observer,pid,env);
  durableRecord(resolve(directory,String(pid)+'-'+birth+'-'+randomUUID()+'.json'),{version:1,pid,birth,cwd:process.cwd(),argv});
}
export function readDoctestCalls(directory:string):DoctestCall[]{
  return readdirSync(directory).map(name=>{
    const row=JSON.parse(readFileSync(resolve(directory,name),'utf8')) as Partial<DoctestCall>;
    if(row.version!==1||!Number.isSafeInteger(row.pid)||row.pid!<1||typeof row.birth!=='string'||!/^\d+$/.test(row.birth)||row.birth==='0'
      ||typeof row.cwd!=='string'||!isAbsolute(row.cwd)||!Array.isArray(row.argv)||row.argv.some(arg=>typeof arg!=='string')
      ||!row.argv[0]||!isAbsolute(row.argv[0]))fail('invalid doctest call '+name);
    return row as DoctestCall;
  });
}
type Image={id:number;parent:number;pid:number;birth:string;path:string;cwd:string;args:string[];phase:TracePhase;reason:'first-observation'|'actual-image'|'actual-argv'|'actual-cwd'};
export type InputPathAnchor={kind:'absolute'}|{kind:'cwd';path:string}|{kind:'dirfd';fd:number;path:string;raw:string};
export type InputSubject={kind:'path';arg:number;dirfdArg:number;name:string;raw:string;anchor:InputPathAnchor}
  |{kind:'descriptor';arg:number;fd:number;target:string;raw:string;pathArgument?:{arg:number;dirfdArg:number;value:ByteFact}};
export type InputIndexProbe={probeKind:string;fd?:number;raw:string;rawPath?:string;error:number};
export type RuntimeObservation=TracePhase&{attempt:Pick<InputAttempt,'id'|'tid'|'tgid'|'ppid'|'birth'|'parentBirth'>;
  cwd:string;args:string[];operation:string;syscall:string;outcome:'unknown';image:number;canceled:boolean;subjects:InputSubject[];probes:InputIndexProbe[]};
export type InputOpenClass={kind:'content-read'|'write'|'directory'|'path'|'unknown';flags:string|null;abi:FileObserverReceipt['abi']|null;reason:string};
/** Requested open semantics only. A consumer must authenticate the observer
 * receipt/raw binding before using the ABI, and claim every later operation
 * independently. No result or descriptor use is inferred from this class. */
export function classifyInputOpen(row:Pick<RuntimeObservation,'syscall'|'operation'|'args'>,observer:FileObserverReceipt|null):InputOpenClass{
  const answer=(kind:InputOpenClass['kind'],flags:string|null,reason:string):InputOpenClass=>({kind,flags,abi:observer?.abi??null,reason});
  if(row.operation!=='open')return answer('unknown',null,'not an open operation');
  const index=row.syscall==='open'?1:row.syscall==='openat'?2:undefined;
  if(index===undefined)return answer('unknown',null,row.syscall==='openat2'?'openat2 structure was not captured':'unknown open syscall');
  const flags=row.args[index];
  if(flags===undefined||!/^[0-9a-f]{1,16}$/.test(flags))return answer('unknown',null,'missing scalar open flags');
  if(!observer)return answer('unknown',flags,'missing authenticated capture ABI');
  if(observer.abi!=='linux-x86_64-v1')return answer('unknown',flags,'open flag recipe is not implemented for '+observer.abi);
  const bits=BigInt('0x'+flags);
  // Linux x86-64 fcntl ABI: access bits 0..1 and known flags 6..22.
  // Unknown bits and noncanonical wider arguments retain no metadata authority.
  if((bits&~0x7fffc3n)!==0n)return answer('unknown',flags,'unknown open flag bits');
  if((bits&3n)===3n)return answer('unknown',flags,'invalid access mode');
  // __O_TMPFILE includes O_DIRECTORY but requests a new writable inode.
  if((bits&0x400000n)!==0n)return answer('write',flags,'temporary inode requested');
  if((bits&0x200000n)!==0n){
    if((bits&~0x2b0000n)!==0n)return answer('unknown',flags,'mixed path-only flags');
    return answer('path',flags,'path descriptor requested');
  }
  if((bits&(3n|0x40n|0x200n))!==0n)return answer('write',flags,'writable access, creation or truncation requested');
  if((bits&0x10000n)!==0n)return answer('directory',flags,'directory-only descriptor requested');
  return answer('content-read',flags,'readable file descriptor requested');
}
const key=(pid:number,birth:string)=>pid+':'+birth;
/** Image facts come from the stopped task, never the target of an exec attempt.
 * Calls are bound to the shell's PID/birth and only become runtime on an actual
 * matching image. The same pathname reused in another task grants nothing. */
export class RustInputPhases{
  private readonly tasks=new Map<string,Image>();
  private readonly argvFacts=new Map<string,string>();
  private nextImage=0;
  get imageCount():number{return this.nextImage;}
  private root:number|undefined;
  private readonly calls=new Map<string,DoctestCall>();
  private readonly entered=new Set<string>();
  private readonly tree:string;
  private readonly target:RustTarget|undefined;
  constructor(tree:string,target?:RustTarget,calls:readonly DoctestCall[]=[]){
    this.tree=tree;this.target=target;
    for(const call of calls){
      const identity=key(call.pid,call.birth);if(this.calls.has(identity))fail('duplicate doctest call identity '+identity);
      this.calls.set(identity,call);
    }
  }
  start(pid:number):void{if(this.root!==undefined)fail('duplicate observed root');this.root=pid;}
  observe(row:InputAttempt):Image{
    if(!row.factsComplete||!row.birth||row.birth==='0')fail('missing task identity/image facts');
    const identity=key(row.tgid,row.birth),previous=this.tasks.get(identity);
    const path=byteFactText(row.image,'actual task image'),cwd=byteFactText(row.cwd,'actual task cwd');
    const actualArgv=row.argvRead?row.argv.hex:'';
    if(previous?.path===path&&previous.cwd===cwd&&this.argvFacts.get(identity)===actualArgv)return previous;
    const args=row.argvRead?byteFactText(row.argv,'actual rustdoc argv').split('\0').filter(Boolean):[];
    const parent=this.tasks.get(key(row.ppid,row.parentBirth));
    if(!this.target&&!previous&&!parent&&row.tgid!==this.root)fail('unattributed task '+identity+' parent '+key(row.ppid,row.parentBirth));
    let phase:TracePhase=this.target?{phase:'test-runtime',source:this.target.source}:{...(previous?.phase??parent?.phase??{phase:'cargo-setup'})};
    if(!this.target&&phase.phase!=='doctest-runtime'&&basename(path)==='rustdoc'&&args.includes('--test')){
      const sources=args.filter(arg=>arg.endsWith('.rs')).map(arg=>resolve(cwd,arg)).filter(path=>inside(this.tree,path));
      if(sources.length!==1)fail('rustdoc has no unique source entry: '+path);
      phase={phase:'rustdoc-setup',source:relative(this.tree,sources[0]!).split(sep).join('/')};
    }
    const call=this.calls.get(identity);
    if(call&&path===call.argv[0]){
      if(phase.phase!=='rustdoc-setup'||!phase.source)fail('doctest entry has no rustdoc source: '+identity);
      phase={phase:'doctest-runtime',source:phase.source};this.entered.add(identity);
    }
    const image:Image={id:++this.nextImage,parent:previous?.id??parent?.id??0,pid:row.tgid,birth:row.birth,path,cwd,args,phase,
      reason:!previous?'first-observation':previous.path!==path?'actual-image':previous.cwd!==cwd?'actual-cwd':'actual-argv'};
    this.tasks.set(identity,image);this.argvFacts.set(identity,actualArgv);return image;
  }
  finish():void{for(const identity of this.calls.keys())if(!this.entered.has(identity))fail('recorded doctest has no matching entered image: '+identity);}
}

function factPath(value:ByteFact,purpose:string):string|undefined{
  if(value.null)return;
  return byteFactText(value,purpose);
}
export type InputIndexStart={kind:'index-start';version:4;mechanism:'seccomp-user-notification';outcomes:'unknown';target:RustTarget|null;observer:FileObserverReceipt|null};
export type InputIndexExecution={kind:'execution'}&Omit<Image,'args'>&{argvRaw:string};
export type InputIndexObservation={kind:'observation'}&RuntimeObservation;
export type InputIndexCounts={images:number;attempts:number;observations:number;probes:number;terminalFacts:number;inherited:number};
export type InputIndexEnd={kind:'index-complete';terminal:ObservationEnd;counts:InputIndexCounts;raw:CaptureArtifact&{path:string}};
export type InputIndexRow=InputIndexStart|InputIndexExecution|InputIndexObservation|InheritedDescriptor|{kind:'terminal-fact';fact:InputAttempt}|InputIndexEnd;
const emptyCounts=():InputIndexCounts=>({images:0,attempts:0,observations:0,probes:0,terminalFacts:0,inherited:0});

/** Versioned line records keep both publication and consumption independent of
 * the document's total size. Current task contexts and an output batch with a
 * 64 KiB flush target remain in memory; a row is bounded at 256 KiB. The
 * lossless native record stays separately retained. */
export async function publishInputTrace(options:{raw:string;output:string;cwd:string;root:string;target?:RustTarget;doctestCalls?:readonly DoctestCall[];observer?:FileObserverReceipt}):Promise<void>{
  if(!isAbsolute(options.raw))fail('raw capture path must be absolute');
  const observer=options.observer?retainedFileObserverReceipt(options.observer):null;
  if(observer&&observer.abi!==options.observer?.abi)fail('observer ABI receipt mismatch');
  const phases=new RustInputPhases(options.root,options.target,options.doctestCalls),counts=emptyCounts();
  let root:number|undefined,observerBound=false;
  await durableRecordStream(options.output,async append=>{
    let batch:string[]=[],batchBytes=0;
    const flush=async()=>{if(batchBytes){const bytes=batch.join('');batch=[];batchBytes=0;await append(bytes);}};
    const emit=async(row:InputIndexRow)=>{
      const line=JSON.stringify(row)+'\n',size=Buffer.byteLength(line);
      if(size>MAX_OBSERVATION_ROW_BYTES)fail('index row exceeds bounded row size');
      batch.push(line);batchBytes+=size;if(batchBytes>=64*1024)await flush();
    };
    await emit({kind:'index-start',version:4,mechanism:'seccomp-user-notification',outcomes:'unknown',target:options.target??null,observer});
    const capture=await readFileObservation(options.raw,async row=>{
      if(row.kind==='root-start'){root=row.root;phases.start(row.root);return;}
      if(row.kind==='inherited'){counts.inherited++;await emit(row);return;}
      if(row.kind!=='attempt')return;
      counts.attempts++;
      if(canceledLifetime(row)){counts.terminalFacts++;await emit({kind:'terminal-fact',fact:row});return;}
      const image=phases.observe(row);
      if(observer&&!observerBound&&row.tgid===root){
        if(byteFactText(row.image,'root observer image')!==observer.observedPath)fail('raw root image does not match observer receipt');
        observerBound=true;
      }
      if(image.id>counts.images){
        counts.images++;
        const {args,...context}=image;
        void args;
        await emit({kind:'execution',...context,argvRaw:row.argvRead?row.argv.hex:''});
      }
      const subjects:InputSubject[]=[],probes:InputIndexProbe[]=[];
      const probe=(probeKind:string,raw:string,error:number,fd?:number,rawPath?:string)=>{probes.push({probeKind,raw,error,...(fd===undefined?{}:{fd}),...(rawPath===undefined?{}:{rawPath})});};
      const descriptor=(fd:InputAttempt['dirfds'][number],pathArgument?:InputAttempt['paths'][number])=>{
        if(fd.target.error||fd.target.null){probe('descriptor-probe',fd.target.hex,fd.target.error,fd.fd);return;}
        const target=byteFactText(fd.target,'descriptor target');
        if(isAbsolute(target))subjects.push({kind:'descriptor',arg:fd.arg,fd:fd.fd,target,raw:fd.target.hex,...(pathArgument?{pathArgument}: {})});
        else probe('non-file-descriptor',fd.target.hex,0,fd.fd);
      };
      for(const path of row.paths){
        if(path.value.null){
          probe('null-path','',0);
          const fd=row.dirfds.find(fd=>fd.arg===path.dirfdArg);if(fd)descriptor(fd,path);
          continue;
        }
        const name=factPath(path.value,'attempted path')!;
        let anchor:InputPathAnchor;
        if(isAbsolute(name))anchor={kind:'absolute'};
        else if(path.dirfdArg<0)anchor={kind:'cwd',path:byteFactText(row.cwd,'actual cwd')};
        else{
          const fd=row.dirfds.find(fd=>fd.arg===path.dirfdArg);if(!fd)fail('missing path directory descriptor');
          if(fd.fd===-100)anchor={kind:'cwd',path:byteFactText(row.cwd,'actual cwd')};
          else{
            if(fd.fd<0){probe('invalid-dirfd',path.value.hex,fd.target.error,fd.fd);continue;}
            const target=byteFactText(fd.target,'path directory descriptor');
            if(!isAbsolute(target)){probe('non-file-dirfd',fd.target.hex,0,fd.fd,path.value.hex);continue;}
            anchor={kind:'dirfd',fd:fd.fd,path:target,raw:fd.target.hex};
          }
        }
        // Preserve spelling and its actual anchor. resolve()/join() here would
        // erase a symlink component before '..' could be interpreted by the kernel.
        subjects.push({kind:'path',arg:path.arg,dirfdArg:path.dirfdArg,name,raw:path.value.hex,anchor});
      }
      if(!row.paths.length)for(const fd of row.dirfds)descriptor(fd);
      for(const subject of subjects)readSubject(subject,byteFactText(row.cwd,'actual cwd'),row.args);
      for(const value of probes)readProbe(value);
      counts.observations+=subjects.length;counts.probes+=probes.length;
      const {id,tid,tgid,ppid,birth,parentBirth}=row;
      await emit({kind:'observation',...image.phase,attempt:{id,tid,tgid,ppid,birth,parentBirth},cwd:byteFactText(row.cwd,'actual cwd'),args:row.args,
        operation:row.operation,syscall:row.syscall,outcome:'unknown',image:image.id,canceled:row.canceled,subjects,probes});
    });
    if(observer){
      if(!observerBound)fail('raw capture has no matching observer entry');
      retainedFileObserverReceipt(observer);
    }
    phases.finish();await emit({kind:'index-complete',terminal:capture.terminal,raw:{path:options.raw,...capture.artifact},counts});await flush();
  },{gzip:true});
}

function indexObject(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))fail('malformed input index record');
  return value as Record<string,unknown>;
}
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value);
const hex=(value:unknown):value is string=>typeof value==='string'&&/^(?:[0-9a-f]{2})*$/.test(value);
const phaseValid=(row:Record<string,unknown>)=>['cargo-setup','rustdoc-setup','doctest-runtime','test-runtime'].includes(String(row.phase))
  &&(row.source===undefined||typeof row.source==='string')&&(!['doctest-runtime','test-runtime'].includes(String(row.phase))||typeof row.source==='string');
const absolute=(value:unknown):value is string=>typeof value==='string'&&isAbsolute(value)&&!value.includes('\0');
const digestValid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const position=(value:unknown)=>integer(value)&&value>=0&&value<6;
function readSubject(value:unknown,cwd:string,args:readonly string[]):InputSubject{
  const row=indexObject(value);
  const descriptor=(position:number)=>Number(BigInt.asIntN(32,BigInt('0x'+args[position]!)));
  if(!position(row.arg)||!hex(row.raw))fail('malformed input subject');
  if(row.kind==='path'){
    if(!integer(row.dirfdArg)||row.dirfdArg< -1||row.dirfdArg>5||typeof row.name!=='string'||row.name.includes('\0')
      ||Buffer.from(row.name).toString('hex')!==row.raw)fail('malformed pathname subject');
    const anchor=indexObject(row.anchor);
    if(anchor.kind==='absolute'){if(!isAbsolute(row.name))fail('relative path has an absolute anchor');}
    else{
      if(isAbsolute(row.name)||!absolute(anchor.path))fail('malformed pathname anchor');
      if(anchor.kind==='dirfd'){
        if(!integer(anchor.fd)||anchor.fd<0||!hex(anchor.raw)||Buffer.from(anchor.path).toString('hex')!==anchor.raw||row.dirfdArg<0||descriptor(row.dirfdArg)!==anchor.fd)fail('malformed directory descriptor anchor');
      }else if(anchor.kind!=='cwd'||anchor.path!==cwd||row.dirfdArg>=0&&descriptor(row.dirfdArg)!==-100)fail('pathname anchor differs from its actual attempt');
    }
  }else if(row.kind==='descriptor'){
    if(!integer(row.fd)||row.fd<0&&row.fd!==-100||!absolute(row.target)||Buffer.from(row.target).toString('hex')!==row.raw||descriptor(row.arg)!==row.fd)fail('malformed descriptor subject');
    if(row.pathArgument!==undefined){
      const path=indexObject(row.pathArgument),value=indexObject(path.value);
      if(!position(path.arg)||path.dirfdArg!==row.arg||value.hex!==''||value.error!==0||value.truncated!==false||value.null!==true)fail('malformed descriptor pathname provenance');
    }
  }else fail('unknown input subject');
  return row as InputSubject;
}
function readProbe(value:unknown):InputIndexProbe{
  const row=indexObject(value);
  if(typeof row.probeKind!=='string'||!hex(row.raw)||row.rawPath!==undefined&&!hex(row.rawPath)||!integer(row.error)||row.error<0||row.fd!==undefined&&!integer(row.fd))fail('malformed input probe');
  return row as InputIndexProbe;
}
function receiptValid(value:unknown):value is FileObserverReceipt{
  const row=indexObject(value);
  return row.version===1&&absolute(row.observedPath)&&absolute(row.artifactPath)&&digestValid(row.sha256)&&digestValid(row.sourceSha256)
    &&['linux-x86_64-v1','linux-aarch64-v1'].includes(String(row.abi));
}
/** Visits bounded attempts and returns only after raw-artifact binding, counts,
 * footer, gzip CRC and final close are checked. No partial visit is accepted.
 * A legacy normalized index must be rederived from its retained raw capture. */
export async function readInputTraceIndex(file:string,visit:(row:InputIndexRow)=>void|Promise<void>):Promise<{header:InputIndexStart;complete:InputIndexEnd}>{
  const counts=emptyCounts();let header:InputIndexStart|undefined,complete:InputIndexEnd|undefined,firstImage:InputIndexExecution|undefined;
  await readCompressedRecords(file,async value=>{
    const row=indexObject(value);
    if(complete)fail('data after input index completion');
    if(!header){
      if(row.kind!=='index-start')fail('missing input index header');
      if(row.version!==4)fail('unsupported input index version '+String(row.version)+'; rederive legacy normalized indices from raw captures');
      const target=row.target;
      if(row.mechanism!=='seccomp-user-notification'||row.outcomes!=='unknown'||target!==null&&(!target||typeof target!=='object'))fail('malformed input index header');
      if(row.observer!==null&&!receiptValid(row.observer))fail('malformed observer receipt');
      if(target!==null){
        const entry=indexObject(target);
        if(typeof entry.package!=='string'||typeof entry.name!=='string'||typeof entry.source!=='string'||!Array.isArray(entry.kind)||entry.kind.some(part=>typeof part!=='string'))fail('malformed input index target');
      }
      header=row as InputIndexStart;
    }else if(row.kind==='execution'){
      if(!integer(row.id)||row.id!==counts.images+1||!integer(row.parent)||row.parent<0||row.parent>=row.id
        ||!integer(row.pid)||row.pid<1||typeof row.birth!=='string'||!/^\d+$/.test(row.birth)||!absolute(row.path)
        ||!absolute(row.cwd)||!hex(row.argvRaw)||!phaseValid(indexObject(row.phase))
        ||!['first-observation','actual-image','actual-argv','actual-cwd'].includes(String(row.reason)))fail('malformed input index execution');
      firstImage??=row as InputIndexExecution;counts.images++;
    }else if(row.kind==='observation'){
      if(!integer(row.image)||row.image<1||row.image>counts.images||!phaseValid(row)||!absolute(row.cwd)
        ||typeof row.operation!=='string'||typeof row.syscall!=='string'||row.outcome!=='unknown'||typeof row.canceled!=='boolean'
        ||!Array.isArray(row.args)||row.args.length!==6||row.args.some(value=>typeof value!=='string'||!/^[0-9a-f]{1,16}$/.test(value))
        ||!Array.isArray(row.subjects)||!Array.isArray(row.probes))fail('malformed attributed input attempt');
      const attempt=indexObject(row.attempt);
      if(typeof attempt.id!=='string'||!/^\d{1,20}$/.test(attempt.id)||['tid','tgid','ppid'].some(field=>!integer(attempt[field]))
        ||!integer(attempt.tid)||attempt.tid<1||!integer(attempt.tgid)||attempt.tgid<1||!integer(attempt.ppid)||attempt.ppid<0
        ||typeof attempt.birth!=='string'||!/^\d+$/.test(attempt.birth)||attempt.birth==='0'||typeof attempt.parentBirth!=='string'||!/^\d+$/.test(attempt.parentBirth))fail('malformed raw attempt identity');
      for(const value of row.subjects)readSubject(value,row.cwd,row.args);
      for(const value of row.probes)readProbe(value);
      counts.attempts++;counts.observations+=row.subjects.length;counts.probes+=row.probes.length;
    }else if(row.kind==='inherited'){
      if(readObservationRow(row).kind!=='inherited')fail('malformed inherited input index record');counts.inherited++;
    }else if(row.kind==='terminal-fact'){
      const fact=readObservationRow(row.fact);
      if(fact.kind!=='attempt'||!canceledLifetime(fact))fail('terminal fact contains a filesystem candidate');counts.terminalFacts++;counts.attempts++;
    }else if(row.kind==='index-complete'){
      const terminal=readObservationRow(row.terminal),reported=indexObject(row.counts),raw=indexObject(row.raw);
      if(terminal.kind!=='complete'||!terminal.complete||!terminal.drainComplete||terminal.errors||terminal.attempts!==counts.attempts||counts.images>counts.attempts)fail('incomplete native input index');
      if(!absolute(raw.path)||!digestValid(raw.sha256)||!integer(raw.bytes)||raw.bytes<1)fail('missing raw capture artifact binding');
      if(header.observer&&(!firstImage||firstImage.pid!==terminal.root||firstImage.path!==header.observer.observedPath))fail('observer receipt has no matching raw root image');
      for(const field of Object.keys(counts) as (keyof InputIndexCounts)[])if(reported[field]!==counts[field])fail('input index count mismatch: '+field);
      complete=row as InputIndexEnd;
    }else fail('unexpected input index record '+String(row.kind));
    await visit(row as InputIndexRow);
  });
  if(!header||!complete)fail('incomplete input index');
  return {header,complete};
}

export const readTestArtifactTargets=(path:string,root:string)=>testArtifactTargets(JSON.parse(readFileSync(path,'utf8')) as unknown,root);

runAsCommand(import.meta.url,()=>{
  if(process.argv[2]!=='--record-doctest-call')fail('usage: rust-test-inputs.ts --record-doctest-call <directory> <observer> <pid> <command...>');
  const [directory,observer,pid,...argv]=process.argv.slice(3);
  if(!directory||!observer||!pid)fail('incomplete doctest recorder arguments');
  recordDoctestCall(directory,observer,Number(pid),argv,process.env);
});
