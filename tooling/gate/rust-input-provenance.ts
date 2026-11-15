// Classification uses authenticated capture facts only. It never resolves a
// historical pathname against today's filesystem or treats a write as success.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import type {CaptureArtifact} from './file-input-observer.ts';
import type {InputSubject} from './rust-test-inputs.ts';
import type {InputRequirement} from './rust-input-operations.ts';
import type {TestScratchReceipt} from './test-scratch.ts';

export type CapturedPathResolution={state:'unavailable';error:number}|{state:'resolved'|'missing'|'not-directory';path:string;finalLink?:boolean;
  namespace?:{dev:string;ino:string;rootDev:string;rootIno:string};
  components:{path:string;kind:'directory'|'file'|'symlink'|'other'|'missing';dev:string;ino:string;link?:string}[]};
export type FreshRootReceipt=TestScratchReceipt;
export type RuntimeProvenanceFacts={sourceRoot:string;buildNamespace?:string;artifacts:string[];
  outputDirectories:{package:string;path:string}[];roots:FreshRootReceipt[];window?:{start:number;end:number}};
export type RuntimeProvenanceClass={kind:'owned-output';path:string;root:FreshRootReceipt}
  |{kind:'cargo-artifact';path:string}|{kind:'build-script-output';path:string;package:string;directory:string}
  |{kind:'host-environment';path:string;basis:'captured-descriptor'|'captured-components'};
const inside=(root:string,path:string)=>{const part=relative(root,path);return !isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep);};
const canonical=(path:unknown):path is string=>typeof path==='string'&&isAbsolute(path)&&resolve(path)===path;
function fail(why:string):never{throw Error('Rust input provenance: '+why);}

/** The selected manifest binds this receipt's bytes. Version 1 has exact
 * emitted filenames, but lacks a namespace and OUT_DIR facts: do not infer them. */
export function readRustBuildProvenance(reference:CaptureArtifact&{path:string}):Pick<RuntimeProvenanceFacts,'artifacts'|'outputDirectories'|'buildNamespace'>{
  const bytes=readFileSync(reference.path);
  if(bytes.length!==reference.bytes||createHash('sha256').update(bytes).digest('hex')!==reference.sha256)fail('Cargo receipt differs from manifest SHA/length');
  const value=JSON.parse(bytes.toString('utf8')) as {version:number;status:number;buildFinished:boolean;artifacts:unknown[];buildNamespace?:string;buildScripts?:unknown[]};
  if(value.version!==1&&value.version!==2||value.status!==0||value.buildFinished!==true||!Array.isArray(value.artifacts))fail('incomplete Cargo receipt');
  if(value.version===2&&(!canonical(value.buildNamespace)||!Array.isArray(value.buildScripts)))fail('missing Cargo build namespace or build-script messages');
  const artifacts=new Set<string>(),outputDirectories:RuntimeProvenanceFacts['outputDirectories']=[];
  for(const item of value.artifacts){
    const row=item as {reason?:unknown;filenames?:unknown;executable?:unknown};
    if(row.reason!=='compiler-artifact'||!Array.isArray(row.filenames)||!row.filenames.every(canonical))fail('malformed emitted filenames');
    for(const path of [...row.filenames,...(typeof row.executable==='string'?[row.executable]:[])]){
      if(!canonical(path)||value.buildNamespace&&!inside(value.buildNamespace,path))fail('artifact outside Cargo build namespace');
      artifacts.add(path);
    }
  }
  if(value.version===2)for(const item of value.buildScripts!){
    const row=item as {reason?:unknown;package_id?:unknown;out_dir?:unknown};
    if(row.reason!=='build-script-executed'||typeof row.package_id!=='string'||!canonical(row.out_dir)||!inside(value.buildNamespace!,row.out_dir))fail('malformed build-script OUT_DIR');
    outputDirectories.push({package:row.package_id,path:row.out_dir});
  }
  return {artifacts:[...artifacts],outputDirectories,...(value.version===2?{buildNamespace:value.buildNamespace!}:{})};
}

/** Unknown ABI requests cannot gain authority from their pathname. Component
 * facts describe resolution at the attempt, not the attempted operation's result. */
export function runtimeProvenanceClassifier(facts:RuntimeProvenanceFacts){
  if(!canonical(facts.sourceRoot)||facts.buildNamespace!==undefined&&!canonical(facts.buildNamespace))fail('noncanonical boundary');
  const artifacts=new Set(facts.artifacts);
  const roots=facts.roots.map(root=>{
    if(!canonical(root.path)||!/^\d+$/.test(root.dev)||!/^\d+$/.test(root.ino)||!/^\d+$/.test(root.uid)||root.empty!==true
      ||!facts.window||!Number.isFinite(root.createdAt)||root.createdAt<facts.window.start||root.createdAt>facts.window.end
      ||inside(facts.sourceRoot,root.path))fail('fresh root is not bound to the run window outside source');
    return structuredClone(root);
  });
  return {classify(subject:InputSubject,requirement:InputRequirement):RuntimeProvenanceClass|undefined{
    if(requirement.kind==='unknown'||requirement.kind==='literal')return;
    const resolution=subject.kind==='path'?subject.resolution:undefined;
    if(resolution?.state==='unavailable'||resolution?.finalLink&&requirement.following==='no-follow')return;
    const path=subject.kind==='descriptor'?subject.target:resolution?.path;
    if(!canonical(path))return;
    const components=resolution?.components??[];
    // A source alias is independently commit-changeable even if it reaches
    // an output or host file. Its presence cannot be discharged with the endpoint.
    if(components.some(row=>row.kind==='symlink'&&inside(facts.sourceRoot,row.path)))return;
    for(const root of roots)if(inside(root.path,path))return {kind:'owned-output',path,root:structuredClone(root)};
    if(artifacts.has(path))return {kind:'cargo-artifact',path};
    for(const directory of facts.outputDirectories)if(inside(directory.path,path))
      return {kind:'build-script-output',path,package:directory.package,directory:directory.path};
    if(facts.buildNamespace&&!inside(facts.sourceRoot,path)&&!inside(facts.buildNamespace,path)
      &&components.every(row=>!inside(facts.sourceRoot,row.path)&&!inside(facts.buildNamespace!,row.path)))
      return {kind:'host-environment',path,basis:subject.kind==='descriptor'?'captured-descriptor':'captured-components'};
    return undefined;
  }};
}
