// One read-only process observation owner for pool reset and disk reclamation.
// A complete supplied proc tree replaces live sampling in decision controls.
import {readdirSync,readFileSync,readlinkSync,realpathSync,lstatSync,statSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
import {cgroupOwnershipIdentity} from '../gate/host-observations.ts';
import {HostObservationError} from '../gate/host-observation-error.ts';
import {readProcessStats} from '../differential/process-stat/main.ts';
import {parseRunOwner} from '../gate/scopes/run-owner.ts';
import type {TreePin} from './tree-pin.ts';

export type TreeUser={pid:number;command:string;where:string};
type ObservedUser=TreeUser&{link:string;path:string};
export type TreeProcessOptions={proc?:string;self?:number;ownPin?:TreePin;/** A fixture's explicitly owned kernel processes. */pids?:readonly number[];/** Registered pool trees, supplied by their Git owner. */runTrees?:readonly string[];/** Private cgroup filesystem with a supplied proc tree. */cgroups?:string};
export type TreeProcessObservation={users:ObservedUser[];ignored:{pid:number;birth:string;command:string;group:string}[];unreadable:Error[]};
const PROC='/proc';
const procStat=(pid:number,proc:string)=>readFileSync(join(proc,String(pid),'stat'),'utf8');
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
const errorText=(error:unknown)=>error instanceof Error?error.message:String(error);
const under=(root:string,path:string)=>path===root||path.startsWith(root+sep);
/** Read-only provenance; no signalling or membership authority. */
export function processCgroup(pid:number,proc=PROC):string{return readFileSync(join(proc,String(pid),'cgroup'),'utf8');}

/** A missing process observation protects the tree, but is retryable by the pool. */
export class TreeOwnershipUnavailable extends AggregateError {
  constructor(errors:readonly Error[]){super(errors,'tree ownership keeps root: '+errors.map(error=>error.message).join('; '));}
}
/** Observed process, cgroup or gate-receipt state that cannot certify an owner:
 * protects the tree and is retryable, unlike a defect or a caller's mistake. */
export class OwnershipObservationFailure extends Error { override name='OwnershipObservationFailure'; }
/**
 * Whether `error` is a failed observation of a process or its cgroup, which
 * protects the tree and may succeed later. A system-call failure counts only
 * when its path is inside the observed proc or cgroup filesystem; any other
 * error -- a defect, a caller's missing capability, an unreadable pool or Git
 * path -- is a hard error.
 */
export function observedFailure(error:unknown,{proc=PROC,cgroups}:Pick<TreeProcessOptions,'proc'|'cgroups'>={}):boolean{
  if(error instanceof OwnershipObservationFailure||error instanceof HostObservationError)return true;
  const failure=error as NodeJS.ErrnoException;
  if(!(error instanceof Error)||typeof failure.syscall!=='string'||typeof failure.path!=='string')return false;
  const path=resolve(failure.path);
  return under(resolve(proc),path)||under(resolve(cgroups??'/sys/fs/cgroup'),path);
}
const observation=(error:unknown,options:Pick<TreeProcessOptions,'proc'|'cgroups'>):unknown=>{if(!observedFailure(error,options))throw error;return error;};
/** readProcessStats reports only a failed read or a stat still malformed
 * after its recheck: an observation, unless the read failed outside proc. */
const statObservation=(error:Error,proc:string):OwnershipObservationFailure=>{
  if(error.cause!==undefined)observation(error.cause,{proc});
  return new OwnershipObservationFailure(error.message,{cause:error});
};
const statAt=(pid:number,proc:string)=>readProcessStats([pid],id=>procStat(id,proc),(_pid,error)=>{throw statObservation(error,proc);}).get(pid);

/** Attribution is a read-only use of the run owner's receipt, never a drain grant.
 * A supplied proc filesystem must supply its cgroups too; neither reads the host. */
function ownedRun(group:string,{proc=PROC,runTrees=[],cgroups}:TreeProcessOptions):string|undefined{
  if(!runTrees.length)return;
  if(!cgroups&&proc!==PROC)throw Error('missing cgroup filesystem observation');
  const boot=()=>readFileSync(join(proc,'sys/kernel/random/boot_id'),'utf8').trim();
  const live=(pid:number,start:string)=>{
    const dir=join(proc,String(pid));
    const uid=/^Uid:\s+(\d+)\s+\d+\s+\d+\s+\d+$/m.exec(readFileSync(join(dir,'status'),'utf8'))?.[1];
    const stat=statAt(pid,proc);
    return Number(uid)===process.getuid?.()&&stat?.live===true&&String(stat.started)===start;
  };
  // The receipt is the run owner's observed state: absent is undefined, and
  // any other failed read refuses attribution as an observation.
  const receipt=(file:string):string|undefined=>{
    try{
      const info=lstatSync(file);
      if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid?.())throw new OwnershipObservationFailure('unowned gate receipt '+file);
      return readFileSync(file,'utf8');
    }catch(error){
      if(missing(error))return;if(error instanceof OwnershipObservationFailure)throw error;
      throw new OwnershipObservationFailure('unreadable gate receipt '+file+': '+errorText(error),{cause:error});
    }
  };
  const owners=new Map<string,()=>void>();
  for(const tree of new Set(runTrees)){
    const file=join(tree,'target/gate-scope-owner.json'),bytes=receipt(file);
    if(bytes===undefined)continue;
    let owner:ReturnType<typeof parseRunOwner>;
    try{owner=parseRunOwner(bytes,file);}catch(error){throw new OwnershipObservationFailure('invalid gate receipt '+file+': '+errorText(error),{cause:error});}
    const scope=owner.scope;
    if(!scope||!under(scope.group,group))continue;
    const identity=()=>{
      const info=cgroups?statSync(join(cgroups,scope.group),{bigint:true}):undefined;
      const current=info?{device:String(info.dev),inode:String(info.ino)}:cgroupOwnershipIdentity(scope.group);
      return current.device===scope.device&&current.inode===scope.inode;
    };
    if(owner.boot!==boot()||!live(owner.pid,owner.start)||!identity())throw new OwnershipObservationFailure('unavailable gate owner identity '+file);
    let root:string;
    try{root=realpathSync(tree);}catch(error){throw new OwnershipObservationFailure('gate run tree changed during attribution '+tree+': '+errorText(error),{cause:error});}
    owners.set(root,()=>{
      // A run that drains removes its receipt: a receipt gone, unreadable or
      // replaced since its first read is a changed owner, never a defect.
      let again:string|undefined;
      try{again=receipt(file);}catch(error){throw new OwnershipObservationFailure('gate owner changed during attribution '+file+': '+errorText(error),{cause:error});}
      if(again!==bytes||owner.boot!==boot()||!live(owner.pid,owner.start)||!identity())throw new OwnershipObservationFailure('gate owner changed during attribution '+file);
    });
  }
  if(owners.size>1)throw new OwnershipObservationFailure('conflicting gate tree owners for '+group);
  for(const verify of owners.values())verify();
  return [...owners.keys()][0];
}

export function observeTreeProcesses(roots:readonly string[],{proc=PROC,self,ownPin,pids,runTrees,cgroups}:TreeProcessOptions={}):TreeProcessObservation{
  const uid=process.getuid?.(),normalized=roots.map(root=>resolve(root));
  const reading:TreeProcessObservation={users:[],ignored:[],unreadable:[]};
  const names=pids===undefined?readdirSync(proc).filter(name=>/^[1-9][0-9]*$/.test(name)):pids.map(String);
  const candidates:number[]=[];
  for(const pid of names){
    if(Number(pid)===self)continue;
    const dir=join(proc,pid);
    try{
      // Non-dumpable processes may have root-owned proc inodes. status owns UID.
      const status=readFileSync(join(dir,'status'),'utf8'),owner=/^Uid:\s+(\d+)\s+\d+\s+\d+\s+\d+$/m.exec(status);
      if(!owner)throw new OwnershipObservationFailure('process has no UID observation');
      if(Number(owner[1])===uid)candidates.push(Number(pid));
    }catch(error){if(missing(error))continue;reading.unreadable.push(Error('unreadable process ownership '+dir,{cause:observation(error,{proc,cgroups})}));}
  }
  // Retry malformed stats only after every same-uid candidate was observed.
  // Filtering UID first keeps unrelated users outside this ownership scan.
  const records=readProcessStats(candidates,pid=>procStat(pid,proc),(pid,error)=>{
    reading.unreadable.push(Error('unreadable process ownership '+join(proc,String(pid)),{cause:statObservation(error,proc)}));
  });
  for(const [number,stat] of records){
    if(!stat.live)continue;
    const pid=String(number),dir=join(proc,pid),birth=String(stat.started);
    try{
      // Read cwd and exe before enumerating fds, so a known positive owner
      // remains visible even when another observation would refuse later.
      const inspect=(link:string):boolean=>{
        if(ownPin?.owns(Number(pid),link,birth))return false;
        let path:string;
        try{path=readlinkSync(join(dir,link)).replace(/ \(deleted\)$/,'');}
        catch(error){if(missing(error))return false;throw error;}
        const root=normalized.find(root=>under(root,path));if(!root)return false;
        const command=readFileSync(join(dir,'comm'),'utf8').trim()||'?';
        const shown=relative(root,path)||'.';
        const where=link==='cwd'?'its working directory':link==='exe'?'its executable '+shown:'an open file '+shown;
        reading.users.push({pid:Number(pid),command,where,link,path});return true;
      };
      if(inspect('cwd')||inspect('exe'))continue;
      for(const fd of readdirSync(join(dir,'fd')))if(inspect('fd/'+fd))break;
    }catch(error){
      observation(error,{proc,cgroups});
      let current:string;
      try{const stat=statAt(Number(pid),proc);if(!stat?.live)continue;current=String(stat.started);}
      catch(again){if(missing(again))continue;observation(again,{proc,cgroups});reading.unreadable.push(Error('unreadable process ownership '+dir,{cause:error}));continue;}
      if(current!==birth)continue;
      try{
        const lines=processCgroup(Number(pid),proc).trim().split('\n'),group=lines.length===1&&/^0::(\/.*)$/.exec(lines[0]!)?.[1];
        if(!group||group.split('/').some(part=>part==='.'||part==='..'))throw new OwnershipObservationFailure('invalid unified cgroup identity');
        const denied=['EACCES','EPERM'].includes((error as NodeJS.ErrnoException).code??'');
        if(denied&&!group.split('/').some(part=>/^nts(?:[.-]|$)/.test(part))){
          const command=readFileSync(join(dir,'comm'),'utf8').trim();
          reading.ignored.push({pid:Number(pid),birth,command,group});continue;
        }
        if(denied){
          const tree=ownedRun(group,{proc,runTrees,cgroups});
          if(tree){
            // The process must still be the same actor in the same owned unit.
            const stat=statAt(Number(pid),proc);
            if(!stat?.live||String(stat.started)!==birth)continue;
            if(processCgroup(Number(pid),proc).trim()!=='0::'+group)throw new OwnershipObservationFailure('process cgroup changed during attribution '+pid);
            const root=normalized.find(root=>under(root,tree)||under(tree,root));
            if(root)reading.users.push({pid:Number(pid),command:readFileSync(join(dir,'comm'),'utf8').trim()||'?',where:'its owned gate run in '+tree+'; cgroup '+group,link:'cgroup',path:tree});
            continue;
          }
        }
        throw new OwnershipObservationFailure('live unreadable tool process '+pid+'; cgroup '+group+': '+errorText(error));
      }catch(reason){observation(reason,{proc,cgroups});reading.unreadable.push(Error('tree ownership keeps unreadable process '+pid+': '+errorText(reason),{cause:error}));}
    }
  }
  reading.users.sort((a,b)=>a.pid-b.pid);return reading;
}
function complete(reading:TreeProcessObservation):void{
  if(reading.unreadable.length)throw new TreeOwnershipUnavailable(reading.unreadable);
}
/** Pool reset/release and reclamation consume this same observation and rule. */
export function treeUsers(tree:string,options:TreeProcessOptions={}):TreeUser[]{
  let root:string;try{root=realpathSync(tree);}catch(error){if(missing(error))return [];throw error;}
  const reading=observeTreeProcesses([root],{self:process.pid,...options});
  // A known owner already refuses reset; missing observations never certify idle.
  if(!reading.users.length)complete(reading);
  return reading.users.map(({pid,command,where})=>({pid,command,where}));
}
export function assertNoProcessUsers(roots:readonly string[],options:TreeProcessOptions={}):string[]{
  return assertNoObservedProcessUsers(observeTreeProcesses(roots,options));
}
/** The same guard consumes a run's supplied process observation. */
export function assertNoObservedProcessUsers(reading:TreeProcessObservation):string[]{
  const owner=reading.users[0];if(owner)throw Error('process '+owner.pid+' owns '+owner.link+' in '+owner.path);
  complete(reading);return reading.ignored.map(row=>'ignored non-dumpable outside nts: pid '+row.pid+' '+row.command+'; birth '+row.birth+'; cgroup '+row.group);
}
export function describeUsers(users:readonly TreeUser[],most=3):string{
  const named=users.slice(0,most).map(user=>`pid ${user.pid} ${user.command} (${user.where})`);
  return users.length>most?`${named.join(', ')} and ${users.length-most} more`:named.join(', ');
}
