// One authenticated installed TypeScript capture serves oracle execution and
// compiler-project discovery. No selector or SDK module is imported here.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,realpathSync} from 'node:fs';
import {dirname,join,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import type {HostObservation} from './oracle-runtime.ts';
export type TypeScriptIdentity={version:string;rootPackageSha256:string;packageSha256:string;nativeSha256:string;nativePackageSha256:string};
type ToolchainRecord=TypeScriptIdentity&{nativePackage:string;executable:string};
export type ToolchainRecords={version:1;platforms:Record<string,ToolchainRecord>;execution:{manifestVersion:3;options:string;args:string[]}};
export type InstalledTypeScript={kind:'typescript-sdk';root:string;nativeRoot:string;identity:TypeScriptIdentity};
const hash=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export type Capture={root:string;compiler:string;identity:TypeScriptIdentity;files:Map<string,Buffer>;nativeFiles:Map<string,Buffer>;nativePackage:string;nativeRoot:string;executable:string};

// Capture each byte once. Execution uses this capture, never a second read of
// files whose hashes were checked: a concurrently replaced installation is
// either refused or has no effect on the worker's owned snapshot.
export function captureToolchain(location?:string):Capture{
  if(!location)throw Error('oracle TypeScript capability NTS_ORACLE_TYPESCRIPT is missing');
  const root=realpathSync(location),records:ToolchainRecords=JSON.parse(readFileSync(fileURLToPath(new URL('./oracle-toolchain.json',import.meta.url)),'utf8'));
  const expected=records.platforms[process.platform+'-'+process.arch];
  if(records.version!==1||!expected)throw Error('oracle TypeScript toolchain has no recorded identity for '+process.platform+'-'+process.arch);
  const files=new Map<string,Buffer>(),digest=createHash('sha256');
  function walk(dir:string){
    for(const item of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const path=join(dir,item.name);
      if(item.isDirectory())walk(path);
      else if(item.isFile()){
        const bytes=readFileSync(path),key=relative(root,path).split(sep).join('/');files.set(key,bytes);
        digest.update(JSON.stringify([key,bytes.length])+'\n');digest.update(bytes);
      }else throw Error('oracle TypeScript package contains an unsupported entry: '+path);
    }
  }
  walk(root);
  const actualRoot=digest.copy().digest('hex');
  if(actualRoot!==expected.rootPackageSha256)throw Error(`oracle TypeScript root package hash mismatch: expected ${expected.rootPackageSha256}; actual ${actualRoot}`);
  const require=createRequire(pathToFileURL(join(root,'package.json')));
  const nativeRoot=dirname(require.resolve(expected.nativePackage+'/package.json')),compiler=join(nativeRoot,expected.executable);
  const nativeFiles=new Map<string,Buffer>(),nativeDigest=createHash('sha256');
  function nativeWalk(dir:string){
    for(const item of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const path=join(dir,item.name);if(item.isDirectory())nativeWalk(path);
      else if(item.isFile()){const bytes=readFileSync(path),key=relative(nativeRoot,path).split(sep).join('/');nativeFiles.set(key,bytes);nativeDigest.update(JSON.stringify([key,bytes.length])+'\n');nativeDigest.update(bytes);}
      else throw Error('oracle TypeScript platform package contains an unsupported entry: '+path);
    }
  }
  nativeWalk(nativeRoot);const nativeSha256=hash(nativeFiles.get(expected.executable)!);
  digest.update(JSON.stringify(['native-executable',nativeSha256]));
  const actual={version:JSON.parse(files.get('package.json')!.toString('utf8')).version,rootPackageSha256:actualRoot,packageSha256:digest.digest('hex'),nativeSha256,nativePackageSha256:nativeDigest.digest('hex')};
  for(const key of ['version','rootPackageSha256','packageSha256','nativeSha256','nativePackageSha256'] as const)
    if(actual[key]!==expected[key])throw Error(`oracle TypeScript ${key} mismatch: expected ${expected[key]}; actual ${actual[key]}`);
  return {root,compiler,identity:actual,files,nativeFiles,nativePackage:expected.nativePackage,nativeRoot,executable:expected.executable};
}
/** Exact authenticated package membership, not a node_modules prefix grant.
 * Negative probes are supported only under directories in this captured tree.
 * Symlinks are rejected by captureToolchain before this function is reached. */
export function toolchainFact(capture:Capture,row:HostObservation):boolean{
  for(const [root,files]of [[capture.root,capture.files],[capture.nativeRoot,capture.nativeFiles]] as const){
    const name=relative(root,row.path).split(sep).join('/');
    if(name==='..'||name.startsWith('../')||name.startsWith('/'))continue;
    const bytes=files.get(name),directory=name===''||[...files.keys()].some(path=>path.startsWith(name+'/'));
    const parent=name.includes('/')?name.slice(0,name.lastIndexOf('/')):'';
    const knownParent=parent===''||[...files.keys()].some(path=>path.startsWith(parent+'/'));
    switch(row.kind){
      case 'file':return bytes?row.value===hash(bytes):!directory&&knownParent&&row.value===null;
      case 'fileExists':return knownParent&&row.value===!!bytes;
      case 'directoryExists':return knownParent&&row.value===directory;
      case 'runtimeKind':return knownParent&&row.value===(bytes?'file':directory?'directory':null);
      case 'readlink':return knownParent&&row.value===null;
      case 'realpath':return (bytes!==undefined||directory)&&row.value===row.path;
      // Stat and enumeration retain the actual callback values and are replayed
      // against this same installed capability, never copied-root substitutes.
      case 'stat':return bytes!==undefined||directory;
      case 'entries':case 'runtimeEntries':return directory;
    }
  }
  return false;
}
export const toolchainDescriptor=(capture:Capture):InstalledTypeScript=>({kind:'typescript-sdk',root:capture.root,nativeRoot:capture.nativeRoot,identity:{...capture.identity}});
