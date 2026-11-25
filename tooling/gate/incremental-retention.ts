// Cargo's incremental state in a service-owned target, kept to what recent
// builds use. rustc keys each unit's directory by a hash of its `-C metadata`
// (`incremental/<crate>-<StableCrateId>`) and collects old sessions only
// inside that one directory, so a unit whose hash changes (a Cargo.lock or
// feature change, a toolchain bump, a target added or removed) leaves its
// old directory behind for good, and cargo has no collector for it. No
// current-unit set can be read back from a target, so this owner evicts by
// recency counted in builds: a crate directory none of the last
// RETAINED_BUILDS compiling builds touched goes, and so do the sessions
// rustc's own collector would remove at the next compile of a kept one.
//
// It runs between its owner's runs and holds cargo's own profile locks while
// it looks and removes, so no build of the profile runs meanwhile: a build
// that arrives waits on them. Cargo 1.99.1 holds `.cargo-lock`,
// `.cargo-build-lock` and `.cargo-artifact-lock` in the profile directory for
// a whole build, and a held `.cargo-lock` makes a new build block
// ("Blocking waiting for file lock on artifact directory"); the test that
// builds a crate with the pinned toolchain fails if that stops being true.
// Each session is removed only once its own `s-*.lock` is free, rustc's own
// collection condition, so a rustc that outlived its cargo is never raced.
import {existsSync,lstatSync,readFileSync,readdirSync,rmSync,unlinkSync,type Stats} from 'node:fs';
import {join} from 'node:path';
import {GateResource} from './gate-resource.ts';
import {durableRecord} from './durable-record.ts';
import {assertWritableState,futureStateVersion} from './state-version.ts';
import type {HostObservations} from './host-observations.ts';

/** The compiling builds whose crate directories are kept. */
export const RETAINED_BUILDS=20;
/** The lock files cargo 1.99.1 holds in a profile directory for a whole build; `.cargo-lock` is required. */
export const CARGO_PROFILE_LOCKS=['.cargo-lock','.cargo-build-lock','.cargo-artifact-lock'] as const;
export type RetainedProfile='nts-dev'|'clippy';
const GiB=2**30;
/** What a retained target's incremental directory may hold: a little over two generations of today's units. */
export const INCREMENTAL_BOUNDS:Readonly<Record<RetainedProfile,number>>={'nts-dev':8*GiB,clippy:4*GiB};
export const RETENTION_STATE='.nts-incremental.json';
const VERSION=1;

/** The profile directories of a target whose incremental state is retained. */
export function retainedProfiles(target:string):{name:RetainedProfile;profile:string}[]{
  return [{name:'nts-dev',profile:join(target,'nts-dev')},{name:'clippy',profile:join(target,'clippy','debug')}];
}

export type RetentionOutcome={
  at:number;state:'retained'|'skipped'|'absent'|'failed';reason?:string;
  /** Compiling builds this profile's state has seen, at most RETAINED_BUILDS+1. */
  generations:number;
  keptDirs:number;removedDirs:number;removedSessions:number;removedBytes:number;lockHeldMs:number;
};
type State={version:1;marks:number[];last?:RetentionOutcome};

function missing(error:unknown):boolean{return ['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??'');}
function stat(path:string):Stats|null{try{return lstatSync(path);}catch(error){if(missing(error))return null;throw error;}}
function entries(path:string):string[]{try{return readdirSync(path);}catch(error){if(missing(error))return [];throw error;}}

/**
 * The state's high-water marks, or none known. A missing, unparseable or
 * malformed file knows no generations, so nothing is evicted until enough
 * builds are seen again; a newer version's file is left untouched.
 */
export function readRetentionState(profile:string):State{
  const file=join(profile,RETENTION_STATE);
  let value:unknown;
  try{value=JSON.parse(readFileSync(file,'utf8'));}catch{return {version:VERSION,marks:[]};}
  const newer=futureStateVersion(value,VERSION,file);if(newer)throw newer;
  const row=value as Partial<State>;
  if(row?.version!==VERSION||!Array.isArray(row.marks)||!row.marks.every((mark,i,all)=>Number.isFinite(mark)&&(i===0||mark>all[i-1]!)))return {version:VERSION,marks:[]};
  return {version:VERSION,marks:row.marks,...(row.last?{last:row.last}:{})};
}
function writeState(profile:string,state:State):void{
  const file=join(profile,RETENTION_STATE);
  assertWritableState(file,VERSION);durableRecord(file,state);
}

type Session={name:string;lock:string;finalized:boolean;mtimeMs:number};
type CrateDir={path:string;sessions:Session[];lastUse:number};
const SESSION=/^(s-[0-9a-z]+-[0-9a-z]+)-([0-9a-z]+)$/;

function crateDir(path:string,info:Stats):CrateDir{
  const sessions:Session[]=[];
  for(const name of entries(path)){
    const match=SESSION.exec(name),session=match?stat(join(path,name)):null;
    if(!match||!session?.isDirectory())continue;
    sessions.push({name,lock:join(path,match[1]+'.lock'),finalized:match[2]!=='working',mtimeMs:session.mtimeMs});
  }
  sessions.sort((a,b)=>a.mtimeMs-b.mtimeMs||a.name.localeCompare(b.name));
  // A finalized session is what rustc reads; a directory with none was last
  // used when its newest session, or failing that the directory, changed.
  const finalized=sessions.filter(row=>row.finalized);
  const lastUse=finalized.at(-1)?.mtimeMs??sessions.at(-1)?.mtimeMs??info.mtimeMs;
  return {path,sessions,lastUse};
}

/** Allocated bytes under `root`; with `unique`, only inodes no other path links. */
function allocated(root:string,unique:boolean,seen=new Set<string>()):number{
  const info=stat(root);if(!info)return 0;
  if(info.isDirectory())return info.blocks*512+entries(root).reduce((sum,name)=>sum+allocated(join(root,name),unique,seen),0);
  const key=info.dev+':'+info.ino;
  if(seen.has(key)||unique&&info.nlink>1)return 0;
  seen.add(key);return info.blocks*512;
}

/** The incremental directory's allocated bytes and crate directories, as the count reports them. */
export function incrementalUsage(profile:string):{bytes:number;dirs:number}{
  const root=join(profile,'incremental');
  return {bytes:allocated(root,false),dirs:entries(root).filter(name=>stat(join(root,name))?.isDirectory()).length};
}

/** Hold every present cargo profile lock, or none and the reason: what a build of the profile holds for its whole run. */
export function profileLocks(profile:string):{held:GateResource[]}|{busy:string}{
  const held:GateResource[]=[];
  for(const name of CARGO_PROFILE_LOCKS){
    const file=join(profile,name);
    if(!existsSync(file)){
      if(name==='.cargo-lock'){for(const lock of held)lock.close();return {busy:'the profile has no '+name+': not a cargo 1.99 profile'};}
      continue;
    }
    const lock=GateResource.tryAcquire(file);
    if(!lock){for(const row of held)row.close();return {busy:'a build holds '+file};}
    held.push(lock);
  }
  return {held};
}

/** Hold the rustc locks of `sessions`, or none while a rustc holds one. A session without its lock file is in no rustc's use. */
function sessionLocks(sessions:readonly Session[]):GateResource[]|null{
  const held:GateResource[]=[];
  for(const session of sessions){
    if(!existsSync(session.lock))continue;
    const lock=GateResource.tryAcquire(session.lock);
    if(!lock){for(const row of held)row.close();return null;}
    held.push(lock);
  }
  return held;
}

export type RetentionOptions={
  host:Pick<HostObservations,'now'|'wallNow'>;
  keepBuilds?:number;
  /** Fixture removal barrier; the production remover is rmSync. */
  remove?:(path:string)=>void;
};

/**
 * One retention pass over a profile directory, holding its cargo locks. A
 * build in progress skips the pass and changes nothing but the last outcome.
 */
export function retainIncremental(profile:string,options:RetentionOptions):RetentionOutcome{
  const {host}=options,keep=options.keepBuilds??RETAINED_BUILDS;
  const remove=options.remove??((path:string)=>rmSync(path,{recursive:true,force:true}));
  const root=join(profile,'incremental');
  const empty={at:host.wallNow(),generations:0,keptDirs:0,removedDirs:0,removedSessions:0,removedBytes:0,lockHeldMs:0};
  if(!stat(root)?.isDirectory())return {...empty,state:'absent'};
  const state=readRetentionState(profile);
  const locks=profileLocks(profile);
  if('busy' in locks){
    const outcome:RetentionOutcome={...empty,state:'skipped',reason:locks.busy,generations:state.marks.length};
    writeState(profile,{...state,last:outcome});return outcome;
  }
  const started=host.now();
  try{
    const dirs:CrateDir[]=[];
    for(const name of entries(root)){
      const info=stat(join(root,name));
      if(info?.isDirectory())dirs.push(crateDir(join(root,name),info));
    }
    // A build that compiled anything leaves a newer session than the last mark.
    const high=Math.max(0,...dirs.map(row=>row.lastUse));
    const marks=high>(state.marks.at(-1)??0)?[...state.marks,high].slice(-(keep+1)):state.marks;
    // The mark before the oldest of the last `keep` builds: what none of them touched.
    const cutoff=marks.length===keep+1?marks[0]!:undefined;
    let keptDirs=0,removedDirs=0,removedSessions=0,removedBytes=0;
    for(const dir of dirs){
      if(cutoff!==undefined&&dir.lastUse<=cutoff){
        const held=sessionLocks(dir.sessions);
        if(held)try{const bytes=allocated(dir.path,false);remove(dir.path);removedDirs++;removedBytes+=bytes;continue;}finally{for(const lock of held)lock.close();}
      }
      keptDirs++;
      // rustc reads only the newest finalized session; it removes the rest
      // itself when it next compiles the unit.
      const newest=dir.sessions.filter(row=>row.finalized).at(-1);
      for(const session of dir.sessions){
        if(session===newest)continue;
        const held=sessionLocks([session]);if(!held)continue;
        try{
          const bytes=allocated(join(dir.path,session.name),true);
          remove(join(dir.path,session.name));if(held.length)unlinkSync(session.lock);
          removedSessions++;removedBytes+=bytes;
        }finally{for(const lock of held)lock.close();}
      }
    }
    const outcome:RetentionOutcome={at:host.wallNow(),state:'retained',generations:marks.length,keptDirs,removedDirs,removedSessions,removedBytes,lockHeldMs:host.now()-started};
    writeState(profile,{version:VERSION,marks,last:outcome});
    return outcome;
  }finally{for(const lock of locks.held)lock.close();}
}

export function describeRetention(profile:string,outcome:RetentionOutcome):string{
  const head=`incremental retention ${profile}: ${outcome.state}`;
  if(outcome.state!=='retained')return head+(outcome.reason?`: ${outcome.reason}`:'');
  return `${head}: kept ${outcome.keptDirs} crate dirs, removed ${outcome.removedDirs} and ${outcome.removedSessions} older sessions `
    +`(${(outcome.removedBytes/GiB).toFixed(2)} GiB); ${outcome.generations} builds known; locks held ${Math.round(outcome.lockHeldMs)} ms`;
}

/**
 * Retain both profiles of a service's target after a run. It never throws:
 * a failure is logged with its reason, recorded as the last outcome where
 * the state allows, and the run's verdict stands.
 */
export function retainTarget(target:string,options:RetentionOptions&{log:(line:string)=>void}):RetentionOutcome[]{
  return retainedProfiles(target).map(({profile})=>{
    try{const outcome=retainIncremental(profile,options);options.log(describeRetention(profile,outcome));return outcome;}
    catch(error){
      const reason=error instanceof Error?error.message:String(error);
      const outcome:RetentionOutcome={at:options.host.wallNow(),state:'failed',reason,generations:0,keptDirs:0,removedDirs:0,removedSessions:0,removedBytes:0,lockHeldMs:0};
      try{writeState(profile,{...readRetentionState(profile),last:outcome});}catch{/* the log line below carries it */}
      options.log(describeRetention(profile,outcome)+'; the run\'s verdict stands');
      return outcome;
    }
  });
}
