// Classification uses authenticated capture facts only. It never resolves a
// historical pathname against today's filesystem or treats a write as success.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isAbsolute,relative,sep} from 'node:path';
import type {CaptureArtifact} from './file-input-observer.ts';
import type {InputSubject} from './rust-test-inputs.ts';
import type {InputRequirement} from './rust-input-operations.ts';
import type {TestScratchReceipt} from './test-scratch.ts';
import type {InputSnapshot} from './module-closure.ts';
import {projectDependencies,type InstalledProjectDependency} from './project-dependencies.ts';
import {canonicalCapturedPath,capturedPathBoundary,type CapturedBoundaryFactory} from './captured-path.ts';

export type CapturedPathResolution={state:'unavailable';error:number}|{state:'resolved'|'missing'|'not-directory';path:string;finalLink?:boolean;
  namespace?:{dev:string;ino:string;rootDev:string;rootIno:string};
  components:{path:string;kind:'directory'|'file'|'symlink'|'other'|'missing';dev:string;ino:string;link?:string}[]};
export type FreshRootReceipt=TestScratchReceipt;
export type RuntimeProvenanceFacts={sourceRoot:string;buildNamespace?:string;artifacts:string[];
  outputDirectories:{package:string;path:string}[];roots:FreshRootReceipt[];window?:{start:number;end:number}};
export type RuntimeProvenanceClass={kind:'owned-output';path:string;root:FreshRootReceipt}
  |{kind:'cargo-artifact';path:string}|{kind:'build-script-output';path:string;package:string;directory:string}
  |{kind:'build-namespace';path:string;namespace:string}
  |{kind:'host-environment';path:string;basis:'captured-descriptor'|'captured-components'};
const inside=(root:string,path:string)=>{const part=relative(root,path);return !isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep);};
const canonical=canonicalCapturedPath;
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
export function runtimeProvenanceClassifier(facts:RuntimeProvenanceFacts,options:{boundary?:CapturedBoundaryFactory}={}){
  if(!canonical(facts.sourceRoot)||facts.buildNamespace!==undefined&&!canonical(facts.buildNamespace))fail('noncanonical boundary');
  const boundary=options.boundary??capturedPathBoundary,source=boundary(facts.sourceRoot),build=facts.buildNamespace===undefined?undefined:boundary(facts.buildNamespace);
  const artifacts=new Set(facts.artifacts);
  const outputDirectories=facts.outputDirectories.map(row=>({...row,contains:boundary(row.path)}));
  const roots=facts.roots.map(root=>{
    if(!canonical(root.path)||!/^\d+$/.test(root.dev)||!/^\d+$/.test(root.ino)||!/^\d+$/.test(root.uid)||root.empty!==true
      ||!facts.window||!Number.isFinite(root.createdAt)||root.createdAt<facts.window.start||root.createdAt>facts.window.end
      ||source(root.path))fail('fresh root is not bound to the run window outside source');
    return {receipt:structuredClone(root),contains:boundary(root.path)};
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
    if(components.some(row=>row.kind==='symlink'&&source(row.path)))return;
    for(const root of roots)if(root.contains(path))return {kind:'owned-output',path,root:structuredClone(root.receipt)};
    if(artifacts.has(path))return {kind:'cargo-artifact',path};
    for(const directory of outputDirectories)if(directory.contains(path))
      return {kind:'build-script-output',path,package:directory.package,directory:directory.path};
    if(facts.buildNamespace&&build?.(path))
      return {kind:'build-namespace',path,namespace:facts.buildNamespace};
    if(build&&!source(path)&&!build(path)
      &&components.every(row=>!source(row.path)&&!build(row.path)))
      return {kind:'host-environment',path,basis:subject.kind==='descriptor'?'captured-descriptor':'captured-components'};
    return undefined;
  }};
}

/** The caller validates this target's graph observations before matching.
 * Package identity and bytes come from that graph's authenticated catalog;
 * only its exact file facts qualify, never an installed-directory prefix. */
export function runtimeInstalledInputClassifier(root:string,snapshot:InputSnapshot){
  const files=new Map<string,InstalledProjectDependency>(),links=new Map<string,string|null>();
  const catalogs=new Map<string,ReturnType<typeof projectDependencies>>();
  for(const row of snapshot.observations){
    if(!row.dependency||row.context.entry!=='<entry>'||row.protocol!=='project'||row.dependency.source!==root)continue;
    const {observation,dependency}=row;
    if(observation.kind==='file'&&typeof observation.value==='string'&&dependency.package)
      files.set(observation.path,structuredClone(dependency));
    if(observation.kind==='readlink'&&(typeof observation.value==='string'||observation.value===null))links.set(observation.path,observation.value);
  }
  return {classify(subject:InputSubject,requirement:InputRequirement):{kind:'installed-dependency';path:string;dependency:InstalledProjectDependency}|undefined{
    if(requirement.kind!=='content'&&requirement.kind!=='metadata')return;
    const proof=subject.kind==='path'?subject.resolution:undefined;
    const resolved=proof?.state==='resolved'?proof:undefined;
    if(subject.kind==='path'&&(!resolved||resolved.finalLink&&requirement.following==='no-follow'))return;
    const path=subject.kind==='descriptor'?subject.target:resolved?.path;
    if(!path)return;
    const dependency=files.get(path);if(!dependency)return;
    for(const part of resolved?.components??[])if(part.kind==='symlink'&&inside(root,part.path)&&(part.link===undefined||links.get(part.path)!==part.link)){
      if(part.link===undefined)return;
      const key=JSON.stringify(dependency.catalog);
      let catalog=catalogs.get(key);if(!catalog){catalog=projectDependencies(root,dependency.catalog);catalogs.set(key,catalog);}
      if(catalog.state!=='current')throw Error('runtime installed dependency catalog is pending: '+catalog.reason);
      if(!catalog.match({kind:'readlink',path:part.path,value:part.link}))return;
    }
    return {kind:'installed-dependency',path,dependency:structuredClone(dependency)};
  }};
}
