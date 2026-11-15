// Read-only toolchain and recipe identity; no consumer or preparation entry.
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureToolchain,type TypeScriptIdentity} from './oracle-toolchain.ts';
import {oracleIdentityFor} from './oracle-runtime.ts';
import type {OracleIdentity} from './oracle-emit.ts';
export const REPOSITORY=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const ORACLE_LOADER=new URL('./oracle-loader.ts',import.meta.url).href;
const hash=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function packageFiles(root:string){
  const digest=createHash('sha256');
  function walk(dir:string):void{
    for(const name of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const path=join(dir,name.name);
      if(name.isDirectory())walk(path);
      else if(name.isFile()){
        const bytes=readFileSync(path),key=relative(root,path).split(sep).join('/');
        digest.update(JSON.stringify([key,bytes.length])+'\n');digest.update(bytes);
      }else throw Error('oracle TypeScript package contains an unsupported entry: '+path);
    }
  }
  walk(root);
  return digest;
}
export function packageRootHash(root:string):string{return packageFiles(root).digest('hex');}

/** Sorted relative paths, byte lengths and file bytes, then the native hash. */
export function packageIdentity(root:string,executable:string,nativeRoot=dirname(executable)):TypeScriptIdentity{
  const digest=packageFiles(root),rootPackageSha256=digest.copy().digest('hex');
  const nativeSha256=hash(readFileSync(executable));
  digest.update(JSON.stringify(['native-executable',nativeSha256]));
  return {version:JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version,
    rootPackageSha256,packageSha256:digest.digest('hex'),nativeSha256,nativePackageSha256:packageRootHash(nativeRoot)};
}
export function verifyToolchain(location=process.env.NTS_ORACLE_TYPESCRIPT){
  const {root,compiler,identity}=captureToolchain(location);return {root,compiler,identity};
}
export function oracleIdentity(location?:string):OracleIdentity{return oracleIdentityFor(verifyToolchain(location).identity);}


