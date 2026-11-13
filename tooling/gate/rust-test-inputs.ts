// Cargo, rather than executable filename conventions, binds a trace to its
// target source. Declarations and the selector use that same source identity.
import {readFileSync} from 'node:fs';
import {basename,isAbsolute,relative,resolve,sep} from 'node:path';
import {durableRecord} from './durable-record.ts';
import {readInputTrace,type FileObservation,type TraceResult} from './rust-input-trace.ts';

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
/** Setup is retained, not counted as a harness read. Rustdoc's own reads and
 * compiler descendants are distinct from the program it starts for a test. */
export function tracePhases(trace:TraceResult,root:string,target?:RustTarget):Map<number,TracePhase>{
  const phases=new Map<number,TracePhase>([[0,target?{phase:'test-runtime',source:target.source}:{phase:'cargo-setup'}]]);
  const images=new Map(trace.executions.map(row=>[row.id,row]));
  for(const image of trace.executions){
    const inherited=phases.get(image.parent);if(!inherited)fail('missing executable parent '+image.parent);
    let phase={...inherited};
    if(!target&&basename(image.path)==='rustdoc'&&image.args.includes('--test')){
      const sources=image.args.filter(arg=>arg.endsWith('.rs')).map(arg=>resolve(image.cwd,arg)).filter(path=>inside(root,path));
      if(sources.length!==1)fail('rustdoc has no unique source entry: '+image.path);
      phase={phase:'rustdoc-setup',source:relative(root,sources[0]!).split(sep).join('/')};
    }else if(inherited.phase==='rustdoc-setup'&&basename(images.get(image.parent)?.path??'')==='rustdoc'
      &&!['rustc','rustdoc'].includes(basename(image.path)))phase={phase:'doctest-runtime',source:inherited.source};
    phases.set(image.id,phase);
  }
  return phases;
}

export async function publishInputTrace(options:{raw:string;output:string;cwd:string;root:string;target?:RustTarget}):Promise<void>{
  const trace=await readInputTrace(options.raw,options.cwd),phases=tracePhases(trace,options.root,options.target);
  const observed=trace.observations.map(row=>{
    const phase=phases.get(row.image);if(!phase)fail('observation has no executable image: '+row.image);
    return {...row,...phase};
  });
  durableRecord(options.output,{version:1,target:options.target??null,executions:trace.executions,observations:observed});
}

export const readTestArtifactTargets=(path:string,root:string)=>testArtifactTargets(JSON.parse(readFileSync(path,'utf8')) as unknown,root);
export type RuntimeObservation=FileObservation&TracePhase;
