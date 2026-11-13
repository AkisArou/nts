// Cargo, rather than executable filename conventions, binds a trace to its
// target source. Declarations and the selector use that same source identity.
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {basename,isAbsolute,relative,resolve,sep} from 'node:path';
import {durableRecord,durableRecordStream} from './durable-record.ts';
import {byteFactText,canceledLifetime,fileObserverBirth,MAX_OBSERVATION_ROW_BYTES,readCompressedRecords,readFileObservation,readObservationRow,type ByteFact,type InputAttempt,type InheritedDescriptor,type ObservationEnd} from './file-input-observer.ts';

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
type Image={id:number;parent:number;pid:number;birth:string;path:string;cwd:string;args:string[];phase:TracePhase;reason:'first-observation'|'actual-image'|'actual-argv'};
export type RuntimeObservation=TracePhase&{path:string;rawPath:string;operation:string;syscall:string;outcome:'unknown';image:number;count:number;canceled:boolean};
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
    if(previous?.path===path&&this.argvFacts.get(identity)===actualArgv)return previous;
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
      reason:!previous?'first-observation':previous.path===path?'actual-argv':'actual-image'};
    this.tasks.set(identity,image);this.argvFacts.set(identity,actualArgv);return image;
  }
  finish():void{for(const identity of this.calls.keys())if(!this.entered.has(identity))fail('recorded doctest has no matching entered image: '+identity);}
}

function factPath(value:ByteFact,purpose:string):string|undefined{
  if(value.null)return;
  return byteFactText(value,purpose);
}
export type InputIndexStart={kind:'index-start';version:3;mechanism:'seccomp-user-notification';outcomes:'unknown';target:RustTarget|null};
export type InputIndexExecution={kind:'execution'}&Omit<Image,'args'>&{argvRaw:string};
export type InputIndexObservation={kind:'observation'}&RuntimeObservation;
export type InputIndexProbe={kind:'probe';probeKind:string;image:number;fd?:number;raw:string;rawPath?:string;error:number;count:1}&TracePhase;
export type InputIndexCounts={images:number;observations:number;probes:number;terminalFacts:number;inherited:number};
export type InputIndexEnd={kind:'index-complete';terminal:ObservationEnd;counts:InputIndexCounts};
export type InputIndexRow=InputIndexStart|InputIndexExecution|InputIndexObservation|InputIndexProbe|InheritedDescriptor|{kind:'terminal-fact';fact:InputAttempt}|InputIndexEnd;
const emptyCounts=():InputIndexCounts=>({images:0,observations:0,probes:0,terminalFacts:0,inherited:0});

/** Versioned line records keep both publication and consumption independent of
 * the document's total size. Current task contexts and an output batch with a
 * 64 KiB flush target remain in memory; a row is bounded at 256 KiB. The
 * lossless native record stays separately retained. */
export async function publishInputTrace(options:{raw:string;output:string;cwd:string;root:string;target?:RustTarget;doctestCalls?:readonly DoctestCall[]}):Promise<void>{
  const phases=new RustInputPhases(options.root,options.target,options.doctestCalls),counts=emptyCounts();
  await durableRecordStream(options.output,async append=>{
    let batch:string[]=[],batchBytes=0;
    const flush=async()=>{if(batchBytes){const bytes=batch.join('');batch=[];batchBytes=0;await append(bytes);}};
    const emit=async(row:InputIndexRow)=>{
      const line=JSON.stringify(row)+'\n',size=Buffer.byteLength(line);
      if(size>MAX_OBSERVATION_ROW_BYTES)fail('index row exceeds bounded row size');
      batch.push(line);batchBytes+=size;if(batchBytes>=64*1024)await flush();
    };
    await emit({kind:'index-start',version:3,mechanism:'seccomp-user-notification',outcomes:'unknown',target:options.target??null});
    const retain=async(row:InputAttempt,image:Image,path:string,rawPath:string,operation:string)=>{
      counts.observations++;
      await emit({kind:'observation',...image.phase,path,rawPath,operation,syscall:row.syscall,outcome:'unknown',image:image.id,count:1,canceled:row.canceled});
    };
    const probe=async(image:Image,probeKind:string,raw:string,error:number,fd?:number,rawPath?:string)=>{
      counts.probes++;await emit({kind:'probe',...image.phase,image:image.id,probeKind,raw,error,fd,rawPath,count:1});
    };
    const terminal=await readFileObservation(options.raw,async row=>{
      if(row.kind==='root-start'){phases.start(row.root);return;}
      if(row.kind==='inherited'){counts.inherited++;await emit(row);return;}
      if(row.kind!=='attempt')return;
      if(canceledLifetime(row)){counts.terminalFacts++;await emit({kind:'terminal-fact',fact:row});return;}
      const image=phases.observe(row);
      if(image.id>counts.images){
        counts.images++;
        const {args,...context}=image;
        void args;
        await emit({kind:'execution',...context,argvRaw:row.argvRead?row.argv.hex:''});
      }
      for(const path of row.paths){
        if(path.value.null){
          await probe(image,'null-path','',0);
          const descriptor=row.dirfds.find(fd=>fd.arg===path.dirfdArg);
          if(descriptor&&!descriptor.target.error&&!descriptor.target.null){
            const target=byteFactText(descriptor.target,'null-path descriptor');
            if(isAbsolute(target))await retain(row,image,target,descriptor.target.hex,'descriptor');
            else await probe(image,'non-file-descriptor',descriptor.target.hex,0,descriptor.fd);
          }
          continue;
        }
        const named=factPath(path.value,'attempted path')!;
        let resolved:string;
        if(isAbsolute(named))resolved=resolve(named);
        else if(path.dirfdArg<0)resolved=resolve(byteFactText(row.cwd,'cwd'),named);
        else{
          const descriptor=row.dirfds.find(fd=>fd.arg===path.dirfdArg);if(!descriptor)fail('missing path directory descriptor');
          if(descriptor.fd<0&&descriptor.fd!==-100){await probe(image,'invalid-dirfd',path.value.hex,descriptor.target.error,descriptor.fd);continue;}
          const target=byteFactText(descriptor.target,'path directory descriptor');
          if(!isAbsolute(target)){await probe(image,'non-file-dirfd',descriptor.target.hex,0,descriptor.fd,path.value.hex);continue;}
          resolved=resolve(target,named);
        }
        await retain(row,image,resolved,path.value.hex,row.operation);
      }
      if(!row.paths.length&&row.dirfds.length){
        for(const fd of row.dirfds){
          if(fd.target.error||fd.target.null){await probe(image,'descriptor-probe',fd.target.hex,fd.target.error,fd.fd);continue;}
          const target=byteFactText(fd.target,'descriptor target');
          if(isAbsolute(target))await retain(row,image,target,fd.target.hex,row.operation);
          else await probe(image,'non-file-descriptor',fd.target.hex,0,fd.fd);
        }
      }
    });
    phases.finish();await emit({kind:'index-complete',terminal,counts});await flush();
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
/** Visits bounded records and returns only after the footer, counts, gzip CRC
 * and final close are checked. Callers must not accept a partial visit. */
export async function readInputTraceIndex(file:string,visit:(row:InputIndexRow)=>void|Promise<void>):Promise<{header:InputIndexStart;complete:InputIndexEnd}>{
  const counts=emptyCounts();let header:InputIndexStart|undefined,complete:InputIndexEnd|undefined;
  await readCompressedRecords(file,async value=>{
    const row=indexObject(value);
    if(complete)fail('data after input index completion');
    if(!header){
      if(row.kind!=='index-start')fail('missing input index header');
      if(row.version!==3)fail('unsupported input index version '+String(row.version));
      const target=row.target;
      if(row.mechanism!=='seccomp-user-notification'||row.outcomes!=='unknown'||target!==null&&(!target||typeof target!=='object'))fail('malformed input index header');
      if(target!==null){
        const entry=indexObject(target);
        if(typeof entry.package!=='string'||typeof entry.name!=='string'||typeof entry.source!=='string'||!Array.isArray(entry.kind)||entry.kind.some(part=>typeof part!=='string'))fail('malformed input index target');
      }
      header=row as InputIndexStart;
    }else if(row.kind==='execution'){
      if(!integer(row.id)||row.id!==counts.images+1||!integer(row.parent)||row.parent<0||row.parent>=row.id
        ||!integer(row.pid)||row.pid<1||typeof row.birth!=='string'||!/^\d+$/.test(row.birth)||typeof row.path!=='string'||!isAbsolute(row.path)
        ||typeof row.cwd!=='string'||!isAbsolute(row.cwd)||!hex(row.argvRaw)||!phaseValid(indexObject(row.phase))
        ||!['first-observation','actual-image','actual-argv'].includes(String(row.reason)))fail('malformed input index execution');
      counts.images++;
    }else if(row.kind==='observation'||row.kind==='probe'){
      if(!integer(row.image)||row.image<1||row.image>counts.images||row.count!==1||!phaseValid(row))fail('malformed attributed input index record');
      if(row.kind==='observation'){
        if(typeof row.path!=='string'||!isAbsolute(row.path)||!hex(row.rawPath)||typeof row.operation!=='string'||typeof row.syscall!=='string'||row.outcome!=='unknown'||typeof row.canceled!=='boolean')fail('malformed input observation');
        counts.observations++;
      }else{
        if(typeof row.probeKind!=='string'||!hex(row.raw)||row.rawPath!==undefined&&!hex(row.rawPath)||!integer(row.error)||row.error<0||row.fd!==undefined&&!integer(row.fd))fail('malformed input probe');
        counts.probes++;
      }
    }else if(row.kind==='inherited'){
      if(readObservationRow(row).kind!=='inherited')fail('malformed inherited input index record');counts.inherited++;
    }else if(row.kind==='terminal-fact'){
      const fact=readObservationRow(row.fact);
      if(fact.kind!=='attempt'||!canceledLifetime(fact))fail('terminal fact contains a filesystem candidate');counts.terminalFacts++;
    }else if(row.kind==='index-complete'){
      const terminal=readObservationRow(row.terminal),reported=indexObject(row.counts);
      if(terminal.kind!=='complete'||!terminal.complete||!terminal.drainComplete||terminal.errors)fail('incomplete native input index');
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
