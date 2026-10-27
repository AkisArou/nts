// Only registered, closed run/tmp roots are an evictable cache. Logs, published
// artifacts and other scratch roots are outside this policy.
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,realpathSync,renameSync,rmSync,statfsSync,writeFileSync} from "node:fs";
import {homedir} from "node:os";
import {dirname,join,resolve,relative,isAbsolute} from "node:path";

export const FAILED_TEMP_MAX_BYTES=8*2**30;
export const TEMP_DISK_FLOOR_BYTES=40*2**30;
export type RunTemporary={path:string;parent:string;dev:number;ino:number;uid:number};
const registry=(home:string)=>join(home,".cache/nts-gate/closed-temporaries");
const key=(owned:RunTemporary)=>createHash("sha256").update(owned.path).digest("hex")+".json";
const under=(root:string,path:string)=>{const part=relative(root,path);return part!==".." && !part.startsWith("../") && !isAbsolute(part);};

export function captureRunTemporary(run:string,previous?:RunTemporary):RunTemporary {
  mkdirSync(run,{recursive:true});
  const path=join(resolve(run),"tmp");
  if (!existsSync(path)) mkdirSync(path);
  const stat=lstatSync(path),parent=realpathSync(run);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid!==process.getuid?.()) throw new Error(`run temporary root is not an owned real directory: ${path}`);
  const owned={path,parent,dev:stat.dev,ino:stat.ino,uid:stat.uid};
  if (previous?.path===path && (previous.dev!==owned.dev || previous.ino!==owned.ino || previous.parent!==parent)) throw new Error(`run temporary directory was replaced: ${path}`);
  return owned;
}

function checked(owned:RunTemporary,home:string):void {
  if (!owned || !isAbsolute(owned.path) || ![join(home,".cache"),join(homedir(),".cache")].some(root=>under(root,owned.path)) || owned.path!==join(dirname(owned.path),"tmp")) throw new Error("invalid registered run temporary path");
  const stat=lstatSync(owned.path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid!==process.getuid?.() || stat.uid!==owned.uid || stat.dev!==owned.dev || stat.ino!==owned.ino || realpathSync(dirname(owned.path))!==owned.parent) throw new Error(`run temporary directory was replaced: ${owned.path}`);
}

/** Bounds apply to closed failures, and may evict them further for admission.
 * An invalid identity is reported and kept; it can never authorize a removal. */
export function pruneRunTemporaries(home:string,options:{maxBytes?:number;minimumFreeBytes?:number;write?:(line:string)=>void;freeBytes?:()=>number}={}) {
  const directory=registry(home),removed:string[]=[],protectedPaths:string[]=[];
  if (!existsSync(directory)) return {removed,protected:protectedPaths,retained_bytes:0};
  const write=options.write ?? (text=>process.stderr.write(text+"\n"));
  const entries:{file:string;owned:RunTemporary;closed:number;bytes:number}[]=[];
  for (const name of readdirSync(directory).filter(name=>name.endsWith(".json"))) {
    const file=join(directory,name);
    try {
      const entry=JSON.parse(readFileSync(file,"utf8"));
      if (!existsSync(entry.owned.path)) {rmSync(file);continue;}
      checked(entry.owned,home);
      if (!Number.isFinite(entry.closed)) throw new Error("missing closed-run timestamp");
      const bytes=Number(execFileSync("du",["-sx","-B1","--",entry.owned.path],{encoding:"utf8"}).split("\t")[0]);
      if (!Number.isFinite(bytes)) throw new Error("cannot measure closed temporary bytes");
      entries.push({file,owned:entry.owned,closed:entry.closed,bytes});
    } catch(error) {protectedPaths.push(file);write(`gate tmp: kept ${file}: ${(error as Error).message}`);}
  }
  entries.sort((a,b)=>a.closed-b.closed || a.file.localeCompare(b.file));
  let total=entries.reduce((sum,entry)=>sum+entry.bytes,0);
  const free=options.freeBytes ?? (()=>{const stat=statfsSync(directory);return stat.bavail*stat.bsize;});
  for (const entry of entries) {
    if (total<=(options.maxBytes??FAILED_TEMP_MAX_BYTES) && free()>=(options.minimumFreeBytes??TEMP_DISK_FLOOR_BYTES)) break;
    try {
      checked(entry.owned,home);
      rmSync(entry.owned.path,{recursive:true});rmSync(entry.file);
      total-=entry.bytes;removed.push(entry.owned.path);write(`gate tmp: evicted closed failure ${entry.owned.path} (${entry.bytes} allocated bytes); logs retained`);
    } catch(error) {protectedPaths.push(entry.owned.path);write(`gate tmp: kept ${entry.owned.path}: ${(error as Error).message}`);}
  }
  return {removed,protected:protectedPaths,retained_bytes:total};
}

export function finishRunTemporary(owned:RunTemporary,home:string,green:boolean) {
  try {
    checked(owned,home);
    const directory=registry(home),file=join(directory,key(owned));
    if (green) {rmSync(owned.path,{recursive:true});rmSync(file,{force:true});return {path:owned.path,state:"removed after green"};}
    mkdirSync(directory,{recursive:true});
    const next=file+"."+process.pid;
    writeFileSync(next,JSON.stringify({owned,closed:Date.now()})+"\n");renameSync(next,file);
    const pruning=pruneRunTemporaries(home);
    return {path:owned.path,state:existsSync(owned.path)?"retained after red":"evicted by failed-temporary bound",pruning};
  } catch(error) {return {path:owned.path,state:"kept: cleanup guard or operation failed",error:(error as Error).message};}
}
