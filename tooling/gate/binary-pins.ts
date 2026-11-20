// Content-named executables outlive every run holding them. All cache mutations
// share one owner lock; expensive copies and hashing happen before taking it.
import {createHash,randomUUID} from 'node:crypto';
import {chmodSync,closeSync,copyFileSync,existsSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,renameSync,rmSync,utimesSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {processIdentity,withLock} from '../landing/lock.ts';
import {durableRecord} from './durable-record.ts';
import {hostObservations} from './host-observations.ts';

type Holder={version:1;run:string;token:string;identity:string;pid:number};
export type PinOwnerState='live'|'gone'|'unknown';
export type PinOwnerObservation=(pid:number,identity:string)=>PinOwnerState;
export type PinTiming={waitMs:number;heldMs:number};
export type BinaryPin={paths:Record<string,string>;bundleSha256:string;members:Record<string,string>;timing:PinTiming;release():void};
type Options={root:string;hash:string;run:string;binaries:Readonly<Record<string,string>>;
  observe?:PinOwnerObservation;now?:()=>number;wallNow?:()=>number};
const HASH=/^[0-9a-f]{64}$/;
const IDENTITY=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} ([1-9][0-9]*) [0-9]+$/;
const UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const STAGING=new RegExp('^\\.staging-v1-('+UUID+')-([1-9][0-9]*)-([0-9]+)-'+UUID+'$');
const CORRUPT='.corrupt-v1.json';
type Corruption={version:1;member:string;expected:string;actual:string};
export type BinaryPinDiagnostics={warnings:string[];notices:string[]};
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';

/** null from the shared identity reader alone is not evidence of death: it
 * includes unreadable proc state. Only ESRCH proves an absent process. */
export const observePinOwner:PinOwnerObservation=(pid,identity)=>{
  const current=processIdentity(pid);
  if(current!==null)return current===identity?'live':'gone';
  try{process.kill(pid,0);return 'unknown';}
  catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH'?'gone':'unknown';}
};

function holder(path:string):Holder{
  const value:unknown=JSON.parse(readFileSync(path,'utf8'));
  if(!value||typeof value!=='object')throw Error('malformed holder');
  const row=value as Partial<Holder>;
  if(typeof row.version==='number'&&row.version>1)throw Error('future holder version '+row.version);
  if(row.version!==1||typeof row.run!=='string'||!row.run||typeof row.token!=='string'||!row.token
    ||typeof row.identity!=='string'||!IDENTITY.test(row.identity)||!Number.isSafeInteger(row.pid)
    ||Number(IDENTITY.exec(row.identity)?.[1])!==row.pid)throw Error('malformed holder');
  return row as Holder;
}

function pins(root:string):string[]{
  try{return readdirSync(root,{withFileTypes:true}).filter(e=>HASH.test(e.name)&&e.isDirectory()).map(e=>join(root,e.name));}
  catch(error){if(missing(error))return [];throw error;}
}

/** The complete birth identity is published by mkdir itself, before copying
 * any bytes. No crash can leave a newly created stage without an owner. */
function createStaging(root:string,row:Holder):string{
  const path=join(root,'.staging-v1-'+row.identity.replaceAll(' ','-')+'-'+randomUUID());
  mkdirSync(path,{mode:0o700});return path;
}

function stagingDiagnostics(root:string,observe:PinOwnerObservation,reclaim:boolean):BinaryPinDiagnostics{
  const result:BinaryPinDiagnostics={warnings:[],notices:[]};
  for(const entry of readdirSync(root,{withFileTypes:true}).filter(entry=>entry.name.startsWith('.staging-'))){
    const path=join(root,entry.name);
    try{
      const match=STAGING.exec(entry.name),pid=Number(match?.[2]);
      if(!match||!Number.isSafeInteger(pid))throw Error('malformed or unsupported staging owner name');
      const identity=match[1]+' '+pid+' '+match[3],before=lstatSync(path);
      if(!before.isDirectory()||before.isSymbolicLink())throw Error('staging is not a real directory');
      const state=observe(pid,identity);
      if(state==='gone'&&reclaim){
        const current=lstatSync(path);
        if(current.dev!==before.dev||current.ino!==before.ino||!current.isDirectory()||current.isSymbolicLink()
          ||!STAGING.test(entry.name)||observe(pid,identity)!=='gone')throw Error('staging ownership changed during reclamation');
        rmSync(path,{recursive:true,force:true});
      }else if(state==='unknown')result.warnings.push(`${path}: unreclaimable staging directory: owner identity unknown (${identity})`);
      else result.notices.push(`${path}: ${state==='live'?'live':'abandoned'} staging directory (${identity})`);
    }catch(error){if(!missing(error))result.warnings.push(`${path}: unreclaimable staging directory: ${String(error)}`);}
  }
  return result;
}

function readCorruption(path:string):Corruption|undefined{
  let value:unknown;
  try{value=JSON.parse(readFileSync(path,'utf8'));}catch(error){if(missing(error))return;throw error;}
  if(!value||typeof value!=='object')throw Error('malformed corruption diagnostic');
  const row=value as Partial<Corruption>;
  if(typeof row.version==='number'&&row.version>1)throw Error('future corruption diagnostic version '+row.version);
  if(row.version!==1||typeof row.member!=='string'||typeof row.expected!=='string'||!HASH.test(row.expected)
    ||typeof row.actual!=='string'||!HASH.test(row.actual))throw Error('malformed corruption diagnostic');
  return row as Corruption;
}

function reportCorruption(root:string,dir:string,row:Holder,diagnostic:Corruption):void{
  const stage=createStaging(root,row),prepared=join(stage,CORRUPT),path=join(dir,CORRUPT);
  try{
    durableRecord(prepared,diagnostic);
    withLock(join(root,'.lock'),()=>{
      readCorruption(path); // Never overwrite malformed or future state.
      const before=lstatSync(dir);
      renameSync(prepared,path);
      // Publishing a diagnostic is not a successful use of the bundle.
      utimesSync(dir,before.atime,before.mtime);
    });
  }finally{rmSync(stage,{recursive:true,force:true});}
}

function inspect(dir:string,observe:PinOwnerObservation,reclaim:boolean):{held:boolean;warnings:string[]}{
  const directory=join(dir,'holders'),warnings:string[]=[];
  let entries:string[];
  try{
    if(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink())throw Error('holders is not a real directory');
    entries=readdirSync(directory);
  }catch(error){if(missing(error))return {held:false,warnings};return {held:true,warnings:[`${dir}: pin holders unreadable: ${String(error)}`]};}
  let held=false;
  for(const entry of entries){
    const path=join(directory,entry);
    try{
      if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())throw Error('holder is not a regular file');
      const bytes=readFileSync(path,'utf8'),row=holder(path),state=observe(row.pid,row.identity);
      if(state==='gone'){
        // Both observation and compare/delete occur under the cache lock.
        if(reclaim&&readFileSync(path,'utf8')===bytes)rmSync(path);
      }else{
        held=true;
        if(state==='unknown')warnings.push(`${dir}: unreclaimable pin lease ${path}: owner identity unknown (${row.identity}, run ${row.run})`);
      }
    }catch(error){held=true;warnings.push(`${dir}: unreclaimable pin lease ${path}: ${String(error)}`);}
  }
  return {held,warnings};
}

/** One locked upkeep view. Normal live preparation is a notice; uncertainty
 * and detected corruption are warnings. No payload hashing belongs here. */
export function binaryPinDiagnostics(root:string,observe:PinOwnerObservation=observePinOwner):BinaryPinDiagnostics{
  if(!existsSync(root))return {warnings:[],notices:[]};
  return withLock(join(root,'.lock'),()=>{
    const result=stagingDiagnostics(root,observe,false);
    for(const dir of pins(root)){
      result.warnings.push(...inspect(dir,observe,false).warnings);
      try{
        const row=readCorruption(join(dir,CORRUPT));
        if(row)result.warnings.push(`${dir}: corrupt binary bundle member ${row.member}: expected ${row.expected}, got ${row.actual}`);
      }catch(error){result.warnings.push(`${dir}: unreadable corruption diagnostic: ${String(error)}`);}
    }
    return result;
  });
}

function prune(root:string,observe:PinOwnerObservation):void{
  stagingDiagnostics(root,observe,true);
  const unheld=pins(root).filter(dir=>{
    if(inspect(dir,observe,true).held)return false;
    try{readCorruption(join(dir,CORRUPT));return true;}
    catch{return false;} // Malformed/future state is read-only, including deletion.
  })
    .map(dir=>({dir,time:lstatSync(dir).mtimeMs})).sort((a,b)=>b.time-a.time||a.dir.localeCompare(b.dir));
  // Held folders do not consume the ten recently used, unheld cache slots.
  for(const old of unheld.slice(10))rmSync(old.dir,{recursive:true,force:true});
}

export function pinBinaries(options:Options):BinaryPin{
  if(!HASH.test(options.hash))throw Error('invalid binary pin hash '+options.hash);
  const root=resolve(options.root),observe=options.observe??observePinOwner;
  const identity=processIdentity(process.pid);
  if(!identity)throw Error('binary pin holder has no process identity');
  const row:Holder={version:1,run:resolve(options.run),token:randomUUID(),identity,pid:process.pid};
  const host=hostObservations(),now=options.now??(()=>host.now()),wallNow=options.wallNow??(()=>host.wallNow());
  mkdirSync(root,{recursive:true});
  const staging=createStaging(root,row),paths:Record<string,string>={},members:Record<string,string>={};
  const lock=join(root,'.lock');let lease:string|undefined;
  let published=false,stageOwned=true;
  const timing:PinTiming={waitMs:0,heldMs:0};
  const locked=(body:()=>void)=>{
    const started=now();
    withLock(lock,()=>{const entered=now();timing.waitMs+=entered-started;try{body();}finally{timing.heldMs+=now()-entered;}});
  };
  try{
    for(const [name,source]of Object.entries(options.binaries)){
      if(!/^[a-zA-Z0-9_-]+$/.test(name))throw Error('invalid pinned binary name '+name);
      if(!existsSync(source))continue;
      const to=join(staging,name);copyFileSync(source,to);chmodSync(to,0o555);
      members[name]=createHash('sha256').update(readFileSync(to)).digest('hex');
      const fd=openSync(to,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
    }
    if(members.nts!==options.hash)
      throw Error('compiler changed while staging binary pin');
    const pairs=Object.entries(members).sort(([a],[b])=>a<b?-1:a>b?1:0);
    const bundleSha256=createHash('sha256').update(JSON.stringify(pairs)).digest('hex'),dir=join(root,bundleSha256);
    const leasePath=join(dir,'holders',row.token+'.json');lease=leasePath;
    for(const name of Object.keys(members))paths[name]=join(dir,name);
    // Complete and flush the holder privately, too. No fsync (which can wait
    // for unrelated copying) belongs inside the cache's publication lock.
    const stagedLease=join(staging,'holders',row.token+'.json');durableRecord(stagedLease,row);
    locked(()=>{
      // A new bundle is published complete. Existing immutable members are
      // verified after leasing, outside the lock, and are never rewritten.
      if(!existsSync(dir)){renameSync(staging,dir);stageOwned=false;}
      else{
        mkdirSync(join(dir,'holders'),{recursive:true});
        renameSync(stagedLease,leasePath);
      }
      published=true;
    });
    for(const [name,digest]of pairs){
      const actual=createHash('sha256').update(readFileSync(paths[name]!)).digest('hex');
      if(actual!==digest){
        reportCorruption(root,dir,row,{version:1,member:name,expected:digest,actual});
        throw Error('pinned bundle member digest mismatch: '+paths[name]);
      }
    }
    locked(()=>{const touched=new Date(wallNow());utimesSync(dir,touched,touched);prune(root,observe);});
    let released=false;
    return {paths,bundleSha256,members,timing,release:()=>{
      if(released)return;
      withLock(lock,()=>{
        const current=holder(leasePath);
        if(JSON.stringify(current)!==JSON.stringify(row))throw Error('binary pin lease changed: '+leasePath);
        rmSync(leasePath);released=true;
        // Release must not make an old folder recent. The same retention rule
        // applies immediately after a run ends, including the last holder.
        prune(root,observe);
      });
    }};
  }catch(error){
    if(published&&lease){const failedLease=lease;withLock(lock,()=>{if(JSON.stringify(holder(failedLease))===JSON.stringify(row))rmSync(failedLease);});}
    throw error;
  }finally{if(stageOwned)rmSync(staging,{recursive:true,force:true});}
}
