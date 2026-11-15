// A replay retains the build product and the loader inputs it actually used.
// These are finite execution facts, never authority for a target/ namespace.
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {basename,dirname,isAbsolute,resolve} from 'node:path';
import {fingerprint,loaderSearch,captureRustLoader,type Executable,type Loader} from './rust-loader.ts';
export {loaderSearch} from './rust-loader.ts';
import {testArtifactTargets,type RustTarget,type InputIndexExecution,type RuntimeObservation} from './rust-test-inputs.ts';
import type {CaptureArtifact} from './file-input-observer.ts';
import type {RuntimeSubjectAssessment} from './rust-input-validation.ts';
import {verifyTestScratchRoot,type TestScratchReceipt} from './test-scratch.ts';
import {hostObservations} from './host-observations.ts';
import {readRustBuildProvenance,runtimeProvenanceClassifier} from './rust-input-provenance.ts';
import {capturedPathBoundary} from './captured-path.ts';

type Provenance={sourceRoot:string;sourceIdentity:{dev:string;ino:string};window:{start:number;end:number};roots:TestScratchReceipt[]};
export type RustTestExecution={version:1|2;target:RustTarget;executable:Executable;cwd:string;argv:string[];loader:Loader;
  cargo:CaptureArtifact&{path?:string};raw:CaptureArtifact&{path:string};pid:number;provenance?:Provenance};
function fail(why:string):never{throw Error('Rust test execution: '+why);}
const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** Called before spawn with the exact replay environment, after Cargo's
 * profile owner has published the emitted artifact inventory. */
export function prepareRustTestExecution(options:{artifacts:string;root:string;cwd:string;argv:string[];env:NodeJS.ProcessEnv;roots?:TestScratchReceipt[];runStart?:number}){
  const {artifacts,root,cwd,argv,env}=options;
  if(!isAbsolute(cwd)||!argv[0])fail('missing replay command');
  const cargoBytes=readFileSync(artifacts),target=testArtifactTargets(JSON.parse(cargoBytes.toString('utf8')),root).get(argv[0]);
  if(!target)fail('replay executable was not emitted by Cargo: '+argv[0]);
  const executable=fingerprint(argv[0]);
  const sourceRoot=realpathSync(root),sourceIdentity=lstatSync(sourceRoot,{bigint:true});
  const start=options.runStart??hostObservations().wallNow(),roots=structuredClone(options.roots??[]);
  for(const receipt of roots)verifyTestScratchRoot(receipt);
  if(executable.path!==executable.physical)fail('Cargo artifact path is aliased: '+argv[0]);
  const loader=captureRustLoader(argv[0],cwd,env),loaderPath=loader.executable.path,loaderExecutable=loader.executable;
  if(!same(executable,fingerprint(executable.path)))fail('executable changed during loader capture');
  const context={version:2 as const,target,executable,cwd,argv:[...argv],loader,cargo:{path:artifacts,sha256:sha(cargoBytes),bytes:cargoBytes.length}};
  readRustBuildProvenance(context.cargo);
  return {finish(raw:RustTestExecution['raw'],pid:number):RustTestExecution{
    if(!Number.isSafeInteger(pid)||pid<1)fail('missing observed root PID');
    if(!same(executable,fingerprint(executable.path))||!same(loaderExecutable,fingerprint(loaderPath)))fail('executable changed during replay');
    if(sha(readFileSync(artifacts))!==context.cargo.sha256)fail('Cargo artifact inventory changed during replay');
    for(const receipt of roots)verifyTestScratchRoot(receipt);
    const after=lstatSync(sourceRoot,{bigint:true});if(after.dev!==sourceIdentity.dev||after.ino!==sourceIdentity.ino||realpathSync(root)!==sourceRoot)fail('source root changed during replay');
    const provenance:Provenance={sourceRoot,sourceIdentity:{dev:String(sourceIdentity.dev),ino:String(sourceIdentity.ino)},window:{start,end:hostObservations().wallNow()},roots};
    runtimeProvenanceClassifier({...provenance,...readRustBuildProvenance(context.cargo)});
    return {...structuredClone(context),raw:{...raw},pid,provenance};
  }};
}

/** Analysis validates the capture-time receipt, never today's target tree. */
function validatedExecution(value:RustTestExecution):RustTestExecution{
  const digest=(row:CaptureArtifact)=>row&&/^[0-9a-f]{64}$/.test(row.sha256)&&Number.isSafeInteger(row.bytes)&&row.bytes>0;
  if(value.version!==1&&value.version!==2||!Number.isSafeInteger(value.pid)||value.pid<1||!isAbsolute(value.cwd)
    ||!Array.isArray(value.argv)||!value.argv.length||value.argv.some(arg=>typeof arg!=='string')
    ||value.argv[0]!==value.executable?.path||!digest(value.executable)||!isAbsolute(value.executable.path)||!isAbsolute(value.executable.physical)
    ||!digest(value.cargo)||!digest(value.raw)||!isAbsolute(value.raw.path)
    ||!value.target||typeof value.target.source!=='string'||typeof value.target.name!=='string'||typeof value.target.package!=='string'
    ||!Array.isArray(value.target.kind)||value.target.kind.some(kind=>typeof kind!=='string')
    ||!value.loader||!digest(value.loader.executable)||!isAbsolute(value.loader.executable.path)||!isAbsolute(value.loader.executable.physical)
    ||typeof value.loader.elf!=='string'||typeof value.loader.help!=='string'||typeof value.loader.diagnostics!=='string'
    ||value.loader.libraryPath!==null&&typeof value.loader.libraryPath!=='string')fail('malformed replay receipt');
  loaderSearch(value.loader,value.cwd);
  if(value.version===2){
    const provenance=value.provenance;
    if(!provenance||!isAbsolute(provenance.sourceRoot)||!provenance.sourceIdentity||!/^\d+$/.test(provenance.sourceIdentity.dev)||!/^\d+$/.test(provenance.sourceIdentity.ino)
      ||!provenance.window||!Number.isFinite(provenance.window.start)||!Number.isFinite(provenance.window.end)||provenance.window.end<provenance.window.start
      ||!Array.isArray(provenance.roots)||!value.cargo.path||!isAbsolute(value.cargo.path))fail('malformed capture provenance');
    runtimeProvenanceClassifier({...provenance,...readRustBuildProvenance({...value.cargo,path:value.cargo.path})});
  }
  return value;
}
export function readRustTestExecution(reference:CaptureArtifact&{path:string}):RustTestExecution{
  const bytes=readFileSync(reference.path);
  if(bytes.length!==reference.bytes||sha(bytes)!==reference.sha256)fail('replay receipt differs from manifest SHA/length');
  return validatedExecution(JSON.parse(bytes.toString('utf8')) as RustTestExecution);
}

export type RuntimeExecutionClass={kind:'emitted-executable';path:string;sha256:string}|{kind:'loader-probe';path:string;directory:string;origin:string;library?:string;loaderSha256:string;needed:string[]};
/** Classification describes a potential input of this exact execution. It
 * never supplies a historical return value or general directory authority. */
export function rustTestExecutionClassifier(execution?:RustTestExecution,sourceRoot=execution?.provenance?.sourceRoot){
  if(execution)validatedExecution(execution);
  const source=sourceRoot?capturedPathBoundary(sourceRoot):undefined;
  type Context={pid:number;birth:string;path:string;loader:Loader;search:ReturnType<typeof loaderSearch>;directories:Map<string,string>;ended:boolean};
  const contexts=new Map<number,Context>();let rootBirth:string|undefined,rootImage:number|undefined;
  const add=(image:InputIndexExecution,loader:Loader,cwd:string)=>{
    const search=loaderSearch(loader,cwd);contexts.set(image.id,{pid:image.pid,birth:image.birth,path:image.path,loader,search,
      directories:new Map(search.directories.map(row=>[row.path,row.origin])),ended:false});
  };
  const observe=(row:RuntimeObservation,image:InputIndexExecution)=>{
    const captured=image.imageLoader;
    if(!contexts.has(image.id)&&captured?.namespaceStable&&captured.capture.state==='captured')add(image,captured.capture.loader,captured.capture.cwd);
    if(execution&&row.attempt.tgid===execution.pid&&image.pid===execution.pid&&image.path===execution.executable.path){
      rootBirth??=image.birth;rootImage??=image.id;
      if(image.birth===rootBirth&&image.id===rootImage&&!contexts.has(image.id))add(image,execution.loader,execution.cwd);
    }
    const context=contexts.get(image.id);
    if(context&&row.attempt.tgid===context.pid&&row.attempt.birth===context.birth&&row.operation==='execute')context.ended=true;
  };
  return {observe,classify(row:RuntimeObservation,image:InputIndexExecution,assessment:RuntimeSubjectAssessment):RuntimeExecutionClass|undefined{
    observe(row,image);
    const path=assessment.spelling,requirement=assessment.requirement;
    if(!path||!assessment.identity)return;
    if(execution&&row.attempt.tgid===execution.pid&&image.pid===execution.pid&&(rootBirth===undefined||row.attempt.birth===rootBirth)
      &&path===execution.executable.path&&assessment.identity.state==='resolved'&&assessment.identity.path===path
      &&['execute','content','metadata'].includes(requirement.kind))
      return {kind:'emitted-executable',path,sha256:execution.executable.sha256};
    const context=contexts.get(image.id);
    if(!context||context.pid!==row.attempt.tgid||context.birth!==row.attempt.birth||context.path!==image.path||context.ended
      ||!['content','metadata'].includes(requirement.kind)
      ||assessment.components.some(row=>row.observation.kind==='readlink'||row.observation.kind==='runtimeKind'&&row.observation.value==='symlink'))return;
    if(source?.(assessment.identity.path))return;
    const directoryPath=requirement.kind==='metadata'&&requirement.query==='stat'&&path.endsWith('/')&&!path.endsWith('//')?path.slice(0,-1):path;
    if(resolve(directoryPath)!==directoryPath)return;
    const origin=context.directories.get(directoryPath);
    if(path!==directoryPath&&!origin)return;
    if(origin&&requirement.kind==='metadata'&&requirement.query==='stat')
      return {kind:'loader-probe',path,directory:directoryPath,origin,loaderSha256:context.loader.executable.sha256,needed:[...context.search.libraries]};
    const directory=dirname(path),library=basename(path),libraryOrigin=context.directories.get(directory);
    if(libraryOrigin&&context.search.libraries.includes(library)&&assessment.identity.state!=='resolved')
      return {kind:'loader-probe',path,directory,origin:libraryOrigin,library,loaderSha256:context.loader.executable.sha256,needed:[...context.search.libraries]};
    return undefined;
  }};
}
