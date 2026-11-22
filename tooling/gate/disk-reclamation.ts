// Reclaim only rebuildable outputs and clean, unbuilt pool worktrees. The
// owner fences and detaches under the pool lock, then drains outside it.
import {appendFileSync,chmodSync,existsSync,lstatSync,readFileSync,readdirSync,realpathSync,rmSync,mkdirSync,renameSync,rmdirSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {withLock} from '../landing/lock.ts';
import {durableRecord} from './durable-record.ts';
import {ToolingInstrumentError} from '../differential/command-entry/instrument.ts';
import {basename,dirname,join,resolve,sep} from 'node:path';
import {userInfo} from 'node:os';
import {worktrees,type Git} from '../landing/git.ts';
import {assertNoProcessUsers} from '../landing/tree-users.ts';
import {GateResource} from './gate-resource.ts';
import {gitArguments} from './git-arguments/main.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {buildGenerationFromInputs,type BuildOutputName} from './build-completion.ts';
import {assertStateVersion} from './state-version.ts';
import {workerPresence,assertWorkerPresenceWritable,removeWorkerPresence} from '../landing/pool-presence.ts';
import type {HostObservations} from './host-observations.ts';

export type ReclaimTarget={tree:string;target:string;service:boolean};
export type ReclaimKind='obsolete-profile'|'unbuilt-checkout'|'free-build-output'|'detached-build-output';
export type ReclaimRemoval={root:string;kind:ReclaimKind;allocatedBytes:number;freeBytesChange:number;facts:string[];tree?:string;task?:string};
export type ReclaimReport={triggered:boolean;lockHeldMs:number;before:number;after:number;triggerBytes:number;goalBytes:number;
  removed:ReclaimRemoval[];kept:{root:string;reason:string;routine:boolean}[]};
export type ReclaimOwnership=(tree:string,target:string)=>readonly string[]|void;
export type ReclaimOptions={
  pool:{dir:string;git:Git};host:HostObservations;coldBytes:number;
  snapshot:()=>{freeBytes:number;floorBytes:number;reservedBytes:number};
  protectedRoots:()=>readonly {root:string;target:string}[];
  services:readonly ReclaimTarget[];ownership:ReclaimOwnership;
  locked?:<T>(body:()=>T)=>T;
  /** Fixture deletion barrier; the production remover remains the owner. */
  removePayload?:(path:string,kind:ReclaimKind,remove:()=>void)=>void;
  /** The ordinary idle upkeep uses the same remover and safety checks. */
  maintenance?:{before:number;keep:number};
};
type Identity={path:string;dev:number;ino:number;uid:number};
type Candidate={tree:string;root:string;kind:ReclaimKind;identity:Identity[];service:boolean;target:string;movedAt:number;branch?:string};
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
  const physicalPath=(path:string,field:string):string=>{
    let ancestor=path;const suffix:string[]=[];
    for(;;){
      try{return resolve(realpathSync.native(ancestor),...suffix);}
      catch(error){
        if(!['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??'')||dirname(ancestor)===ancestor)
          throw Error('unreadable unit '+reading.unit+' '+field+' '+path,{cause:error});
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
export const liveReclaimOwnership:ReclaimOwnership=(tree,target)=>{
  assertNoUnitUsers([tree,target]);return assertNoProcessUsers([tree,target]);
};

const cargoProfiles=['nts-dev','clippy','debug','release'] as const;
const cargoMetadata=/^(?:CACHEDIR\.TAG|\.rustc_info(?:[^/]*)\.json|\.rustdoc_fingerprint\.json)$/;
/** Inventory only: these siblings have no deletion grant. Writer attribution
 * names the current owner where known, never a grant to remove its output. */
export function targetLeftovers(tree:string):{root:string;writer:string}[]{
  const target=join(tree,'target');
  if(!isDirectory(target))return [];
  return readdirSync(target).filter(name=>!cargoProfiles.some(profile=>profile===name)&&!cargoMetadata.test(name)).sort().map(name=>({
    root:join(target,name),writer:name==='tmp'?'compiler/test-support/scratch.rs (test scratch)':
      name.endsWith('-tests')?'compiler integration tests via compiler/test-support/scratch.rs':
      name==='gate-costs'?'tooling/gate/step-scheduling.ts':
      name==='gate-scope-owner.json'||name==='gate-scope-owner.json.lock'?'tooling/gate/run.mjs; tooling/landing/run.ts':
      name==='.gate-run.lock'?'tooling/gate/run.mjs':
      name==='tooling-types.tsbuildinfo'?'tooling/tsconfig.json':
      /^\d+-/.test(name)?'historical issue #'+name.split('-')[0]+' probe/log; writer unknown':'unknown',
  }));
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
const reclaimKinds:readonly ReclaimKind[]=['obsolete-profile','unbuilt-checkout','free-build-output','detached-build-output'];
type TrashManifest={version:1;id:string;at:number;state:'prepared'|'detached';identity:{dev:number;ino:number;uid:number};removal:ReclaimRemoval};
export type TrashEntry={path:string;allocatedBytes:number|null;ageMs:number;kind:ReclaimKind|null;diagnostic?:string};
function trashRoot(pool:string):string{return join(pool,DISK_TRASH);}
function readTrash(entry:string):TrashManifest{
  physical(entry);
  const file=join(entry,'manifest.json'),row=JSON.parse(readFileSync(file,'utf8')) as TrashManifest;
  assertStateVersion(row,1,file);
  if(row.version!==1||!trashId.test(row.id)||row.id!==basename(entry)||!Number.isSafeInteger(row.at)||row.at<0||!['prepared','detached'].includes(row.state)
    ||!row.identity||[row.identity.dev,row.identity.ino,row.identity.uid].some(value=>!Number.isSafeInteger(value)||value<0)
    ||!row.removal||!reclaimKinds.includes(row.removal.kind)||typeof row.removal.root!=='string'||resolve(row.removal.root)!==row.removal.root
    ||!Number.isSafeInteger(row.removal.allocatedBytes)||row.removal.allocatedBytes<0||!Array.isArray(row.removal.facts))throw Error('invalid disk trash manifest: '+file);
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
function drainTrash(options:ReclaimOptions,entry:string,locked:<T>(body:()=>T)=>T,owner:GateResource):ReclaimRemoval|null{
  let open=true;
  try{
    const row=readTrash(entry),payload=join(entry,'payload'),before=locked(options.snapshot).freeBytes;
    if(present(payload)){
      payloadIdentity(payload,row);
      if(row.state==='prepared'){row.state='detached';durableRecord(join(entry,'manifest.json'),row);}
      const remove=()=>{
        if(row.removal.kind==='unbuilt-checkout')removeTrashCheckout(options,payload,owner);
        else{writable(payload);rmSync(payload,{recursive:true});}
      };
      if(options.removePayload)options.removePayload(payload,row.removal.kind,remove);else remove();
      if(existsSync(payload))throw Error('disk trash remover retained payload: '+payload);
    }
    if(row.state==='detached'&&row.removal.kind==='unbuilt-checkout')locked(()=>{
      // A crash after Git's byte removal but before registry retirement leaves
      // a missing worktree. Force is allowed only for that absent payload;
      // this transaction removes metadata, never unexpected checkout bytes.
      if(present(payload))throw Error('disk trash payload reappeared: '+payload);
      if(worktrees(options.pool.git).some(tree=>resolve(tree.path)===payload))removeTrashCheckout(options,payload,owner,true);
    });
    // Prepared but never renamed: the original remains outside our grant.
    const removal=row.state==='detached'?{...row.removal,freeBytesChange:0}:null;
    locked(()=>{
      if(removal){
        removal.freeBytesChange=options.snapshot().freeBytes-before;
        const log=join(options.pool.dir,'.disk-reclaim.log');
        const seen=existsSync(log)&&readFileSync(log,'utf8').trim().split('\n').filter(Boolean).some(line=>(JSON.parse(line) as {trashId?:string}).trashId===row.id);
        if(!seen)appendFileSync(log,JSON.stringify({at:options.host.wallNow(),trashId:row.id,...removal})+'\n');
      }
      // Only small owner metadata is removed under the pool lock.
      owner.close();open=false;unlinkSync(join(entry,'.drain.lock'));
      unlinkSync(join(entry,'manifest.json'));rmdirSync(entry);
    });
    return removal;
  }finally{if(open)owner.close();}
}

/** Setup and final metadata cleanup can leave no manifest. Only an empty
 * UUID envelope with its one known lock file is eligible; no payload grant
 * is inferred from a missing manifest. Caller holds the pool lock. */
function emptyEnvelope(entry:string):boolean{
  if(!trashId.test(basename(entry)))return false;
  physical(entry);
  const children=readdirSync(entry);
  if(children.some(name=>name!=='.drain.lock'))return false;
  const file=join(entry,'.drain.lock');
  if(children.length){const info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size!==0||info.uid!==process.getuid?.())return false;}
  const owner=GateResource.tryAcquire(file);if(!owner)return false;
  try{
    if(readdirSync(entry).some(name=>name!=='.drain.lock'))return false;
  }finally{owner.close();}
  unlinkSync(file);rmdirSync(entry);return true;
}

export function reclaimDisk(options:ReclaimOptions):ReclaimReport{
  const {pool,host,coldBytes}=options;
  const take=options.locked??(<T>(body:()=>T)=>withLock(join(pool.dir,'.lock'),body));
  let lockHeldMs=0;
  const locked=<T>(body:()=>T):T=>take(()=>{
    const start=host.now();try{return body();}finally{lockHeldMs+=host.now()-start;}
  });
  const recovered:ReclaimRemoval[]=[],trashKept:ReclaimReport['kept']=[];
  for(const listed of diskTrash(pool.dir,host.wallNow())){
    // Listing is only a discovery hint. The previous owner may publish or
    // retire this envelope before we acquire the pool lock. Classify afresh
    // and acquire its drainer in one transaction, so no stale diagnostic or
    // second acquisition can race retirement.
    const pending=locked(()=>{
      const entry=observeTrash(listed.path,host.wallNow());
      if(!entry)return null;
      if(entry.diagnostic&&emptyEnvelope(entry.path))return null;
      if(entry.ageMs>3_600_000)trashKept.push({root:entry.path,reason:'stuck disk trash drain (older than one hour)',routine:false});
      if(entry.diagnostic){trashKept.push({root:entry.path,reason:entry.diagnostic,routine:false});return null;}
      const owner=GateResource.tryAcquire(join(entry.path,'.drain.lock'));
      return owner?{entry,owner}:null;
    });
    if(!pending)continue;
    const {entry,owner}=pending;
    try{const row=drainTrash(options,entry.path,locked,owner);if(row)recovered.push(row);}
    catch(error){if(error instanceof ToolingInstrumentError)throw error;trashKept.push({root:entry.path,reason:'disk trash drain retained: '+errorText(error),routine:false});}
  }

  const first=locked(options.snapshot),trigger=first.floorBytes+first.reservedBytes+coldBytes;
  const report:ReclaimReport={get lockHeldMs(){return lockHeldMs;},triggered:first.freeBytes<trigger,before:first.freeBytes,after:first.freeBytes,
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
  const marker=(path:string,name:BuildOutputName):'current'|'obsolete'|'unknown'=>{
    const file=join(path,'.nts-complete.json');
    if(!existsSync(file))return 'unknown';
    const record=JSON.parse(readFileSync(file,'utf8')) as {version:number;generation:unknown};
    assertStateVersion(record,1,file);
    if(record.version!==1||typeof record.generation!=='string'||!/^[a-f0-9]{64}$/.test(record.generation))throw Error('invalid profile generation '+file);
    return record.generation===generations[name]?'current':'obsolete';
  };
  const assertUnclaimed=(root:string):void=>{
    const owner=options.protectedRoots().flatMap(owner=>[owner.root,owner.target]).find(path=>under(resolve(path),root)||under(root,resolve(path)));
    if(owner)throw Error('live lease or build claim: '+owner);
  };
  const candidates:Candidate[]=[];
  const poolTargets:ReclaimTarget[]=registered().map(tree=>({tree:resolve(tree.path),target:join(tree.path,'target'),service:false}));
  const add=(target:ReclaimTarget,root:string,kind:ReclaimKind,movedAt:number,branch?:string):void=>{
    candidates.push({tree:target.tree,root,kind,identity:physical(root),service:target.service,target:target.target,movedAt,...(branch?{branch}:{})});
  };
  const offerBuildOutput=(target:ReclaimTarget,kind:'free-build-output'|'detached-build-output',movedAt:number,branch?:string):void=>{
    const leftovers=targetLeftovers(target.tree),cache=cargoCache(target.target);
    for(const row of leftovers)keep(row.root,'unrecognized target content; writer: '+row.writer,true);
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
      // debug is the retired top-level test profile, never clippy/debug.
      if(isDirectory(join(target.target,'debug')))add(target,join(target.target,'debug'),'obsolete-profile',movedAt);
      for(const name of ['nts-dev','clippy'] as const)if(isDirectory(join(target.target,name))&&marker(join(target.target,name),name)==='obsolete')add(target,join(target.target,name),'obsolete-profile',movedAt);
      if(!target.service)offerBuildOutput(target,'free-build-output',movedAt);
    }catch(error){candidates.length=start;if(!missing(error))keep(target.tree,error);}
  }
  // Keep two useful free targets. Stale markers and mere empty folders cannot
  // displace a current completed generation; recent use breaks equal warmth.
  const warmTargets=poolTargets.filter(target=>candidates.some(row=>row.target===target.target&&row.kind==='free-build-output'));
  const warmth=(target:ReclaimTarget)=>['nts-dev','clippy'].filter(name=>isDirectory(join(target.target,name))&&marker(join(target.target,name),name as BuildOutputName)==='current').length;
  warmTargets.sort((a,b)=>warmth(b)-warmth(a)||(candidates.find(row=>row.target===b.target)?.movedAt??0)-(candidates.find(row=>row.target===a.target)?.movedAt??0)||a.tree.localeCompare(b.tree));
  const retained=new Set(warmTargets.filter(target=>warmth(target)>0).slice(0,Math.max(2,options.maintenance?.keep??2)).map(row=>row.target));
  const rank:Record<ReclaimKind,number>={'obsolete-profile':0,'unbuilt-checkout':1,'free-build-output':2,'detached-build-output':3};
  candidates.sort((a,b)=>rank[a.kind]-rank[b.kind]||a.movedAt-b.movedAt||a.root.localeCompare(b.root));
  for(const candidate of candidates){
    const {root,tree,kind}=candidate;
    const snapshot=locked(options.snapshot);report.after=snapshot.freeBytes;
    const goal=snapshot.floorBytes+snapshot.reservedBytes+2*coldBytes;
    if(report.triggered&&snapshot.freeBytes>=goal)break;
    if(!report.triggered&&options.maintenance&&candidate.movedAt>=options.maintenance.before)continue;
    if(kind==='free-build-output'&&retained.has(candidate.target)){if(!report.kept.some(row=>row.root===candidate.target&&row.reason==='two warm free targets retained'))keep(candidate.target,'two warm free targets retained',true);continue;}
    // A previous obsolete-profile removal may have consumed this candidate.
    if(!existsSync(root))continue;
    const held:{lock:GateResource|null;drainer:GateResource|null;entry:string|undefined}={lock:null,drainer:null,entry:undefined};
    try{
      // Recursive allocation measurement is outside the pool lock too.
      const allocatedBytes=host.allocatedBytes(root);
      const staged=locked(()=>{
        sameRoot(candidate.identity);
        held.lock=GateResource.tryAcquire(tree+'.lock');if(!held.lock)throw Error('tree resource lock is held');
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
        }else if(basename(root)!=='debug'&&marker(root,basename(root) as BuildOutputName)!=='obsolete')throw Error('profile is no longer obsolete');
        const before=options.snapshot().freeBytes;
        // Measure first; the fresh process/unit observation is immediately beside
        // the identity fence and removal, rather than before a possibly large du.
        const ownerFacts=options.ownership(tree,kind==='unbuilt-checkout'?join(tree,'target'):root)??[];
        // Measurement may be slow. Re-read every mutable lease/presence fact
        // beside the final physical fence, while both locks are still held.
        if(candidate.branch)detached(tree,candidate.branch);
        assertUnclaimed(root);
        sameRoot(candidate.identity);
        if((kind==='free-build-output'||kind==='detached-build-output')&&root!==candidate.target){
          const name=basename(root);
          if(gitRead(pool.git,['ls-files','--','target/'+name],tree))throw Error('tracked target content');
          const completed=(name==='nts-dev'||name==='clippy')&&marker(root,name)!=='unknown';
          if(!cargoCache(candidate.target)&&!completed)throw Error('profile has neither Cargo cache identity nor a completion marker');
        }
        if(!candidate.branch&&!candidate.service)free(tree);
        const facts=['same dev/inode/uid and physical ancestors','no live lease/claim','resource lock held','no unit/cwd/exe/fd owner',candidate.branch?'explicit detached worker; task checkout retained':candidate.service?'service: obsolete generation only':'detached clean published worktree',...ownerFacts];
        const removal:ReclaimRemoval={root,kind,allocatedBytes,freeBytesChange:0,facts,...(candidate.branch?{tree,task:candidate.branch}:{})};
        if(!reclaimKinds.includes(kind))throw Error('unapproved disk reclamation kind: '+kind);
        const trash=trashRoot(pool.dir);mkdirSync(trash,{recursive:true});physical(trash);
        if(lstatSync(trash).dev!==candidate.identity[0]!.dev)throw Error('disk trash is on a different filesystem: '+root);
        held.entry=join(trash,randomUUID());mkdirSync(held.entry);held.drainer=GateResource.tryAcquire(join(held.entry,'.drain.lock'));
        if(!held.drainer)throw Error('new disk trash entry has an owner: '+held.entry);
        const {dev,ino,uid}=candidate.identity[0]!;
        const manifest:TrashManifest={version:1,id:basename(held.entry),at:host.wallNow(),state:'prepared',identity:{dev,ino,uid},removal};
        durableRecord(join(held.entry,'manifest.json'),manifest);
        const payload=join(held.entry,'payload');
        if(kind==='unbuilt-checkout'){
          assertWorkerPresenceWritable(tree);
          gitRead(pool.git,['worktree','move','--',root,payload]);removeWorkerPresence(tree);
        }else renameSync(root,payload);
        manifest.state='detached';durableRecord(join(held.entry,'manifest.json'),manifest);
        return {entry:held.entry,drainer:held.drainer,before};
      });
      held.lock?.close();held.lock=null;
      held.drainer=null; // drainTrash owns close, including on failure.
      const removal=drainTrash(options,staged.entry,locked,staged.drainer);
      report.after=locked(options.snapshot).freeBytes;
      if(removal){removal.freeBytesChange=report.after-staged.before;report.removed.push(removal);}
    }catch(error){
      if(error instanceof ToolingInstrumentError)throw error;
      keep(held.entry??root,error);
    }finally{held.lock?.close();held.drainer?.close();}

  }
  return report;
}
