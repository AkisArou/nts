// Only registered, closed run/tmp roots are an evictable cache. Logs, published
// artifacts and other scratch roots are outside this policy.
import {hostObservations,type HostObservations} from "./host-observations.ts";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {chmodSync,existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from "node:fs";
import {userInfo} from "node:os";
import {basename,dirname,join,resolve,relative,isAbsolute} from "node:path";
import {assertNoObservedProcessUsers} from '../landing/tree-users.ts';

export const FAILED_TEMP_MAX_BYTES=8*2**30;
export const TEMP_DISK_FLOOR_BYTES=40*2**30;
export type RunTemporary={path:string;parent:string;dev:number;ino:number;uid:number;enclosing?:RunTemporary};
export type DroppedOracleImage={path:string;bytes:number;state:'dropped'|'already absent'};
export type OracleImageDisposition=DroppedOracleImage|{path:string;bytes:null;state:`kept: ${string}`};
type ClosedTemporary={owned:RunTemporary;closed:number;bytes?:number;oracle_images?:OracleImageDisposition[]};
const registry=(home:string)=>join(home,".cache/nts-gate/closed-temporaries");
const pathKey=(path:string)=>createHash("sha256").update(path).digest("hex");
const key=(owned:RunTemporary)=>pathKey(owned.path)+".json";
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

/** A retained failure is evidence from one lifetime, never a new run's scratch. */
export function assertRunTemporaryOpen(run:string,home:string):void {
  for(let path=join(resolve(run),'tmp');;path=dirname(path)){
    if(basename(path)==='tmp'){
      const file=join(registry(home),pathKey(path)+'.json');
      if(existsSync(file)){
        const entry=JSON.parse(readFileSync(file,'utf8')) as ClosedTemporary;
        if(!entry||entry.owned?.path!==path||!Number.isFinite(entry.closed))throw Error('invalid closed run temporary registration: '+file);
        throw Error('run temporary is registered closed: '+path+'; choose a new run directory');
      }
    }
    if(path===dirname(path))return;
  }
}

export function captureRunTemporary(run:string,previous?:RunTemporary,home=userInfo().homedir):RunTemporary {
  assertRunTemporaryOpen(run,home);
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

type DirectoryIdentity={path:string;dev:number;ino:number;uid:number};
type OracleImageReceipt={version:1;kind:'oracle-dependency-image';temporary:RunTemporary;parent:DirectoryIdentity;image:DirectoryIdentity};
type RegisteredImage={file:string;dropped:string;receipt:OracleImageReceipt;present:boolean;prior?:DroppedOracleImage};
const imageRegistry=(owned:RunTemporary)=>join((owned.enclosing??owned).path,'.nts-oracle-images-v1');
function directoryIdentity(path:string):DirectoryIdentity {
  const info=lstatSync(path);
  if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.())throw Error('oracle image ancestor is not an owned directory: '+path);
  return {path,dev:info.dev,ino:info.ino,uid:info.uid};
}
function sameDirectory(expected:DirectoryIdentity):void {
  const actual=directoryIdentity(expected.path);
  if(actual.dev!==expected.dev||actual.ino!==expected.ino||actual.uid!==expected.uid)throw Error('registered oracle image directory was replaced: '+expected.path);
}
function imageParents(owned:RunTemporary,path:string,home:string):void {
  assertRunTemporary(owned,home);
  if(path!==resolve(path)||path===owned.path||!under(owned.path,path))throw Error('oracle image is outside its run temporary: '+path);
  let current=owned.path;
  for(const part of relative(owned.path,dirname(path)).split('/').filter(Boolean)){
    current=join(current,part);directoryIdentity(current);
  }
}
function checkedImageRegistry(owned:RunTemporary,home:string,create:boolean):string {
  const outer=owned.enclosing??owned;assertRunTemporary(outer,home);
  if(owned.enclosing&&!contains(outer,owned))throw Error('oracle image temporary is outside its enclosing run');
  const path=imageRegistry(owned);
  if(create&&!existsSync(path))mkdirSync(path,{mode:0o700});
  if(existsSync(path))directoryIdentity(path);
  return path;
}
/** The producer acquires an empty directory, never adopts an existing image.
 * Immutable receipts survive a red close alongside the image's identity files.
 * No registry is scanned for dead owners and no interrupted run is recovered. */
export function createRunOracleImage(owned:RunTemporary,home:string,path:string):string {
  assertRunTemporaryOpen(dirname(owned.path),home);
  imageParents(owned,path,home);
  if(path!==join(dirname(path),'tree'))throw Error('oracle image root must be its producer tree: '+path);
  const parent=directoryIdentity(dirname(path));
  mkdirSync(path);
  const image=directoryIdentity(path),directory=checkedImageRegistry(owned,home,true);
  const receipt:OracleImageReceipt={version:1,kind:'oracle-dependency-image',temporary:owned,parent,image};
  writeFileSync(join(directory,pathKey(path)+'.image.json'),JSON.stringify(receipt)+'\n',{flag:'wx',mode:0o400});
  return path;
}
function imageFact(file:string):unknown {
  const info=lstatSync(file);
  if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid?.()||info.nlink!==1)throw Error('oracle image receipt is not an owned regular file: '+file);
  return JSON.parse(readFileSync(file,'utf8')) as unknown;
}
function registeredImageFiles(owned:RunTemporary,home:string):string[] {
  const directory=checkedImageRegistry(owned,home,false);
  return existsSync(directory)?readdirSync(directory).filter(name=>name.endsWith('.image.json')).sort().map(name=>join(directory,name)):[];
}
function imageReceipt(file:string):OracleImageReceipt {
    const receipt=imageFact(file) as OracleImageReceipt;
    if(!receipt||receipt.version!==1||receipt.kind!=='oracle-dependency-image'||!receipt.temporary||typeof receipt.temporary.path!=='string')throw Error('invalid oracle image registration: '+file);
    return receipt;
}
function registeredImage(file:string,owned:RunTemporary,home:string,receipt=imageReceipt(file)):RegisteredImage|undefined {
    const name=basename(file),directory=dirname(file);
    if(!under((owned.enclosing??owned).path,receipt.temporary.path))throw Error('oracle image registration is outside its enclosing run: '+file);
    if(!under(owned.path,receipt.temporary.path))return undefined;
    assertRunTemporary(receipt.temporary,home);
    const path=receipt.image?.path;
    if(typeof path!=='string'||path!==join(receipt.parent?.path??'','tree')||name!==pathKey(path)+'.image.json')throw Error('invalid oracle image registration path: '+file);
    imageParents(receipt.temporary,path,home);sameDirectory(receipt.parent);
    const info=lstatSync(path,{throwIfNoEntry:false});if(info)sameDirectory(receipt.image);
    const dropped=join(directory,pathKey(path)+'.dropped.json');let prior:DroppedOracleImage|undefined;
    if(existsSync(dropped)){
      prior=imageFact(dropped) as DroppedOracleImage;
      if(!prior||prior.path!==path||!Number.isSafeInteger(prior.bytes)||prior.bytes<0||!['dropped','already absent'].includes(prior.state))throw Error('invalid oracle image disposal receipt: '+dropped);
      if(info)throw Error('disposed oracle image is present again: '+path);
    }
    return {file,dropped,receipt,present:Boolean(info),...(prior?{prior}:{})};
}
function registeredImages(owned:RunTemporary,home:string,host:HostObservations):RegisteredImage[] {
  const entries=registeredImageFiles(owned,home).flatMap(file=>{const entry=registeredImage(file,owned,home);return entry?[entry]:[];});
  const live=entries.filter(entry=>entry.present).map(entry=>entry.receipt.image.path);
  if(live.length)assertNoObservedProcessUsers(host.processUsers(live));
  return entries;
}
function dropOracleImages(owned:RunTemporary,home:string,host:HostObservations):OracleImageDisposition[] {
  const kept=(path:string,error:unknown):OracleImageDisposition=>({path,bytes:null,state:`kept: ${error instanceof Error?error.message:String(error)}`});
  let files:string[];try{files=registeredImageFiles(owned,home);}catch(error){return [kept(imageRegistry(owned),error)];}
  const dropped:OracleImageDisposition[]=[];
  for(const file of files){
   let path=file;
   try{
    const receipt=imageReceipt(file),reported=receipt.image?.path;
    if(typeof reported==='string'&&reported===resolve(reported)&&under(owned.path,reported))path=reported;
    const entry=registeredImage(file,owned,home,receipt);if(!entry)continue;
    if(entry.prior){dropped.push(entry.prior);continue;}
    let bytes=0;
    if(entry.present){
      assertNoObservedProcessUsers(host.processUsers([path]));
      bytes=Number(execFileSync('du',['-sx','-B1','--',path],{encoding:'utf8'}).split('\t')[0]);
      if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('cannot measure registered oracle image: '+path);
      imageParents(entry.receipt.temporary,path,home);sameDirectory(entry.receipt.parent);sameDirectory(entry.receipt.image);
      removable(path);sameDirectory(entry.receipt.image);rmSync(path,{recursive:true});
    }
    const result:DroppedOracleImage={path,bytes,state:entry.present?'dropped':'already absent'};
    writeFileSync(entry.dropped,JSON.stringify(result)+'\n',{flag:'wx',mode:0o400});dropped.push(result);
   }catch(error){dropped.push(kept(path,error));}
  }
  return dropped;
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

/** A command which has drained may discard its temporary on any verdict. */
export function discardRunTemporary(owned:RunTemporary,home:string,host:HostObservations=hostObservations()):void {
  assertRunTemporary(owned,home);
  const images=registeredImages(owned,home,host);
  removable(owned.path);rmSync(owned.path,{recursive:true});
  // A nested green temporary leaves its enclosing run's index intact.
  for(const image of images)for(const file of [image.file,image.dropped])rmSync(file,{force:true});
  rmSync(join(registry(home),key(owned)),{force:true});
}

/** Remove a green run's temporary folder, or close a red one's and prune the closed failures with `prune`. */
export type RunTemporaryClose={path:string;state:string;enclosing?:string;pruning?:ReturnType<typeof pruneRunTemporaries>;oracle_images?:OracleImageDisposition[];error?:string};
export function finishRunTemporary(owned:RunTemporary,home:string,green:boolean,prune:PruneOptions={}):RunTemporaryClose {
  try {
    const host=prune.host??hostObservations();
    if (green) {discardRunTemporary(owned,home,host);return {path:owned.path,state:"removed after green"};}
    assertRunTemporary(owned,home);
    const oracle_images=dropOracleImages(owned,home,host);
    const directory=registry(home),file=join(directory,key(owned));
    if (owned.enclosing) {
      assertRunTemporary(owned.enclosing,home);
      if (!contains(owned.enclosing,owned)) throw new Error(`run temporary is outside its enclosing run: ${owned.path}`);
      return {path:owned.path,state:"retained after red",enclosing:owned.enclosing.path,...(oracle_images.length?{oracle_images}:{})};
    }
    mkdirSync(directory,{recursive:true});
    writeClosed(file,{owned,closed:Date.now(),bytes:measuredBytes(owned),...(oracle_images.length?{oracle_images}:{})});
    const pruning=pruneRunTemporaries(home,prune);
    return {path:owned.path,state:existsSync(owned.path)?"retained after red":"evicted by failed-temporary bound",pruning,...(oracle_images.length?{oracle_images}:{})};
  } catch(error) {return {path:owned.path,state:"kept: cleanup guard or operation failed",error:(error as Error).message};}
}
