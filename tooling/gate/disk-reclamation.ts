import {withBuildLock} from '../conformance/pin-lock.ts';
import {targetScratch,type TargetLock} from '../full-check/keep.ts';
import {DiskState,DiskTransactions,type DiskIntent} from './disk-transaction.ts';
import {ClaimReceipt,GitReceipt,DetachRecord,linkMovedCheckout,prepareCheckoutRepair,readCheckoutMove,syncDiskDirectory,type CheckoutMove} from './disk-preparation.ts';
import type {TreePin} from '../landing/tree-pin.ts';
// Reclaim only rebuildable outputs and clean, unbuilt pool worktrees. The
// owner prepares outside the pool lock, commits a bounded detach under it,
// then drains the detached payload outside it.
import {appendFileSync,chmodSync,existsSync,lstatSync,readFileSync,readdirSync,realpathSync,rmSync,mkdirSync,renameSync,rmdirSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {durableRecord} from './durable-record.ts';
import {ToolingInstrumentError} from '../differential/command-entry/instrument.ts';
import {basename,dirname,join,resolve,sep} from 'node:path';
import {userInfo} from 'node:os';
import {worktrees,type Git} from '../landing/git.ts';
import {assertNoProcessUsers} from '../landing/tree-users.ts';
import {GateResource} from './gate-resource.ts';
import { assertNoHereRestore } from '../landing/here-restore-record.ts';
import {gitArguments} from './git-arguments/main.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {buildGeneration,buildGenerationFromInputs,type BuildOutputName} from './build-completion.ts';
import {assertStateVersion} from './state-version.ts';
import {workerPresence,assertWorkerPresenceWritable,removeWorkerPresence} from '../landing/pool-presence.ts';
import type {HostObservations} from './host-observations.ts';

export type ReclaimTarget={tree:string;target:string;service:boolean;lock?:TargetLock};
export type ReclaimKind='obsolete-profile'|'unbuilt-checkout'|'free-build-output'|'detached-build-output'|'test-scratch'|'legacy-scratch';
export type ReclaimRemoval={root:string;kind:ReclaimKind;allocatedBytes:number;freeBytesChange:number;facts:string[];tree?:string;task?:string};
export type ReclaimReport={triggered:boolean;lockHeldMs:number;maxLockHeldMs:number;before:number;after:number;triggerBytes:number;goalBytes:number;
  removed:ReclaimRemoval[];kept:{root:string;reason:string;routine:boolean}[]};
export type ReclaimOwnership=(tree:string,target:string,ownPin?:TreePin)=>readonly string[]|void;
export type ReclaimOptions={
  pool:{dir:string;git:Git};host:HostObservations;coldBytes:number;state?:DiskState;
  claimReceipt?:()=>ClaimReceipt;
  snapshot:()=>{freeBytes:number;floorBytes:number;reservedBytes:number};
  protectedRoots:()=>readonly {root:string;target:string}[];
  services:readonly ReclaimTarget[];ownership:ReclaimOwnership;
  locked?:<T>(body:()=>T,operation?:string,root?:string)=>T;
  /** Fixture deletion barrier; the production remover remains the owner. */
  removePayload?:(path:string,kind:ReclaimKind,remove:()=>void)=>void;
  /** The ordinary idle upkeep uses the same remover and safety checks. */
  maintenance?:{before:number;keep:number};
};
type Identity={path:string;dev:number;ino:number;uid:number};
type Candidate={tree:string;root:string;kind:ReclaimKind;identity:Identity[];service:boolean;target:string;movedAt:number;branch?:string;lock?:TargetLock};
class TaskBranch extends Error{}
const under=(root:string,path:string)=>path===root||path.startsWith(root+sep);
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);

function physical(path:string):Identity[]{
  const parts:Identity[]=[];
  for(let current=resolve(path);;current=dirname(current)){
    const info=lstatSync(current);
    if(!info.isDirectory()||info.isSymbolicLink())throw Error('non-directory or aliased root: '+current);
    if(current===resolve(path)&&info.uid!==process.getuid?.())throw Error('foreign root owner: '+current);
    parts.push({path:current,dev:info.dev,ino:info.ino,uid:info.uid});
    if(dirname(current)===current)return parts;
  }
}
function sameRoot(expected:Identity[]):void{
  const actual=physical(expected[0]!.path);
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('root or ancestor identity changed: '+expected[0]!.path);
}
function writable(path:string):void{
  const info=lstatSync(path);
  if(!info.isDirectory()||info.isSymbolicLink())return;
  if(info.uid!==process.getuid?.())throw Error('foreign output owner: '+path);
  if((info.mode&0o700)!==0o700)chmodSync(path,(info.mode&0o7777)|0o700);
  for(const entry of readdirSync(path,{withFileTypes:true}))if(entry.isDirectory())writable(join(path,entry.name));
}
function gitRead(git:Git,args:readonly string[],cwd=git.root):string{
  return infrastructureProbe({purpose:'disk reclamation Git ownership',command:'git',args:gitArguments(args),cwd,
    ...(git.env?{env:git.env}:{})}).stdout.replace(/\n$/,'');
}
function missing(error:unknown):boolean{return (error as NodeJS.ErrnoException).code==='ENOENT';}
function isDirectory(path:string):boolean{
  try{const info=lstatSync(path);if(info.isSymbolicLink())throw Error('aliased output root: '+path);return info.isDirectory();}
  catch(error){if(missing(error))return false;throw error;}
}

export type UnitTreeOwnership={unit:string;workingDirectory:string;rootDirectory:string;
  commands:{property:'ExecStartPre'|'ExecStart'|'ExecStartPost';path:string;args:string[]}[]};
/** busctl preserves actual argument boundaries, including spaces and semicolons. */
export function parseUnitTreeOwnership(unit:string,text:string):UnitTreeOwnership{
  function unreadable(property:string,value:unknown):never{throw Error('unreadable unit '+property+': '+unit+'; value='+JSON.stringify(value));}
  const executions=['ExecStartPre','ExecStart','ExecStartPost'] as const;
  const properties=['WorkingDirectory','RootDirectory',...executions] as const;
  const lines=text.trim().split('\n');
  if(lines.length!==properties.length)unreadable('directories/properties',text);
  const rows=lines.map((line,index)=>{
    const property=properties[index]!;
    let row:unknown;
    try{row=JSON.parse(line);}catch{unreadable(property,line);}
    if(!row||typeof row!=='object'||!('type' in row)||!('data' in row))unreadable(property,row);
    return row as {type:unknown;data:unknown};
  });
  for(const index of [0,1]){
    const row=rows[index]!;
    if(row.type!=='s'||typeof row.data!=='string')unreadable(properties[index]!,row);
  }
  const commands=executions.flatMap((property,index)=>{
    const row=rows[index+2]!;
    if(row.type!=='a(sasbttttuii)'||!Array.isArray(row.data))unreadable(property,row);
    return (row.data as unknown[]).map((entry:unknown)=>{
      if(!Array.isArray(entry)||entry.length!==10||typeof entry[0]!=='string'||!entry[0].startsWith('/')||
        !Array.isArray(entry[1])||entry[1].some(arg=>typeof arg!=='string'))unreadable(property,entry);
      return {property,path:entry[0],args:[...entry[1]] as string[]};
    });
  });
  return {unit,workingDirectory:rows[0]!.data as string,rootDirectory:rows[1]!.data as string,commands};
}
export function assertUnitTreeUnused(roots:readonly string[],reading:UnitTreeOwnership):void{
  // A path that cannot exist walks up to its nearest existing ancestor:
  // ENOENT, ENOTDIR, and ENAMETOOLONG only while the ancestor still holds a
  // component longer than NAME_MAX (as a `node -e` script argument does),
  // since no such name can exist. Once those are stripped, ENAMETOOLONG means
  // a prefix past PATH_MAX whose components may all exist, symlinks among
  // them, which a textual suffix would never follow: that refuses, as every
  // other error does.
  const NAME_MAX=255;
  const physicalPath=(path:string,field:string):string=>{
    let ancestor=path;const suffix:string[]=[];
    for(;;){
      try{return resolve(realpathSync.native(ancestor),...suffix);}
      catch(error){
        const code=(error as NodeJS.ErrnoException).code;
        const absent=code==='ENOENT'||code==='ENOTDIR'||
          code==='ENAMETOOLONG'&&ancestor.split(sep).some(name=>Buffer.byteLength(name)>NAME_MAX);
        if(!absent||dirname(ancestor)===ancestor)throw Error('unreadable unit '+reading.unit+' '+field+' '+path,{cause:error});
        suffix.unshift(basename(ancestor));ancestor=dirname(ancestor);
      }
    }
  };
  const physicalRoots=roots.map(root=>physicalPath(root,'candidate root'));
  const check=(path:string,field:string)=>{
    if(roots.some(root=>under(resolve(root),path)||under(resolve(root),resolve(path))))throw Error('unit '+reading.unit+' owns '+field+' '+path);
    // Preserve component order for the kernel's symlink/.. resolution. A
    // future path retains its nearest existing physical ancestor. This is a
    // conservative ownership guard, never a claim that the endpoint exists.
    const physical=physicalPath(path,field);
    if(physicalRoots.some(root=>under(root,physical)))throw Error('unit '+reading.unit+' owns '+field+' '+path+' -> '+physical);
    return physical;
  };
  // D-Bus encodes missing-ok with ! (the unit-file spelling is -), and
  // the user's home as ~. Other relative/unknown forms refuse below.
  const working=reading.workingDirectory.replace(/^!/, '');
  if((!working&&reading.workingDirectory)||working&&working!=='~'&&!working.startsWith('/'))throw Error('unresolved unit WorkingDirectory: '+reading.unit);
  const cwd=working==='~'?userInfo().homedir:working;
  for(const [field,path] of [['WorkingDirectory',cwd],['RootDirectory',reading.rootDirectory]] as const){
    if(!path)continue;
    if(!path.startsWith('/'))throw Error('unresolved unit '+field+': '+reading.unit);
    const physical=check(path,field);
    if(field==='RootDirectory'&&physicalRoots.some(root=>under(physical,root)))throw Error('unit '+reading.unit+' owns RootDirectory '+path+' -> '+physical);
  }
  for(const command of reading.commands){
    check(command.path,command.property+' path');
    for(const argument of command.args){
      // Only the actual property values are inspected. No environment or
      // argument-file contents, shell source, or application option grammar.
      const value=argument.startsWith('-')&&argument.includes('=')?argument.slice(argument.indexOf('=')+1):argument;
      if(value.startsWith('/'))check(value,command.property+' argument');
      else if(cwd&&!value.startsWith('-'))check(cwd+'/'+value,command.property+' argument');
    }
  }
}
/** A queued/starting service owns its execution inputs before /proc exposes
 * the future child. Query precisely these five properties as typed values. */
export function assertNoUnitUsers(roots:readonly string[],ownedUnits?:readonly string[]):void{
  const listed=infrastructureProbe({purpose:'disk reclamation unit ownership',command:'systemctl',
    args:['--user','list-units','--all','--type=service','--output=json']});
  const units=JSON.parse(listed.stdout) as {unit:string;active:string}[];
  const inactive=(unit:string):boolean=>{
    const current=infrastructureProbe({purpose:'recheck departed disk unit '+unit,command:'systemctl',
      args:['--user','show',unit,'--property=LoadState,ActiveState'],exits:'classify'});
    return /^(?:ActiveState=inactive)$/m.test(current.stdout)&&/^(?:LoadState=(?:not-found|loaded))$/m.test(current.stdout);
  };
  for(const {unit} of units.filter(row=>row.active!=='inactive'&&(!ownedUnits||ownedUnits.includes(row.unit)))){
    const object=infrastructureProbe({purpose:'bind disk unit '+unit,command:'busctl',args:['--user','--json=short','call',
      'org.freedesktop.systemd1','/org/freedesktop/systemd1','org.freedesktop.systemd1.Manager','GetUnit','s',unit],exits:'classify'});
    if(object.status!==0){if(inactive(unit))continue;throw Error('unreadable disk unit identity: '+unit);}
    const reply=JSON.parse(object.stdout) as {type:unknown;data:unknown};
    if(reply.type!=='o'||!Array.isArray(reply.data)||reply.data.length!==1||typeof reply.data[0]!=='string'||!reply.data[0].startsWith('/org/freedesktop/systemd1/unit/'))throw Error('invalid disk unit identity: '+unit);
    const properties=infrastructureProbe({purpose:'disk unit execution ownership '+unit,command:'busctl',args:['--user','--json=short','get-property',
      'org.freedesktop.systemd1',reply.data[0],'org.freedesktop.systemd1.Service','WorkingDirectory','RootDirectory','ExecStartPre','ExecStart','ExecStartPost'],exits:'classify'});
    if(properties.status!==0){if(inactive(unit))continue;throw Error('unreadable disk unit properties: '+unit);}
    assertUnitTreeUnused(roots,parseUnitTreeOwnership(unit,properties.stdout));
  }
}
export const liveReclaimOwnership:ReclaimOwnership=(tree,target,ownPin)=>{
  assertNoUnitUsers([tree,target]);return assertNoProcessUsers([tree,target],{ownPin});
};

const scratchPolicy=()=>targetScratch();
const cargoProfiles=['nts-dev','clippy','debug','release'] as const;
const cargoMetadata=/^(?:tmp|CACHEDIR\.TAG|\.rustc_info(?:[^/]*)\.json|\.rustdoc_fingerprint\.json)$/;
/** Inventory only. Writer attribution alone grants no deletion; the scratch
 * owner separately checks declared namespaces and free-tree ownership. */
export function targetLeftovers(tree:string):{root:string;writer:string}[]{
  const target=join(tree,'target');
  if(!isDirectory(target))return [];
  const policy=scratchPolicy();
  return readdirSync(target).filter(name=>!cargoProfiles.some(profile=>profile===name)&&!cargoMetadata.test(name)).sort().map(name=>({
    root:join(target,name),writer:policy.names[name]??(policy.legacy.includes(name)?'legacy compiler test scratch via compiler/test-support/scratch.rs':
      name.startsWith('interop-')?'legacy interop scratch via tooling/gate/all.sh':
      name.endsWith('-tests')?'compiler integration tests via compiler/test-support/scratch.rs':
      name==='gate-costs'?'tooling/gate/step-scheduling.ts':
      name==='gate-scope-owner.json'||name==='gate-scope-owner.json.lock'?'tooling/gate/run.mjs; tooling/landing/run.ts':
      name==='.gate-run.lock'?'tooling/gate/run.mjs':
      name==='tooling-types.tsbuildinfo'?'tooling/tsconfig.json':
      /^\d+-/.test(name)?'historical issue #'+name.split('-')[0]+' probe/log; writer unknown':'unknown'),
  }));
}
/** A completion marker that exists but cannot be judged: unparseable, of a
 * future version, or naming no valid generation. Its message is the reader's
 * own, so reclamation's retention reason is unchanged. Readers keep the profile. */
export class ProfileMarkerError extends Error{
  readonly file:string;
  constructor(file:string,message:string,cause?:unknown){super(message,cause===undefined?undefined:{cause});this.name='ProfileMarkerError';this.file=file;}
}
/** A Cargo profile's completion marker judged against `current`, the
 * generation its tree builds now; null when that generation is unknown. A
 * missing marker or an unknown generation is 'unknown', which protects it. */
export function profileMarker(output:string,current:string|null):'current'|'obsolete'|'unknown'{
  const file=join(output,'.nts-complete.json');
  if(!existsSync(file))return 'unknown';
  const text=readFileSync(file,'utf8');
  let record:{version:number;generation:unknown};
  try{record=JSON.parse(text) as typeof record;}catch(error){throw new ProfileMarkerError(file,errorText(error),error);}
  try{assertStateVersion(record,1,file);}catch(error){throw new ProfileMarkerError(file,errorText(error),error);}
  if(record.version!==1||typeof record.generation!=='string'||!/^[a-f0-9]{64}$/.test(record.generation))throw new ProfileMarkerError(file,'invalid profile generation '+file);
  if(current===null)return 'unknown';
  return record.generation===current?'current':'obsolete';
}
export type TargetProfile={root:string;profile:'debug'|BuildOutputName;state:'obsolete'|'current'|'unknown';reason:string};
/** Top-level `debug` is Cargo's default dev profile. No gate, test or Clippy
 * route builds it; the test262 protocol's `cargo run` fallback, taken when
 * NTS_TEST262_PROTOCOL is unset, still rebuilds that one binary there. */
export const DEBUG_PROFILE_REASON="Cargo's default dev profile; no gate, test or Clippy route builds it; the test262 protocol's cargo-run fallback (NTS_TEST262_PROTOCOL unset) rebuilds it";
/**
 * The one obsolete-profile rule, shared by reclamation and the hourly count.
 * Top-level `debug` (never clippy/debug) is always obsolete: nothing nts
 * needs is built there (DEBUG_PROFILE_REASON). nts-dev and clippy are
 * obsolete only when a valid completion marker names another generation
 * than `generation` gives; a current marker, a missing one and an unknown
 * generation protect them.
 * `release` is never judged. Lazy, so a caller acting on each row observes
 * the filesystem in the order it always did; a corrupt marker throws
 * ProfileMarkerError and is never read as unknown.
 */
export function* targetProfiles(target:string,generation:(name:BuildOutputName)=>string|null):Generator<TargetProfile>{
  const debug=join(target,'debug');
  if(isDirectory(debug))yield {root:debug,profile:'debug',state:'obsolete',reason:DEBUG_PROFILE_REASON};
  for(const name of ['nts-dev','clippy'] as const){
    const root=join(target,name);
    if(!isDirectory(root))continue;
    const current=generation(name),state=profileMarker(root,current);
    yield {root,profile:name,state,reason:state==='obsolete'?'completion marker names an older generation than its tree builds now'
      :state==='current'?'completion marker names the generation its tree builds now'
      :current===null?"its tree's build generation is unknown":'no completion marker'};
  }
}
function cargoCache(target:string):boolean{
  const file=join(target,'CACHEDIR.TAG');
  try{return lstatSync(file).isFile()&&!lstatSync(file).isSymbolicLink()&&readFileSync(file,'utf8').startsWith('Signature: 8a477f597d28d172789f06886806bc55');}
  catch(error){if(missing(error))return false;throw error;}
}
/** Include routine warmth/branch decisions too when admission actually refuses. */
export function describeReclamation(...reports:(ReclaimReport|null|undefined)[]):string{
  const lines=reports.flatMap(report=>report?[
    ...report.removed.map(row=>'removed '+row.root+': '+row.kind+'; '+row.allocatedBytes+' allocated bytes'),
    ...report.kept.map(row=>'kept '+row.root+': '+row.reason),
  ]:[]);
  return lines.length?'\nDisk reclamation:\n'+[...new Set(lines)].join('\n'):'';
}

export const DISK_TRASH='.disk-trash';
const trashId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const reclaimKinds:readonly ReclaimKind[]=['obsolete-profile','unbuilt-checkout','free-build-output','detached-build-output','test-scratch','legacy-scratch'];
type TrashManifest={version:1;id:string;at:number;state:'prepared'|'detached';identity:{dev:number;ino:number;uid:number};removal:ReclaimRemoval;checkout?:CheckoutMove};
export type TrashEntry={path:string;allocatedBytes:number|null;ageMs:number;kind:ReclaimKind|null;diagnostic?:string};
function trashRoot(pool:string):string{return join(pool,DISK_TRASH);}
function readTrash(entry:string,name='manifest.json'):TrashManifest{
  physical(entry);
  const file=join(entry,name),row=JSON.parse(readFileSync(file,'utf8')) as TrashManifest;
  assertStateVersion(row,1,file);
  if(row.version!==1||!trashId.test(row.id)||row.id!==basename(entry)||!Number.isSafeInteger(row.at)||row.at<0||!['prepared','detached'].includes(row.state)
    ||!row.identity||[row.identity.dev,row.identity.ino,row.identity.uid].some(value=>!Number.isSafeInteger(value)||value<0)
    ||!row.removal||!reclaimKinds.includes(row.removal.kind)||typeof row.removal.root!=='string'||resolve(row.removal.root)!==row.removal.root
    ||!Number.isSafeInteger(row.removal.allocatedBytes)||row.removal.allocatedBytes<0||!Array.isArray(row.removal.facts))throw Error('invalid disk trash manifest: '+file);
  if(row.checkout!==undefined){
    if(row.removal.kind!=='unbuilt-checkout')throw Error('invalid disk trash checkout kind: '+file);
    readCheckoutMove(row.checkout,row.removal.root);
  }
  return row;
}
/** One current entry observation. A retired entry is absence, not a damaged
 * manifest. Reclamation calls this again under the pool lock before adopting
 * a listed entry; status may use it without changing ownership. */
function observeTrash(path:string,now:number):TrashEntry|undefined{
  try{const row=readTrash(path);return {path,allocatedBytes:row.removal.allocatedBytes,ageMs:Math.max(0,now-row.at),kind:row.removal.kind};}
  catch(error){
    let info;try{info=lstatSync(path);}catch(departed){if(missing(departed))return;throw departed;}
    return {path,allocatedBytes:null,ageMs:Math.max(0,now-info.mtimeMs),kind:null,diagnostic:errorText(error)};
  }
}
/** Read-only visibility. Unknown entries stay named and gain no deletion grant. */
export function diskTrash(pool:string,now:number):TrashEntry[]{
  const root=trashRoot(pool);if(!existsSync(root))return [];
  physical(root);
  return readdirSync(root).sort().flatMap(name=>{
    const entry=observeTrash(join(root,name),now);return entry?[entry]:[];
  });
}

function payloadIdentity(path:string,row:TrashManifest):void{
  const info=lstatSync(path);
  if(!info.isDirectory()||info.isSymbolicLink()||info.dev!==row.identity.dev||info.ino!==row.identity.ino||info.uid!==row.identity.uid)throw Error('disk trash payload identity changed: '+path);
}
function removeTrashCheckout(options:ReclaimOptions,payload:string,drainer:GateResource,absent=false):void{
  const {git}=options.pool;
  const removed=infrastructureProbe({purpose:'remove detached disk trash checkout',command:'git',
    args:gitArguments(['worktree','remove',...(absent?['--force']:[]),'--',payload]),cwd:git.root,stdio:drainer.stdio('pipe'),...(git.env?{env:git.env}:{}),exits:'classify'});
  if(removed.status!==0)throw Error('Git retained disk trash checkout '+payload+': '+removed.stderr.trim());
}
function present(path:string):boolean{try{lstatSync(path);return true;}catch(error){if(missing(error))return false;throw error;}}
/** Each drainer acquires under the pool lock, but keeps only its entry owner
 * during deletion. A crash at any point leaves a manifest for the next pass. */
function drainTrash(options:ReclaimOptions,entry:string,locked:<T>(body:()=>T,operation?:string,root?:string)=>T,owner:GateResource):ReclaimRemoval|null{
  let open=true;
  try{
    const row=readTrash(entry),payload=join(entry,'payload'),before=options.snapshot().freeBytes;
    if(present(payload)){
      payloadIdentity(payload,row);
      if(row.checkout){
        const common=gitRead(options.pool.git,['rev-parse','--path-format=absolute','--git-common-dir']);
        const repair=prepareCheckoutRepair(row.checkout,row.removal.root,payload,common);
        locked(repair,'trash-checkout-repair',payload);
      }
      if(row.state==='prepared'){row.state='detached';durableRecord(join(entry,'manifest.json'),row);}
      rmSync(join(entry,'manifest.detached.json'),{force:true});
      const remove=()=>{
        if(row.removal.kind==='unbuilt-checkout')removeTrashCheckout(options,payload,owner);
        else{writable(payload);rmSync(payload,{recursive:true});}
      };
      if(options.removePayload)options.removePayload(payload,row.removal.kind,remove);else remove();
      if(existsSync(payload))throw Error('disk trash remover retained payload: '+payload);
    }
    if(row.state==='detached'&&row.removal.kind==='unbuilt-checkout'){
      // A crash after Git's byte removal but before registry retirement leaves
      // a missing worktree. Force is allowed only for that absent payload;
      // this transaction removes metadata, never unexpected checkout bytes.
      if(present(payload))throw Error('disk trash payload reappeared: '+payload);
      if(worktrees(options.pool.git).some(tree=>resolve(tree.path)===payload))removeTrashCheckout(options,payload,owner,true);
    }
    // Prepared but never renamed: the original remains outside our grant.
    const removal=row.state==='detached'?{...row.removal,freeBytesChange:0}:null;
    if(removal){
        removal.freeBytesChange=options.snapshot().freeBytes-before;
        const log=join(options.pool.dir,'.disk-reclaim.log');
        const seen=existsSync(log)&&readFileSync(log,'utf8').trim().split('\n').filter(Boolean).some(line=>(JSON.parse(line) as {trashId?:string}).trashId===row.id);
        if(!seen)appendFileSync(log,JSON.stringify({at:options.host.wallNow(),trashId:row.id,...removal})+'\n');
    }
    locked(()=>{
      // Only small owner metadata is removed under the pool lock.
      owner.close();open=false;unlinkSync(join(entry,'.drain.lock'));
      rmSync(join(entry,'manifest.detached.json'),{force:true});
      unlinkSync(join(entry,'manifest.json'));rmdirSync(entry);
    },'trash-finalize',entry);
    return removal;
  }finally{if(open)owner.close();}
}

/** Setup and final metadata cleanup can leave no manifest. Only an empty
 * UUID envelope with its one known lock file is eligible; no payload grant
 * is inferred from a missing manifest. Its kernel owner excludes publication. */
function emptyEnvelope(entry:string):boolean{
  if(!trashId.test(basename(entry)))return false;
  physical(entry);
  const children=readdirSync(entry);
  const pending='manifest.detached.json';
  if(children.some(name=>name!=='.drain.lock'&&name!==pending))return false;
  if(children.includes(pending)){
    const info=lstatSync(join(entry,pending));
    if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid?.())return false;
    try{if(readTrash(entry,pending).state!=='detached')return false;}catch{return false;}
  }
  const file=join(entry,'.drain.lock');
  if(children.includes('.drain.lock')){const info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size!==0||info.uid!==process.getuid?.())return false;}
  const owner=GateResource.tryAcquire(file);if(!owner)return false;
  try{
    if(readdirSync(entry).some(name=>name!=='.drain.lock'&&name!==pending))return false;
    rmSync(join(entry,pending),{force:true});
  }finally{owner.close();}
  unlinkSync(file);rmdirSync(entry);return true;
}

export function reclaimDisk(options:ReclaimOptions):ReclaimReport{
  const {pool,host,coldBytes}=options;
  const state=options.state??new DiskState(new DiskTransactions(join(pool.dir,".lock"),host));
  const take=options.locked??(<T>(body:()=>T,operation='reclaim-metadata',root=pool.dir)=>state.transactions.run(operation,root,body));
  const previousHeldMs=state.transactions.totalLockHeldMs;
  let lockHeldMs=0,maxLockHeldMs=0;
  const locked=<T>(body:()=>T,operation="reclaim-metadata",root=pool.dir):T=>take(()=>{
    const start=host.now();try{return body();}finally{const held=host.now()-start;lockHeldMs+=held;maxLockHeldMs=Math.max(maxLockHeldMs,held);}
  },operation,root);
  const recovered:ReclaimRemoval[]=[],trashKept:ReclaimReport['kept']=[];
  for(const listed of diskTrash(pool.dir,host.wallNow())){
    // Listing is only a discovery hint. The previous owner may publish or
    // retire this envelope before we acquire the pool lock. Classify afresh
    // and acquire its drainer in one transaction, so no stale diagnostic or
    // second acquisition can race retirement.
    const entry=locked(()=>{
      const entry=observeTrash(listed.path,host.wallNow());
      if(!entry)return null;

      if(entry.ageMs>3_600_000)trashKept.push({root:entry.path,reason:'stuck disk trash drain (older than one hour)',routine:false});
      return entry;
    },"trash-adopt",listed.path);
    if(!entry)continue;
    if(entry.diagnostic){
      try{if(!emptyEnvelope(entry.path))trashKept.push({root:entry.path,reason:entry.diagnostic,routine:false});}
      catch(error){if(!missing(error))throw error;}
      continue;
    }
    // A kernel drainer acquisition may launch flock: never under the pool lock.
    let identity:Identity[];
    try{identity=physical(entry.path);}catch(error){if(missing(error))continue;throw error;}
    const owner=GateResource.tryAcquire(join(entry.path,'.drain.lock'));if(!owner)continue;
    try{sameRoot(identity);}catch(error){owner.close();if(!missing(error))trashKept.push({root:entry.path,reason:errorText(error),routine:false});continue;}

    try{const row=drainTrash(options,entry.path,locked,owner);if(row)recovered.push(row);}
    catch(error){if(error instanceof ToolingInstrumentError)throw error;trashKept.push({root:entry.path,reason:'disk trash drain retained: '+errorText(error),routine:false});}
  }

  const first=options.snapshot(),trigger=first.floorBytes+first.reservedBytes+coldBytes;
  const report:ReclaimReport={get lockHeldMs(){return (options.locked&&!options.state?lockHeldMs:0)+state.transactions.totalLockHeldMs-previousHeldMs;},get maxLockHeldMs(){return Math.max(maxLockHeldMs,state.transactions.maximumLockHeldMs);},triggered:first.freeBytes<trigger,before:first.freeBytes,after:first.freeBytes,
    triggerBytes:trigger,goalBytes:trigger+coldBytes,removed:recovered,kept:trashKept};
  if(!report.triggered&&!options.maintenance)return report;
  const keep=(root:string,error:unknown,routine=error instanceof TaskBranch)=>report.kept.push({root,reason:errorText(error),routine});
  const revision=gitRead(pool.git,['rev-parse','refs/heads/main']);
  const policyFile=(path:string,required:boolean):string=>{
    const row=gitRead(pool.git,['ls-tree','-z',revision,'--',path]);
    if(!row){if(required)throw Error('missing current build policy '+path);return '';}
    const match=/^100(?:644|755) blob ([0-9a-f]{40})\t([^\0]+)\0$/.exec(row);
    if(!match||match[2]!==path)throw Error('current build policy is not a regular tracked file: '+path);
    return gitRead(pool.git,['cat-file','blob',match[1]!]);
  };
  const manifest=policyFile('Cargo.toml',true),toolchain=policyFile('rust-toolchain.toml',false);
  const generations=Object.fromEntries((['nts-dev','clippy'] as const).map(name=>[name,buildGenerationFromInputs(manifest,toolchain,name)])) as Record<BuildOutputName,string>;
  const registered=()=>worktrees(pool.git).filter(tree=>dirname(resolve(tree.path))===resolve(pool.dir)&&/^[1-9][0-9]*$/.test(basename(tree.path)));
  const free=(tree:string):void=>{
    const current=registered().find(row=>resolve(row.path)===tree);
    if(!current)throw Error('worktree is no longer registered');
    if(current.branch)throw new TaskBranch('branch remains owned: '+current.branch);
    if(gitRead(pool.git,['status','--porcelain','--untracked-files=all'],tree))throw Error('uncommitted changes');
    if(Number(gitRead(pool.git,['rev-list','--count',revision+'..HEAD'],tree))!==0)throw Error('unpublished detached commits');
  };
  const detached=(tree:string,branch:string):number=>{
    const current=registered().find(row=>resolve(row.path)===tree);
    if(!current||current.branch!==branch)throw Error('task branch or worktree registration changed: '+tree);
    const presence=workerPresence(tree,branch);
    if(presence.diagnostic)throw Error(presence.diagnostic);
    if(presence.state!=='detached')throw new TaskBranch('branch remains owned by an attached worker: '+branch);
    return presence.detachedAt!;
  };
  const marker=(path:string,name:BuildOutputName,tree?:string)=>profileMarker(path,tree?(existsSync(join(tree,'Cargo.toml'))?buildGeneration(tree,name):null):generations[name]);
  const scratch=scratchPolicy();
  const scratchKind=(name:string):'test-scratch'|'legacy-scratch'|null=>scratch.names[name]?'test-scratch':scratch.legacy.includes(name)||/^interop-[a-zA-Z0-9_-]+$/.test(name)?'legacy-scratch':null;
  const assertUnclaimed=(root:string):void=>{
    const owner=options.protectedRoots().flatMap(owner=>[owner.root,owner.target]).find(path=>under(resolve(path),root)||under(root,resolve(path)));
    if(owner)throw Error('live lease or build claim: '+owner);
  };
  const candidates:Candidate[]=[];
  const poolTargets:ReclaimTarget[]=registered().map(tree=>({tree:resolve(tree.path),target:join(tree.path,'target'),service:false}));
  const add=(target:ReclaimTarget,root:string,kind:ReclaimKind,movedAt:number,branch?:string):void=>{
    candidates.push({tree:target.tree,root,kind,identity:physical(root),service:target.service,target:target.target,movedAt,...(branch?{branch}:{}),...(target.lock?{lock:target.lock}:{})});
  };
  const offerBuildOutput=(target:ReclaimTarget,kind:'free-build-output'|'detached-build-output',movedAt:number,branch?:string):void=>{
    const leftovers=targetLeftovers(target.tree),cache=cargoCache(target.target);
    for(const row of leftovers){
      if(kind==='free-build-output'&&scratchKind(basename(row.root)))continue;
      keep(row.root,'unrecognized target content; writer: '+row.writer,true);
    }
    if(!leftovers.length&&cache)add(target,target.target,kind,movedAt,branch);
    else for(const name of cargoProfiles){
      if(name==='debug'&&kind==='free-build-output')continue; // The obsolete-profile owner already offered it.
      const output=join(target.target,name);
      if(!isDirectory(output))continue;
      // A successful owner marker proves the profile even where older
      // writers omitted the top-level Cargo tag. Unknown siblings survive.
      const proven=cache||((name==='nts-dev'||name==='clippy')&&marker(output,name)!=='unknown');
      if(proven)add(target,output,kind,movedAt,branch);
      else keep(output,'profile has neither Cargo cache identity nor a completion marker');
    }
  };
  for(const target of [...poolTargets,...options.services]){
    const start=candidates.length;
    try{
      physical(target.tree);
      if(!target.service)assertNoHereRestore(target.tree);
      const branch=target.service?null:registered().find(row=>resolve(row.path)===target.tree)?.branch;
      if(branch){
        // An explicit detached worker lease offers only Cargo output, never
        // the checkout, its branch, or any work left in it. No upkeep eviction.
        if(report.triggered&&isDirectory(target.target))offerBuildOutput(target,'detached-build-output',detached(target.tree,branch),branch);
        else keep(target.tree,new TaskBranch('branch remains owned: '+branch));
        continue;
      }
      if(!target.service)free(target.tree);
      const movedText=target.service?'':gitRead(pool.git,['reflog','-1','--date=unix','--format=%gd','HEAD'],target.tree);
      const moved=/@\{(\d+)\}/.exec(movedText)?.[1];
      const movedAt=moved?Number(moved)*1000:lstatSync(target.tree).mtimeMs;
      if(!isDirectory(target.target)){
        if(!target.service&&!existsSync(target.target))add(target,target.tree,'unbuilt-checkout',movedAt);
        continue;
      }
      if(!target.service)for(const name of readdirSync(target.target)){
        const kind=scratchKind(name);
        if(kind&&isDirectory(join(target.target,name)))add(target,join(target.target,name),kind,movedAt);
      }
      for(const row of targetProfiles(target.target,name=>target.service?(existsSync(join(target.tree,'Cargo.toml'))?buildGeneration(target.tree,name):null):generations[name]))if(row.state==='obsolete')add(target,row.root,'obsolete-profile',movedAt);
      if(!target.service)offerBuildOutput(target,'free-build-output',movedAt);
    }catch(error){candidates.length=start;if(!missing(error))keep(target.tree,error);}
  }
  // Keep one useful free target under pressure, two during idle upkeep. Stale markers and mere empty folders cannot
  // displace a current completed generation; recent use breaks equal warmth.
  const warmTargets=poolTargets.filter(target=>candidates.some(row=>row.target===target.target&&row.kind==='free-build-output'));
  const warmth=(target:ReclaimTarget)=>['nts-dev','clippy'].filter(name=>isDirectory(join(target.target,name))&&marker(join(target.target,name),name as BuildOutputName)==='current').length;
  warmTargets.sort((a,b)=>warmth(b)-warmth(a)||(candidates.find(row=>row.target===b.target)?.movedAt??0)-(candidates.find(row=>row.target===a.target)?.movedAt??0)||a.tree.localeCompare(b.tree));
  const warmMinimum=report.triggered?1:Math.max(2,options.maintenance?.keep??2);
  const warmReason=warmMinimum===1?'one warm free target retained under pressure':'two warm free targets retained';
  const retained=new Set(warmTargets.filter(target=>warmth(target)>0).slice(0,warmMinimum).map(row=>row.target));
  const rank:Record<ReclaimKind,number>={'obsolete-profile':0,'test-scratch':1,'legacy-scratch':1,'unbuilt-checkout':2,'free-build-output':3,'detached-build-output':4};
  candidates.sort((a,b)=>rank[a.kind]-rank[b.kind]||a.movedAt-b.movedAt||a.root.localeCompare(b.root));
  for(const candidate of candidates){
    const {root,tree,kind}=candidate;
    const snapshot=options.snapshot();report.after=snapshot.freeBytes;
    const goal=snapshot.floorBytes+snapshot.reservedBytes+2*coldBytes;
    if(report.triggered&&snapshot.freeBytes>=goal)break;
    if(!report.triggered&&options.maintenance&&candidate.movedAt>=options.maintenance.before)continue;
    if(kind==='free-build-output'&&retained.has(candidate.target)){if(!report.kept.some(row=>row.root===candidate.target&&row.reason===warmReason))keep(candidate.target,warmReason,true);continue;}
    // A previous obsolete-profile removal may have consumed this candidate.
    if(!existsSync(root))continue;
    const removeCandidate=()=>{
    const held:{lock:GateResource|null;drainer:GateResource|null;entry:string|undefined;intent:DiskIntent|undefined}={lock:null,drainer:null,entry:undefined,intent:undefined};
    try{
      held.lock=GateResource.tryAcquire(tree+'.lock');if(!held.lock)throw Error('tree resource lock is held');
      // Service output can live beside its checkout. Fence the actual removal
      // root so admissions to that external target see the same intent.
      held.intent=state.begin(root,'reclaim');
      const allocatedBytes=host.allocatedBytes(root);
      const certify=()=>{
        if(!candidate.service)assertNoHereRestore(tree);
        sameRoot(candidate.identity);
        if(gitRead(pool.git,['rev-parse','refs/heads/main'])!==revision)throw Error('current build policy changed during reclamation');
        assertUnclaimed(root);
        if(candidate.branch)detached(tree,candidate.branch);
        else if(!candidate.service)free(tree);
        if(kind==='unbuilt-checkout'){
          assertWorkerPresenceWritable(tree);
          // Ignored user files also belong to their author. Only the linker's
          // exact shared input links may disappear with an unbuilt checkout.
          const ignored=gitRead(pool.git,['ls-files','--others','--ignored','--exclude-standard','-z'],tree).split('\0').filter(Boolean);
          for(const path of ignored){
            if(!lstatSync(join(tree,path)).isSymbolicLink()||realpathSync(join(tree,path))!==realpathSync(join(pool.git.root,path)))throw Error('ignored local data: '+path);
          }
          if(existsSync(join(tree,'target')))throw Error('checkout acquired build output');
        }else if(kind==='test-scratch'||kind==='legacy-scratch'){
          if(candidate.service||candidate.branch||dirname(root)!==candidate.target||scratchKind(basename(root))!==kind)throw Error('scratch is not in a free tree or declared namespace');
          if(gitRead(pool.git,['ls-files','--','target/'+basename(root)],tree))throw Error('tracked target scratch');
        }else if((kind==='free-build-output'||kind==='detached-build-output')&&root!==candidate.target){
          const name=basename(root);
          if(dirname(root)!==candidate.target||!cargoProfiles.some(profile=>profile===name))throw Error('unrecognized Cargo profile');
          if(gitRead(pool.git,['ls-files','--','target/'+name],tree))throw Error('tracked target content');
          const completed=(name==='nts-dev'||name==='clippy')&&marker(root,name)!=='unknown';
          if(!cargoCache(candidate.target)&&!completed)throw Error('profile has neither Cargo cache identity nor a completion marker');
        }else if(kind==='free-build-output'||kind==='detached-build-output'){
          if(gitRead(pool.git,['ls-files','--','target'],tree))throw Error('tracked target content');
          for(const name of ['nts-dev','clippy'] as const)if(isDirectory(join(root,name)))marker(join(root,name),name);
          const allowed=(name:string)=>cargoProfiles.some(profile=>profile===name)||cargoMetadata.test(name);
          for(const name of readdirSync(root))if(!allowed(name))throw Error('unrecognized target content: '+name);
          if(!cargoCache(root))throw Error('target lacks Cargo cache identity');
        }else if(basename(root)!=='debug'&&marker(root,basename(root) as BuildOutputName,candidate.service?tree:undefined)!=='obsolete')throw Error('profile is no longer obsolete');
      };
      const trash=trashRoot(pool.dir);mkdirSync(trash,{recursive:true});physical(trash);
      if(lstatSync(trash).dev!==candidate.identity[0]!.dev)throw Error('disk trash is on a different filesystem: '+root);
      held.entry=join(trash,randomUUID());mkdirSync(held.entry);held.drainer=GateResource.tryAcquire(join(held.entry,'.drain.lock'));
      if(!held.drainer)throw Error('new disk trash entry has an owner: '+held.entry);
      const entry=held.entry,drainer=held.drainer,payload=join(entry,'payload');
      let git:GitReceipt,policy:GitReceipt;
      const staged=state.prepared('reclaim-detach',root,()=>{
        const claims=options.claimReceipt?.()??new ClaimReceipt([join(pool.dir,'.disk-builds.json'),join(pool.dir,'.disk-builds.json.temporaries.json')]);
        try{
          state.assertIntent(held.intent!);
          certify();
          if(kind==='unbuilt-checkout'){
            if(!git.checkout)throw Error('checkout has no bounded linked-worktree move: '+tree);
            if(existsSync(join(git.checkout.gitDir,'locked')))throw Error('Git worktree is locked: '+tree);
            if(gitRead(pool.git,['ls-files','--stage','-z'],tree).split('\0').some(line=>line.startsWith('160000 ')))
              throw Error('submodule checkout is not a bounded relocation: '+tree);
          }
          const before=options.snapshot().freeBytes;
          const ownerFacts=options.ownership(tree,kind==='unbuilt-checkout'?join(tree,'target'):root)??[];
          // Every provenance check is repeated after slow ownership inspection.
          certify();
          const facts=['same dev/inode/uid and physical ancestors','no live lease/claim','resource lock held','no unit/cwd/exe/fd owner',candidate.branch?'explicit detached worker; task checkout retained':candidate.service?'service: obsolete generation only':'detached clean published worktree',...(candidate.lock?['writer mutex held: '+candidate.lock.path]:[]),...ownerFacts];
          const removal:ReclaimRemoval={root,kind,allocatedBytes,freeBytesChange:0,facts,...(candidate.branch?{tree,task:candidate.branch}:{})};
          if(!reclaimKinds.includes(kind))throw Error('unapproved disk reclamation kind: '+kind);
          const {dev,ino,uid}=candidate.identity[0]!;
          const manifest:TrashManifest={version:1,id:basename(entry),at:host.wallNow(),state:'prepared',identity:{dev,ino,uid},removal,
            ...(kind==='unbuilt-checkout'?{checkout:git.checkout!}:{})};
          // Preparation and its drainer acquisition are outside the pool lock.
          durableRecord(join(entry,'manifest.json'),manifest);
          const record=new DetachRecord(join(entry,'manifest.json'),{...manifest,state:'detached'});
          return {claims,git,policy,manifest,record,before};
        }catch(error){claims.close();throw error;}
      },approved=>{
        state.assertIntent(held.intent!);sameRoot(candidate.identity);
        // The shared lock is also the fence that pre-intent owners honor.
        // This commit contains no scan, Git command, or payload traversal.
        state.advance();
        renameSync(root,payload);
        if(approved.manifest.checkout){linkMovedCheckout(approved.manifest.checkout,payload);removeWorkerPresence(tree);}
        syncDiskDirectory(dirname(root));approved.record.publish();
        return {entry,drainer,before:approved.before};
      },30_000,{
        capture:()=>{git=new GitReceipt(tree,[join(root,'.nts-complete.json')]);policy=new GitReceipt(pool.git.root);},
        validate:approved=>approved.claims.valid()&&approved.git.valid()&&approved.policy.valid(),
        dispose:approved=>{approved.claims.close();approved.record.close();},
      });
      state.end(held.intent!);held.intent=undefined;
      held.lock?.close();held.lock=null;
      held.drainer=null; // drainTrash owns close, including on failure.
      const removal=drainTrash(options,staged.entry,locked,staged.drainer);
      report.after=options.snapshot().freeBytes;
      if(removal){removal.freeBytesChange=report.after-staged.before;report.removed.push(removal);}
    }catch(error){
      if(error instanceof ToolingInstrumentError)throw error;
      keep(held.entry&&present(join(held.entry,'payload'))?held.entry:root,error);
    }finally{try{if(held.intent)state.end(held.intent);}finally{held.lock?.close();held.drainer?.close();}}
    };
    try{
      if(candidate.lock){
        if(candidate.lock.owner!=='tooling/conformance/pin-lock.ts')throw Error('unknown reclamation lock owner: '+candidate.lock.owner);
        // The pin writer owns this mutex. Never hold the pool transaction
        // while acquiring it; wait zero so a live writer is a named keep.
        withBuildLock(removeCandidate,{lock:candidate.lock.path,wait:0,host:options.host});
      }else removeCandidate();
    }catch(error){keep(root,error);}


  }
  return report;
}
