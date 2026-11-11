// Only registered, closed run/tmp roots are an evictable cache. Logs, published
// artifacts and other scratch roots are outside this policy.
import {hostObservations,type HostObservations} from "./host-observations.ts";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {chmodSync,existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from "node:fs";
import {userInfo} from "node:os";
import {dirname,join,resolve,relative,isAbsolute} from "node:path";

export const FAILED_TEMP_MAX_BYTES=8*2**30;
export const TEMP_DISK_FLOOR_BYTES=40*2**30;
export type RunTemporary={path:string;parent:string;dev:number;ino:number;uid:number;enclosing?:RunTemporary};
type ClosedTemporary={owned:RunTemporary;closed:number;bytes?:number};
const registry=(home:string)=>join(home,".cache/nts-gate/closed-temporaries");
const key=(owned:RunTemporary)=>createHash("sha256").update(owned.path).digest("hex")+".json";
const under=(root:string,path:string)=>{const part=relative(root,path);return part!==".." && !part.startsWith("../") && !isAbsolute(part);};
const contains=(outer:RunTemporary,inner:RunTemporary)=>outer.path!==inner.path && under(outer.path,inner.path)
  && join(outer.parent,"tmp")!==join(inner.parent,"tmp") && under(join(outer.parent,"tmp"),join(inner.parent,"tmp"));
function measuredBytes(owned:RunTemporary):number {
  const bytes=Number(execFileSync("du",["-sx","-B1","--",owned.path],{encoding:"utf8"}).split("\t")[0]);
  if (!Number.isSafeInteger(bytes) || bytes<0) throw new Error("cannot measure closed temporary bytes");
  return bytes;
}
function writeClosed(file:string,entry:ClosedTemporary):void {
  const next=file+"."+process.pid;
  writeFileSync(next,JSON.stringify(entry)+"\n");renameSync(next,file);
}

export function captureRunTemporary(run:string,previous?:RunTemporary):RunTemporary {
  mkdirSync(run,{recursive:true});
  const path=join(resolve(run),"tmp");
  if (!existsSync(path)) mkdirSync(path);
  const stat=lstatSync(path),parent=realpathSync(run);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid!==process.getuid?.()) throw new Error(`run temporary root is not an owned real directory: ${path}`);
  const owned={path,parent,dev:stat.dev,ino:stat.ino,uid:stat.uid};
  if (previous?.path===path && (previous.dev!==owned.dev || previous.ino!==owned.ino || previous.parent!==parent)) throw new Error(`run temporary directory was replaced: ${path}`);
  // The canonical handoff already carries the enclosing run's exact identity.
  // Jobs inside it share its retention lifetime instead of counting it twice.
  const owner=previous?.enclosing??previous;
  const enclosing=previous?.path===path?previous.enclosing:owner&&contains(owner,owned)?owner:undefined;
  return {...owned,...(enclosing?{enclosing}:{})};
}

export function assertRunTemporary(owned:RunTemporary,home:string):void {
  if (!owned || !isAbsolute(owned.path) || ![join(home,".cache"),join(userInfo().homedir,".cache")].some(root=>under(root,owned.path)) || owned.path!==join(dirname(owned.path),"tmp")) throw new Error("invalid registered run temporary path");
  const stat=lstatSync(owned.path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid!==process.getuid?.() || stat.uid!==owned.uid || stat.dev!==owned.dev || stat.ino!==owned.ino || realpathSync(dirname(owned.path))!==owned.parent) throw new Error(`run temporary directory was replaced: ${owned.path}`);
}

export type PruneOptions={maxBytes?:number;minimumFreeBytes?:number;write?:(line:string)=>void;freeBytes?:()=>number;host?:HostObservations};
// A run can own read-only captured inputs. Restore directory permissions only
// after assertRunTemporary() authenticates this exact root; never traverse a link.
// Names are walked as bytes: one that is not UTF-8, which a test writes on
// purpose, decodes to U+FFFD and names nothing, so a walk by strings stopped
// there and its folder was kept on every prune.
const SLASH=Buffer.from("/");
export function removable(root:string):void {
  const walk=(path:Buffer)=>{
    const info=lstatSync(path);
    if(info.isSymbolicLink()||!info.isDirectory())return;
    if(info.uid!==process.getuid?.())throw new Error("a folder another user owns: "+path.toString());
    chmodSync(path,(info.mode&0o777)|0o700);
    for(const name of readdirSync(path,{encoding:"buffer"}))walk(Buffer.concat([path,SLASH,name]));
  };
  walk(Buffer.from(root));
}

/** Bounds apply to closed failures, and may evict them further for admission.
 * An invalid identity is reported and kept; it can never authorize a removal.
 * The result names the bounds and the free-disk reading the last decision
 * used (null when no closed failure needed one), so a caller can tell an
 * eviction by the disk floor from one by the size bound. */
export function pruneRunTemporaries(home:string,options:PruneOptions={}) {
  const directory=registry(home),removed:string[]=[],protectedPaths:string[]=[];
  const maxBytes=options.maxBytes??FAILED_TEMP_MAX_BYTES,minimumFreeBytes=options.minimumFreeBytes??TEMP_DISK_FLOOR_BYTES;
  let freeBytes:number|null=null;
  const bounds=()=>({free_bytes:freeBytes,minimum_free_bytes:minimumFreeBytes,max_bytes:maxBytes});
  if (!existsSync(directory)) return {removed,protected:protectedPaths,retained_bytes:0,...bounds()};
  const write=options.write ?? (text=>process.stderr.write(text+"\n"));
  const pending:{file:string;entry:ClosedTemporary}[]=[],entries:{file:string;owned:RunTemporary;closed:number;bytes:number}[]=[];
  for (const name of readdirSync(directory).filter(name=>name.endsWith(".json"))) {
    const file=join(directory,name);
    try {
      const entry=JSON.parse(readFileSync(file,"utf8")) as ClosedTemporary;
      if (!existsSync(entry.owned.path)) {rmSync(file);continue;}
      assertRunTemporary(entry.owned,home);
      if (!Number.isFinite(entry.closed)) throw new Error("missing closed-run timestamp");
      if (entry.bytes!==undefined && (!Number.isSafeInteger(entry.bytes) || entry.bytes<0)) throw new Error("invalid closed temporary bytes");
      pending.push({file,entry});
    } catch(error) {protectedPaths.push(file);write(`gate tmp: kept ${file}: ${(error as Error).message}`);}
  }
  // Load outer roots first. Legacy job entries are redundant only after their
  // authenticated outer root has a valid size; remove metadata, never evidence.
  pending.sort((a,b)=>a.entry.owned.path.length-b.entry.owned.path.length || a.file.localeCompare(b.file));
  for (const {file,entry} of pending) {
    try {
      if (entries.some(outer=>contains(outer.owned,entry.owned))) {rmSync(file);continue;}
      const bytes=entry.bytes??measuredBytes(entry.owned);
      if (entry.bytes===undefined) writeClosed(file,{...entry,bytes});
      entries.push({file,owned:entry.owned,closed:entry.closed,bytes});
    } catch(error) {protectedPaths.push(file);write(`gate tmp: kept ${file}: ${(error as Error).message}`);}
  }
  entries.sort((a,b)=>a.closed-b.closed || a.file.localeCompare(b.file));
  let total=entries.reduce((sum,entry)=>sum+entry.bytes,0);
  const free=options.freeBytes ?? (()=>(options.host??hostObservations()).disk(directory).freeBytes);
  for (const entry of entries) {
    freeBytes=free();
    if (total<=maxBytes && freeBytes>=minimumFreeBytes) break;
    try {
      assertRunTemporary(entry.owned,home);
      removable(entry.owned.path);rmSync(entry.owned.path,{recursive:true});rmSync(entry.file);
      total-=entry.bytes;removed.push(entry.owned.path);write(`gate tmp: evicted closed failure ${entry.owned.path} (${entry.bytes} allocated bytes); logs retained`);
    } catch(error) {protectedPaths.push(entry.owned.path);write(`gate tmp: kept ${entry.owned.path}: ${(error as Error).message}`);}
  }
  return {removed,protected:protectedPaths,retained_bytes:total,...bounds()};
}

/** Remove a green run's temporary folder, or close a red one's and prune the closed failures with `prune`. */
export function finishRunTemporary(owned:RunTemporary,home:string,green:boolean,prune:PruneOptions={}) {
  try {
    assertRunTemporary(owned,home);
    const directory=registry(home),file=join(directory,key(owned));
    if (green) {removable(owned.path);rmSync(owned.path,{recursive:true});rmSync(file,{force:true});return {path:owned.path,state:"removed after green"};}
    if (owned.enclosing) {
      assertRunTemporary(owned.enclosing,home);
      if (!contains(owned.enclosing,owned)) throw new Error(`run temporary is outside its enclosing run: ${owned.path}`);
      return {path:owned.path,state:"retained after red",enclosing:owned.enclosing.path};
    }
    mkdirSync(directory,{recursive:true});
    writeClosed(file,{owned,closed:Date.now(),bytes:measuredBytes(owned)});
    const pruning=pruneRunTemporaries(home,prune);
    return {path:owned.path,state:existsSync(owned.path)?"retained after red":"evicted by failed-temporary bound",pruning};
  } catch(error) {return {path:owned.path,state:"kept: cleanup guard or operation failed",error:(error as Error).message};}
}
