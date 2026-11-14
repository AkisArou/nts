// Reclaim only rebuildable outputs and clean, unbuilt pool worktrees. The
// caller holds DiskCapacity's pool lock for inventory, checks and removal.
import {appendFileSync,chmodSync,existsSync,lstatSync,readFileSync,readdirSync,realpathSync,rmSync} from 'node:fs';
import {basename,dirname,join,resolve,sep} from 'node:path';
import {userInfo} from 'node:os';
import {worktrees,type Git} from '../landing/git.ts';
import {assertNoProcessUsers} from '../landing/tree-users.ts';
import {GateResource} from './gate-resource.ts';
import {gitArguments} from './git-arguments/main.ts';
import {infrastructureProbe} from './infrastructure-probe.ts';
import {buildGenerationFromInputs,type BuildOutputName} from './build-completion.ts';
import {assertStateVersion} from './state-version.ts';
import type {HostObservations} from './host-observations.ts';

export type ReclaimTarget={tree:string;target:string;service:boolean};
export type ReclaimKind='obsolete-profile'|'unbuilt-checkout'|'free-build-output';
export type ReclaimRemoval={root:string;kind:ReclaimKind;allocatedBytes:number;freeBytesChange:number;facts:string[]};
export type ReclaimReport={triggered:boolean;before:number;after:number;triggerBytes:number;goalBytes:number;
  removed:ReclaimRemoval[];kept:{root:string;reason:string;routine:boolean}[]};
export type ReclaimOwnership=(tree:string,target:string)=>readonly string[]|void;
export type ReclaimOptions={
  pool:{dir:string;git:Git};host:HostObservations;coldBytes:number;
  snapshot:()=>{freeBytes:number;floorBytes:number;reservedBytes:number};
  protectedRoots:()=>readonly {root:string;target:string}[];
  services:readonly ReclaimTarget[];ownership:ReclaimOwnership;
  /** The ordinary idle upkeep uses the same remover and safety checks. */
  maintenance?:{before:number;keep:number};
};
type Identity={path:string;dev:number;ino:number;uid:number};
type Candidate={tree:string;root:string;kind:ReclaimKind;identity:Identity[];service:boolean;movedAt:number};
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
  const rows=text.trim().split('\n').map(line=>JSON.parse(line) as {type:unknown;data:unknown});
  if(rows.length!==5||rows.slice(0,2).some(row=>row.type!=='s'||typeof row.data!=='string'))throw Error('unreadable unit directories: '+unit);
  const properties=['ExecStartPre','ExecStart','ExecStartPost'] as const;
  const commands=properties.flatMap((property,index)=>{
    const row=rows[index+2]!;
    if(row.type!=='a(sasbttttuii)'||!Array.isArray(row.data))throw Error('unreadable unit '+property+': '+unit);
    return row.data.map((entry:unknown)=>{
      if(!Array.isArray(entry)||entry.length!==10||typeof entry[0]!=='string'||!entry[0].startsWith('/')||
        !Array.isArray(entry[1])||entry[1].some(arg=>typeof arg!=='string'))throw Error('unreadable unit execution ownership: '+unit);
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

export function reclaimDisk(options:ReclaimOptions):ReclaimReport{
  const {pool,host,coldBytes}=options;
  const first=options.snapshot(),trigger=first.floorBytes+first.reservedBytes+coldBytes;
  const report:ReclaimReport={triggered:first.freeBytes<trigger,before:first.freeBytes,after:first.freeBytes,
    triggerBytes:trigger,goalBytes:trigger+coldBytes,removed:[],kept:[]};
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
  const marker=(path:string,name:BuildOutputName):'current'|'obsolete'|'unknown'=>{
    const file=join(path,'.nts-complete.json');
    if(!existsSync(file))return 'unknown';
    const record=JSON.parse(readFileSync(file,'utf8')) as {version:number;generation:unknown};
    assertStateVersion(record,1,file);
    if(record.version!==1||typeof record.generation!=='string'||!/^[a-f0-9]{64}$/.test(record.generation))throw Error('invalid profile generation '+file);
    return record.generation===generations[name]?'current':'obsolete';
  };
  const candidates:Candidate[]=[];
  const poolTargets:ReclaimTarget[]=registered().map(tree=>({tree:resolve(tree.path),target:join(tree.path,'target'),service:false}));
  const add=(target:ReclaimTarget,root:string,kind:ReclaimKind,movedAt:number):void=>{
    candidates.push({tree:target.tree,root,kind,identity:physical(root),service:target.service,movedAt});
  };
  for(const target of [...poolTargets,...options.services]){
    const start=candidates.length;
    try{
      physical(target.tree);
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
      if(!target.service)add(target,target.target,'free-build-output',movedAt);
    }catch(error){candidates.length=start;if(!missing(error))keep(target.tree,error);}
  }
  // Keep two useful free targets. Stale markers and mere empty folders cannot
  // displace a current completed generation; recent use breaks equal warmth.
  const warmTargets=poolTargets.filter(target=>candidates.some(row=>row.root===target.target&&row.kind==='free-build-output'));
  const warmth=(target:ReclaimTarget)=>['nts-dev','clippy'].filter(name=>isDirectory(join(target.target,name))&&marker(join(target.target,name),name as BuildOutputName)==='current').length;
  warmTargets.sort((a,b)=>warmth(b)-warmth(a)||(candidates.find(row=>row.root===b.target)?.movedAt??0)-(candidates.find(row=>row.root===a.target)?.movedAt??0)||a.tree.localeCompare(b.tree));
  const retained=new Set(warmTargets.slice(0,Math.max(2,options.maintenance?.keep??2)).map(row=>row.target));
  const rank:Record<ReclaimKind,number>={'obsolete-profile':0,'unbuilt-checkout':1,'free-build-output':2};
  candidates.sort((a,b)=>rank[a.kind]-rank[b.kind]||a.movedAt-b.movedAt||a.root.localeCompare(b.root));
  for(const candidate of candidates){
    const {root,tree,kind}=candidate;
    const snapshot=options.snapshot();report.after=snapshot.freeBytes;
    const goal=snapshot.floorBytes+snapshot.reservedBytes+2*coldBytes;
    if(report.triggered&&snapshot.freeBytes>=goal)break;
    if(!report.triggered&&options.maintenance&&candidate.movedAt>=options.maintenance.before)continue;
    if(kind==='free-build-output'&&retained.has(root)){keep(root,'two warm free targets retained',true);continue;}
    // A previous obsolete-profile removal may have consumed this candidate.
    if(!existsSync(root))continue;
    let lock:GateResource|null=null,deleted=false;
    try{
      sameRoot(candidate.identity);
      lock=GateResource.tryAcquire(tree+'.lock');if(!lock)throw Error('tree resource lock is held');
      if(gitRead(pool.git,['rev-parse','refs/heads/main'])!==revision)throw Error('current build policy changed during reclamation');
      if(options.protectedRoots().some(owner=>[owner.root,owner.target].some(path=>under(resolve(path),root)||under(root,resolve(path)))))throw Error('live lease or build claim');
      if(!candidate.service)free(tree);
      if(kind==='unbuilt-checkout'){
        // Ignored user files also belong to their author. Only the linker's
        // exact shared input links may disappear with an unbuilt checkout.
        const ignored=gitRead(pool.git,['ls-files','--others','--ignored','--exclude-standard','-z'],tree).split('\0').filter(Boolean);
        for(const path of ignored){
          if(!lstatSync(join(tree,path)).isSymbolicLink()||realpathSync(join(tree,path))!==realpathSync(join(pool.git.root,path)))throw Error('ignored local data: '+path);
        }
        if(existsSync(join(tree,'target')))throw Error('checkout acquired build output');
      }else if(kind==='free-build-output'){
        if(gitRead(pool.git,['ls-files','--','target'],tree))throw Error('tracked target content');
        const allowed=/^(?:nts-dev|clippy|debug|release|CACHEDIR\.TAG|\.rustc_info(?:[^/]*)\.json)$/;
        for(const name of readdirSync(root))if(!allowed.test(name))throw Error('unrecognized target content: '+name);
        if(!readFileSync(join(root,'CACHEDIR.TAG'),'utf8').startsWith('Signature: 8a477f597d28d172789f06886806bc55'))throw Error('target lacks Cargo cache identity');
      }else if(basename(root)!=='debug'&&marker(root,basename(root) as BuildOutputName)!=='obsolete')throw Error('profile is no longer obsolete');
      const allocatedBytes=host.allocatedBytes(root);
      const before=options.snapshot().freeBytes;
      // Measure first; the fresh process/unit observation is immediately beside
      // the identity fence and removal, rather than before a possibly large du.
      const ownerFacts=options.ownership(tree,kind==='unbuilt-checkout'?join(tree,'target'):root)??[];
      sameRoot(candidate.identity);
      if(kind==='unbuilt-checkout')gitRead(pool.git,['worktree','remove','--',root]);
      else{writable(root);rmSync(root,{recursive:true});}
      deleted=true;
      report.after=options.snapshot().freeBytes;
      const facts=['same dev/inode/uid and physical ancestors','no live lease/claim','resource lock held','no unit/cwd/exe/fd owner',candidate.service?'service: obsolete generation only':'detached clean published worktree',...ownerFacts];
      const removal:ReclaimRemoval={root,kind,allocatedBytes,freeBytesChange:report.after-before,facts};report.removed.push(removal);
      appendFileSync(join(pool.dir,'.disk-reclaim.log'),JSON.stringify({at:host.wallNow(),...removal})+'\n');
    }catch(error){if(deleted)throw Error('disk reclamation removed '+root+' but could not observe or audit completion',{cause:error});keep(root,error);}finally{lock?.close();}
  }
  return report;
}
