// One capture algorithm supplies root and child ELF/loader receipts. Cached
// facts are keyed by actual content and the loader's complete relevant context.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {basename,isAbsolute,join,resolve} from 'node:path';
import {needed} from './node-deps-elf.ts';
import type {ByteFact} from './file-input-observer.ts';
export type Executable={path:string;physical:string;sha256:string;bytes:number};
export type Loader={executable:Executable;elf:string;diagnostics:string;help:string;libraryPath:string|null};
export type ChildLoaderFact={version:1;pid:number;birth:string;path:string;cwd:string;request?:string}&(
  {state:'unavailable';reason:string}|{state:'captured';request:string;executable:Executable;loader:Loader});
export type LoaderCacheStatistics={elfHits:number;elfMisses:number;loaderHits:number;loaderMisses:number};
export type ChildLoaderObservation={namespaceStable:boolean;capture:ChildLoaderFact};
export function execEnvironment(value:ByteFact|undefined,decode:(value:ByteFact,purpose:string)=>string):NodeJS.ProcessEnv{
  if(!value)throw Error('missing stopped exec environment');
  if(value.null&&!value.error&&!value.truncated)return {};
  const text=decode(value,'stopped exec environment');
  if(text&&!text.endsWith('\0'))throw Error('unterminated exec environment');
  const env:NodeJS.ProcessEnv={};
  for(const item of text?text.slice(0,-1).split('\0'):[]){
    const equal=item.indexOf('=');if(equal<1)throw Error('malformed exec environment');
    const name=item.slice(0,equal);if(Object.hasOwn(env,name))throw Error('duplicate exec environment variable: '+name);
    env[name]=item.slice(equal+1);
  }
  return env;
}
export function childLoaderFact(value:unknown):value is ChildLoaderFact{
  if(!value||typeof value!=='object')return false;
  const row=value as ChildLoaderFact,digest=(value:Executable)=>value&&isAbsolute(value.path)&&isAbsolute(value.physical)
    &&/^[0-9a-f]{64}$/.test(value.sha256)&&Number.isSafeInteger(value.bytes)&&value.bytes>0;
  if(row.version!==1||!Number.isSafeInteger(row.pid)||row.pid<1||!/^\d+$/.test(row.birth)||!isAbsolute(row.path)||!isAbsolute(row.cwd)
    ||row.request!==undefined&&!/^\d+$/.test(row.request))return false;
  if(row.state==='unavailable')return typeof row.reason==='string'&&!!row.reason;
  if(row.state!=='captured'||!row.request||!digest(row.executable)||row.executable.path!==row.path||row.executable.physical!==row.path
    ||!row.loader||!digest(row.loader.executable)||typeof row.loader.elf!=='string'||typeof row.loader.help!=='string'||typeof row.loader.diagnostics!=='string'
    ||row.loader.libraryPath!==null&&typeof row.loader.libraryPath!=='string')return false;
  try{loaderSearch(row.loader,row.cwd);return true;}catch{return false;}
}
function fail(why:string):never{throw Error('Rust loader capture: '+why);}
const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function fingerprint(path:string):Executable{
  if(!isAbsolute(path)||resolve(path)!==path)fail('executable path is not absolute and canonical: '+path);
  const physical=realpathSync(path),before=lstatSync(physical,{bigint:true});
  if(!before.isFile())fail('executable is not a regular file: '+path);
  const bytes=readFileSync(physical),after=lstatSync(physical,{bigint:true});
  if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)
    fail('executable changed while reading: '+path);
  return {path,physical,sha256:sha(bytes),bytes:bytes.length};
}
export function interpreter(elf:string):string{
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

export function rustLoaderCapture(toolEnvironment:NodeJS.ProcessEnv){
  const elfFacts=new Map<string,string>(),reports=new Map<string,{diagnostics:string;help:string}>();
  const counts={elfHits:0,elfMisses:0,loaderHits:0,loaderMisses:0};
  return {statistics:()=>({...counts}),capture(path:string,cwd:string,env:NodeJS.ProcessEnv,platform:string,activePath=path):{executable:Executable;loader:Loader}{
    const active=fingerprint(activePath),executable={...active,path};
    for(const [name,value]of Object.entries(env))if(value&&name.startsWith('LD_')&&name!=='LD_LIBRARY_PATH'&&name!=='LD_HWCAP_MASK')
      fail(name+' loader derivation is not implemented');
    let elf=elfFacts.get(active.sha256);
    if(elf===undefined){
      counts.elfMisses++;
      elf=execFileSync('readelf',['-lWd',activePath],{env:toolEnvironment,encoding:'utf8',stdio:['ignore','pipe','pipe']});
      elfFacts.set(active.sha256,elf);
    }else counts.elfHits++;
    const loaderPath=interpreter(elf),loaderExecutable=fingerprint(loaderPath);
    // Locale affects --help text, and tunables can affect hwcaps independently
    // of LD_*. Include every such supplied variable rather than a hand-picked
    // subset of the loader's LD_* inputs.
    const environment=Object.entries(env).filter(([name])=>name.startsWith('LD_')||name==='GLIBC_TUNABLES'||name==='LANG'||name.startsWith('LC_')).sort(([a],[b])=>a.localeCompare(b));
    const key=JSON.stringify([loaderExecutable.sha256,platform,environment]);
    let report=reports.get(key);
    if(report===undefined){
      counts.loaderMisses++;
      const diagnostics=execFileSync(loaderPath,['--list-diagnostics'],{env,cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']})
        .split('\n').filter(line=>line.startsWith('path.system_dirs[')).join('\n');
      const helpText=execFileSync(loaderPath,['--help'],{env,cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
      const help=/^Subdirectories of glibc-hwcaps directories, in priority order:\n(?:  [^\n]+\n)+/m.exec(helpText)?.[0].trimEnd();
      if(!help)fail('loader has no hwcaps report');
      report={diagnostics,help};reports.set(key,report);
    }else counts.loaderHits++;
    const loader:Loader={executable:loaderExecutable,elf,...report,libraryPath:env.LD_LIBRARY_PATH??null};
    loaderSearch(loader,cwd);
    const after=fingerprint(activePath);
    if(active.sha256!==after.sha256||active.physical!==after.physical||active.bytes!==after.bytes
      ||JSON.stringify(loaderExecutable)!==JSON.stringify(fingerprint(loaderPath)))fail('executable changed during loader capture');
    return {executable,loader};
  }};
}
/** A root replay uses exactly the child capture algorithm, without sharing
 * any cache generation beyond this preparation. */
export function captureRustLoader(path:string,cwd:string,env:NodeJS.ProcessEnv):Loader{
  return rustLoaderCapture(env).capture(path,cwd,env,'root preparation').loader;
}

