// Cargo, rather than executable filename conventions, binds a trace to its
// target source. Declarations and the selector use that same source identity.
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {basename,isAbsolute,relative,resolve,sep} from 'node:path';
import {durableRecord} from './durable-record.ts';
import {byteFactText,canceledLifetime,fileObserverBirth,readFileObservation,type ByteFact,type InputAttempt,type ObservationRow} from './file-input-observer.ts';

export type RustTarget={package:string;name:string;kind:string[];source:string};
const inside=(root:string,path:string)=>{const part=relative(root,path);return !isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep);};
function fail(message:string):never{throw Error('Rust test inputs: '+message);}

export function testArtifactTargets(value:unknown,root:string):Map<string,RustTarget>{
  if(!value||typeof value!=='object')fail('missing Cargo artifact evidence');
  const evidence=value as {version?:unknown;status?:unknown;buildFinished?:unknown;artifacts?:unknown};
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
  readonly images:Image[]=[];
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
    const image:Image={id:this.images.length+1,parent:previous?.id??parent?.id??0,pid:row.tgid,birth:row.birth,path,cwd,args,phase,
      reason:!previous?'first-observation':previous.path===path?'actual-argv':'actual-image'};
    this.images.push(image);this.tasks.set(identity,image);this.argvFacts.set(identity,actualArgv);return image;
  }
  finish():void{for(const identity of this.calls.keys())if(!this.entered.has(identity))fail('recorded doctest has no matching entered image: '+identity);}
}

function factPath(value:ByteFact,purpose:string):string|undefined{
  if(value.null)return;
  return byteFactText(value,purpose);
}
export async function publishInputTrace(options:{raw:string;output:string;cwd:string;root:string;target?:RustTarget;doctestCalls?:readonly DoctestCall[]}):Promise<void>{
  const phases=new RustInputPhases(options.root,options.target,options.doctestCalls);
  const observations=new Map<string,RuntimeObservation>();
  const probes=new Map<string,TracePhase&{image:number;kind:string;fd?:number;raw:string;rawPath?:string;error:number;count:number}>();
  const descriptors:ObservationRow[]=[];
  const terminalFacts:InputAttempt[]=[];
  const retain=(row:InputAttempt,image:Image,path:string,rawPath:string,operation:string)=>{
    const identity=JSON.stringify([image.id,operation,row.syscall,path,row.canceled]);
    const previous=observations.get(identity);
    if(previous){previous.count++;return;}
    observations.set(identity,{...image.phase,path,rawPath,operation,syscall:row.syscall,outcome:'unknown',image:image.id,count:1,canceled:row.canceled});
  };
  const probe=(image:Image,kind:string,raw:string,error:number,fd?:number,rawPath?:string)=>{
    const identity=JSON.stringify([image.id,kind,raw,error,fd,rawPath]),previous=probes.get(identity);
    if(previous)previous.count++;else probes.set(identity,{...image.phase,image:image.id,kind,raw,error,fd,rawPath,count:1});
  };
  const terminal=await readFileObservation(options.raw,row=>{
    if(row.kind==='root-start'){phases.start(row.root);return;}
    if(row.kind==='inherited'){descriptors.push(row);return;}
    if(row.kind!=='attempt')return;
    if(canceledLifetime(row)){terminalFacts.push(row);return;}
    const image=phases.observe(row);
    for(const path of row.paths){
      if(path.value.null){
        probe(image,'null-path','',0);
        // NULL is accepted with AT_EMPTY_PATH by current statx kernels. Keep
        // its actual descriptor candidate without claiming syscall success.
        const descriptor=row.dirfds.find(fd=>fd.arg===path.dirfdArg);
        if(descriptor&&!descriptor.target.error&&!descriptor.target.null){
          const target=byteFactText(descriptor.target,'null-path descriptor');
          if(isAbsolute(target))retain(row,image,target,descriptor.target.hex,'descriptor');
          else probe(image,'non-file-descriptor',descriptor.target.hex,0,descriptor.fd);
        }
        continue;
      }
      const named=factPath(path.value,'attempted path')!;
      let resolved:string;
      if(isAbsolute(named))resolved=resolve(named);
      else if(path.dirfdArg<0)resolved=resolve(byteFactText(row.cwd,'cwd'),named);
      else{
        const descriptor=row.dirfds.find(fd=>fd.arg===path.dirfdArg);if(!descriptor)fail('missing path directory descriptor');
        if(descriptor.fd<0&&descriptor.fd!==-100){probe(image,'invalid-dirfd',path.value.hex,descriptor.target.error,descriptor.fd);continue;}
        const target=byteFactText(descriptor.target,'path directory descriptor');
        if(!isAbsolute(target)){probe(image,'non-file-dirfd',descriptor.target.hex,0,descriptor.fd,path.value.hex);continue;}
        resolved=resolve(target,named);
      }
      retain(row,image,resolved,path.value.hex,row.operation);
    }
    if(!row.paths.length&&row.dirfds.length){
      for(const fd of row.dirfds){
        if(fd.target.error||fd.target.null){probe(image,'descriptor-probe',fd.target.hex,fd.target.error,fd.fd);continue;}
        const target=byteFactText(fd.target,'descriptor target');
        if(isAbsolute(target))retain(row,image,target,fd.target.hex,row.operation);
        else probe(image,'non-file-descriptor',fd.target.hex,0,fd.fd);
      }
    }
  });
  phases.finish();
  durableRecord(options.output,{version:2,mechanism:'seccomp-user-notification',outcomes:'unknown',target:options.target??null,
    terminal,terminalFacts,executions:phases.images,inheritedDescriptors:descriptors,descriptorProbes:[...probes.values()],observations:[...observations.values()]});
}
export const readTestArtifactTargets=(path:string,root:string)=>testArtifactTargets(JSON.parse(readFileSync(path,'utf8')) as unknown,root);

runAsCommand(import.meta.url,()=>{
  if(process.argv[2]!=='--record-doctest-call')fail('usage: rust-test-inputs.ts --record-doctest-call <directory> <observer> <pid> <command...>');
  const [directory,observer,pid,...argv]=process.argv.slice(3);
  if(!directory||!observer||!pid)fail('incomplete doctest recorder arguments');
  recordDoctestCall(directory,observer,Number(pid),argv,process.env);
});
