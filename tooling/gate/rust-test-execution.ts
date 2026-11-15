// A replay retains the build product and the loader inputs it actually used.
// These are finite execution facts, never authority for a target/ namespace.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {needed} from './node-deps-elf.ts';
import {testArtifactTargets,type RustTarget,type InputIndexExecution,type RuntimeObservation} from './rust-test-inputs.ts';
import type {CaptureArtifact} from './file-input-observer.ts';
import type {RuntimeSubjectAssessment} from './rust-input-validation.ts';
import {verifyTestScratchRoot,type TestScratchReceipt} from './test-scratch.ts';
import {hostObservations} from './host-observations.ts';
import {readRustBuildProvenance,runtimeProvenanceClassifier} from './rust-input-provenance.ts';

type Executable={path:string;physical:string;sha256:string;bytes:number};
type Loader={executable:Executable;elf:string;diagnostics:string;help:string;libraryPath:string|null};
type Provenance={sourceRoot:string;sourceIdentity:{dev:string;ino:string};window:{start:number;end:number};roots:TestScratchReceipt[]};
export type RustTestExecution={version:1|2;target:RustTarget;executable:Executable;cwd:string;argv:string[];loader:Loader;
  cargo:CaptureArtifact&{path?:string};raw:CaptureArtifact&{path:string};pid:number;provenance?:Provenance};
function fail(why:string):never{throw Error('Rust test execution: '+why);}
const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function fingerprint(path:string):Executable{
  if(!isAbsolute(path)||resolve(path)!==path)fail('executable path is not absolute and canonical: '+path);
  const physical=realpathSync(path),before=lstatSync(physical,{bigint:true});
  if(!before.isFile())fail('executable is not a regular file: '+path);
  const bytes=readFileSync(physical),after=lstatSync(physical,{bigint:true});
  if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)
    fail('executable changed while reading: '+path);
  return {path,physical,sha256:sha(bytes),bytes:bytes.length};
}
function interpreter(elf:string):string{
  const matches=[...elf.matchAll(/\[Requesting program interpreter: ([^\]\r\n]+)\]/g)];
  if(matches.length!==1||!isAbsolute(matches[0]![1]!))fail('ELF has no unique absolute interpreter');
  return matches[0]![1]!;
}
/** Both capture and replay interpret the loader's own reports identically.
 * Only searched hwcaps qualify; supported-but-disabled entries do not. */
export function loaderSearch(loader:Loader,cwd:string):{directories:{path:string;origin:string}[];libraries:string[]}{
  if(interpreter(loader.elf)!==loader.executable.path)fail('ELF interpreter differs from loader receipt');
  if(/\((?:RPATH|RUNPATH)\)/.test(loader.elf))fail('ELF RPATH/RUNPATH derivation is not implemented');
  const libraries=needed(loader.elf);
  if(!libraries.length||libraries.some(name=>basename(name)!==name||name==='.'||name==='..'))fail('unsupported ELF NEEDED pathname');
  const system:string[]=[];
  for(const line of loader.diagnostics.split('\n')){
    const match=/^path\.system_dirs\[0x[0-9a-f]+\]="(\/[^"\\\r\n]*)"$/.exec(line);
    if(!match)fail('unsupported loader system-directory diagnostic');
    system.push(match[1]!);
  }
  if(!system.length)fail('loader reported no system directories');
  const lines=loader.help.split('\n');
  if(lines[0]!=='Subdirectories of glibc-hwcaps directories, in priority order:')fail('missing loader hwcaps report');
  const hwcaps:string[]=[];
  for(const line of lines.slice(1)){
    const match=/^  ([A-Za-z0-9_-]+)( \(supported, searched\))?$/.exec(line);
    if(!match)fail('unsupported loader hwcaps report');
    if(match[2])hwcaps.push(match[1]!);
  }
  const directories:{path:string;origin:string}[]=[],seen=new Set<string>();
  const add=(path:string,origin:string)=>{
    if(path.includes('$'))fail('loader token expansion is not implemented');
    const absolute=resolve(cwd,path);
    if(!seen.has(absolute)){seen.add(absolute);directories.push({path:absolute,origin});}
  };
  const roots=[...(loader.libraryPath===null?[]:loader.libraryPath.split(/[:;]/).map(path=>({path:path||cwd,origin:'Cargo LD_LIBRARY_PATH'}))),
    ...system.map(path=>({path,origin:'loader system directory'}))];
  for(const root of roots){
    for(const capability of hwcaps)add(join(root.path,'glibc-hwcaps',capability),root.origin+' + searched glibc-hwcaps/'+capability);
    add(root.path,root.origin);
  }
  return {directories,libraries};
}

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
  for(const name of ['LD_PRELOAD','LD_AUDIT'])if(env[name])fail(name+' loader derivation is not implemented');
  const elf=execFileSync('readelf',['-lWd',argv[0]],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}),loaderPath=interpreter(elf);
  const loaderExecutable=fingerprint(loaderPath);
  const diagnostics=execFileSync(loaderPath,['--list-diagnostics'],{env,cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']})
    .split('\n').filter(line=>line.startsWith('path.system_dirs[')).join('\n');
  const helpText=execFileSync(loaderPath,['--help'],{env,cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const help=/^Subdirectories of glibc-hwcaps directories, in priority order:\n(?:  [^\n]+\n)+/m.exec(helpText)?.[0].trimEnd();
  if(!help)fail('loader has no hwcaps report');
  const loader:Loader={executable:loaderExecutable,elf,diagnostics,help,libraryPath:env.LD_LIBRARY_PATH??null};
  loaderSearch(loader,cwd);
  if(!same(executable,fingerprint(executable.path))||!same(loaderExecutable,fingerprint(loaderPath)))fail('executable changed during loader capture');
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
export function rustTestExecutionClassifier(execution:RustTestExecution){
  validatedExecution(execution);
  const search=loaderSearch(execution.loader,execution.cwd),directories=new Map(search.directories.map(row=>[row.path,row.origin]));
  let birth:string|undefined,entryImage:number|undefined,loaderEnded=false;
  const observe=(row:RuntimeObservation,image:InputIndexExecution)=>{
    if(row.attempt.tgid!==execution.pid||image.pid!==execution.pid)return;
    if(image.path===execution.executable.path){birth??=image.birth;entryImage??=image.id;}
    if(birth!==undefined&&row.attempt.birth!==birth)return;
    if(image.path===execution.executable.path&&row.operation==='execute')loaderEnded=true;
  };
  return {observe,classify(row:RuntimeObservation,image:InputIndexExecution,assessment:RuntimeSubjectAssessment):RuntimeExecutionClass|undefined{
    observe(row,image);
    if(row.attempt.tgid!==execution.pid||image.pid!==execution.pid||birth!==undefined&&row.attempt.birth!==birth)return;
    const path=assessment.spelling,requirement=assessment.requirement;
    if(!path||!assessment.identity)return;
    const directoryPath=requirement.kind==='metadata'&&requirement.query==='stat'&&path.endsWith('/')&&!path.endsWith('//')?path.slice(0,-1):path;
    if(resolve(directoryPath)!==directoryPath)return;
    if(path===execution.executable.path&&assessment.identity.state==='resolved'&&assessment.identity.path===path
      &&['execute','content','metadata'].includes(requirement.kind))
      return {kind:'emitted-executable',path,sha256:execution.executable.sha256};
    if(image.path!==execution.executable.path||image.id!==entryImage||loaderEnded||!['content','metadata'].includes(requirement.kind)
      ||assessment.components.some(row=>row.observation.kind==='readlink'||row.observation.kind==='runtimeKind'&&row.observation.value==='symlink'))return;
    const origin=directories.get(directoryPath);
    if(path!==directoryPath&&!origin)return;
    if(origin&&requirement.kind==='metadata'&&requirement.query==='stat')
      return {kind:'loader-probe',path,directory:directoryPath,origin,loaderSha256:execution.loader.executable.sha256,needed:[...search.libraries]};
    const directory=dirname(path),library=basename(path),libraryOrigin=directories.get(directory);
    if(libraryOrigin&&search.libraries.includes(library)&&assessment.identity.state!=='resolved')
      return {kind:'loader-probe',path,directory,origin:libraryOrigin,library,loaderSha256:execution.loader.executable.sha256,needed:[...search.libraries]};
    return undefined;
  }};
}
