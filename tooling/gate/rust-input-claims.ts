// Match requirements to the canonical graph. This module does not authenticate
// a capture, resolve historical names or infer a successful syscall result.
import {isAbsolute,relative,resolve,sep,posix} from 'node:path';
import type {InputIdentity} from '../differential/oracle-filesystem.ts';
import type {InputSnapshot} from './module-closure.ts';
import type {ReaderContext} from './reader-inputs/main.ts';
import type {InputRequirement} from './rust-input-operations.ts';
import {sameOracleObservation,type HostObservation} from '../differential/oracle-runtime.ts';

export type RuntimeInputClaim={role:'bytes'|'ancestor'|'optional-file'|'directory'|'conservative-directory'|'membership'|'observation'|'source-anchor';
  reader:string;path:string;via?:string;context?:ReaderContext;observation?:string;anchor?:{root:string;dev:string;ino:string}};
export type RuntimeClaimAnswer={kind:'claimed';claims:RuntimeInputClaim[]}|{kind:'uncovered';reason:string};
const production=(context:ReaderContext)=>context.entry==='<entry>';
const requestKey=(value:unknown):string=>JSON.stringify(value);
function freeze<T>(value:T,seen=new WeakSet<object>()):T{
  if(value&&typeof value==='object'&&!seen.has(value)){
    seen.add(value);for(const child of Object.values(value))freeze(child,seen);Object.freeze(value);
  }
  return value;
}

/** Exact bytes are taken from files, including data inputs, rather than from
 * placingFiles. Inspection owns bytes without execution placement. A directory
 * declaration never grants arbitrary untracked child content or mutations.
 * Private data grants cannot become production claims by prefix overlap. */
export function compileRuntimeRepositoryClaims(root:string,snapshot:InputSnapshot,options:{memoize?:boolean}={}){
  if(!isAbsolute(root)||resolve(root)!==root)throw Error('Rust input claims need a canonical absolute source root');
  // One index owns one detached graph generation. No caller mutation or
  // filesystem observation can alter a previously compiled pure answer.
  snapshot=structuredClone(snapshot);
  const owned=new Set(snapshot.ownedFiles);
  const bytes=new Map<string,RuntimeInputClaim[]>(),directories=new Map<string,RuntimeInputClaim[]>(),ancestors=new Map<string,RuntimeInputClaim[]>();
  const optional=new Map<string,RuntimeInputClaim[]>(),memberships=new Map<string,RuntimeInputClaim[]>();
  const absentMembers=new Map<string,{claims:RuntimeInputClaim[];names:Set<string>}[]>();
  const conservative:RuntimeInputClaim[]=[];
  const observations=new Map<string,{claim:RuntimeInputClaim;kind:string;value:unknown}[]>();
  const add=(map:Map<string,RuntimeInputClaim[]>,path:string,claim:RuntimeInputClaim)=>{
    const rows=map.get(path)??[];
    if(!rows.some(row=>row.role===claim.role&&row.reader===claim.reader&&row.path===claim.path))rows.push(claim);
    map.set(path,rows);
  };
  const name=(path:string)=>{
    const part=relative(root,path);
    return part==='..'||part.startsWith('..'+sep)||isAbsolute(part)?undefined:part.split(sep).join('/');
  };
  for(const path of snapshot.runtimeFiles??snapshot.files){
    add(bytes,path,{role:'bytes',reader:'<canonical snapshot>',path});
    const parts=path.split('/');parts.pop();
    for(;;){
      add(ancestors,parts.join('/'),{role:'ancestor',reader:'<canonical snapshot>',path:parts.join('/'),via:path});
      if(!parts.length)break;parts.pop();
    }
  }
  for(const row of snapshot.directories){
    if(row.fixture||row.member)continue;
    if(row.kind==='conservative'){
      if(!row.context||!production(row.context))continue;
      const claim:RuntimeInputClaim={role:'conservative-directory',reader:row.reader,path:row.directory,context:row.context};
      conservative.push(claim);
      for(const file of row.files)add(bytes,file,{...claim,path:file,via:row.directory});
    }
    const claim:RuntimeInputClaim={role:'directory',reader:row.reader,path:row.directory};
    add(directories,row.directory,claim);
    // Full declared populations retain their intermediate directory traversal.
    // This is enumeration authority only, never a child-byte prefix rule.
    for(const file of row.files){
      const parts=file.split('/');parts.pop();
      while(parts.length){
        const path=parts.join('/');if(path===row.directory)break;
        add(directories,path,claim);parts.pop();
      }
    }
  }
  for(const row of snapshot.optionalFiles)if(production(row.context))
    add(optional,row.path,{role:'optional-file',reader:row.reader,path:row.path,context:row.context});
  for(const row of snapshot.memberships)if(production(row.context)){
    const claim:RuntimeInputClaim={role:'membership',reader:row.reader,path:row.directory,context:row.context};
    add(memberships,row.directory,claim);
    const rows=absentMembers.get(row.directory)??[];
    rows.push({claims:[claim],names:new Set(row.entries.map(entry=>entry.name))});absentMembers.set(row.directory,rows);
  }
  const missingMember=(path:string)=>{
    const parent=posix.dirname(path),rows=absentMembers.get(parent==='.'?'':parent)??[];
    return rows.filter(row=>!row.names.has(posix.basename(path))).flatMap(row=>row.claims);
  };
  for(const row of snapshot.observations){
    if(row.capability||row.dependency||row.selectorOnly||!production(row.context))continue;
    const path=name(row.observation.path);if(path===undefined)continue;
    const rows=observations.get(path)??[];
    rows.push({claim:{role:'observation',reader:row.reader,path,context:row.context,observation:row.observation.kind},
      kind:row.observation.kind,value:row.observation.value});observations.set(path,rows);
  }
  const matchUncached=(requirement:InputRequirement,identity:InputIdentity):RuntimeClaimAnswer=>{
    const uncovered=(reason:string):RuntimeClaimAnswer=>({kind:'uncovered',reason});
    if(requirement.kind==='unknown')return uncovered(requirement.reason);
    if(requirement.kind==='literal')return uncovered('literal text is not a filesystem dependency');
    if(requirement.kind==='mutation')return uncovered('repository mutation needs its output owner: '+requirement.role);
    if(identity.state==='not-directory')return uncovered('pathname stopped at a non-directory component: '+identity.component);
    if(identity.state==='missing'&&identity.path!==identity.component)
      return uncovered('pathname stopped before its final component: '+identity.component);
    if(resolve(identity.path)!==identity.path)return uncovered('identity is not a resolved component path');
    const path=name(identity.path);if(path===undefined)return uncovered('identity is outside the repository');
    const content=bytes.get(path)??[],candidate=optional.get(path)??[],facts=observations.get(path)??[];
    const claims:RuntimeInputClaim[]=[];
    if(identity.state==='missing')claims.push(...missingMember(path));
    // A marked conservative namespace declares all metadata questions below
    // it. Positive content still needs real immutable bytes in this snapshot;
    // unknown operations, mutations and outside aliases retain their refusals.
    const conservativeScopes=conservative.filter(row=>row.path===''||path===row.path||path.startsWith(row.path+'/'));
    if(['metadata','enumeration','readlink'].includes(requirement.kind)||identity.state==='missing')claims.push(...conservativeScopes);
    if(['content','execute','hard-link-source'].includes(requirement.kind)){
      claims.push(...content,...candidate);
      for(const row of facts)if(row.kind==='file'){
        // A positive callback must also have real immutable bytes in this
        // graph. An absent file callback retains only potential byte identity.
        if(row.value===null||owned.has(path))claims.push(row.claim);
      }
    }else if(requirement.kind==='enumeration'){
      claims.push(...(directories.get(path)??[]),...(memberships.get(path)??[]));
      for(const row of facts)if(['entries','runtimeEntries'].includes(row.kind))claims.push(row.claim);
    }else if(requirement.kind==='readlink'){
      for(const row of facts)if(row.kind==='readlink')claims.push(row.claim);
    }else if(requirement.kind==='metadata'){
      claims.push(...content,...candidate);
      if(requirement.query!=='stat'&&requirement.query!=='permission')
        claims.push(...(ancestors.get(path)??[]),...(directories.get(path)??[]),...(memberships.get(path)??[]));
      for(const row of facts){
        const byteFact=row.kind==='file'&&(row.value===null||owned.has(path));
        const statFact=row.kind==='stat'&&requirement.following!=='no-follow';
        const presenceFact=requirement.query!=='stat'&&requirement.query!=='permission'
          &&(row.kind==='runtimeKind'||requirement.following!=='no-follow'&&['fileExists','directoryExists','realpath','entries','runtimeEntries'].includes(row.kind));
        if(byteFact||statFact||presenceFact)claims.push(row.claim);
      }
    }
    if(!claims.length)return uncovered('no canonical '+requirement.kind+' claim for '+path);
    const unique=new Map(claims.map(row=>[JSON.stringify(row),row]));
    return {kind:'claimed',claims:[...unique.values()]};
  };
  const matches=new Map<string,RuntimeClaimAnswer>(),components=new Map<string,RuntimeClaimAnswer>();
  const counts={matchHits:0,matchMisses:0,componentHits:0,componentMisses:0};
  const match=(requirement:InputRequirement,identity:InputIdentity):RuntimeClaimAnswer=>{
    const key=options.memoize===false?undefined:requestKey([requirement,identity]),cached=key===undefined?undefined:matches.get(key);
    if(cached){counts.matchHits++;return cached;}
    counts.matchMisses++;const answer=freeze(matchUncached(requirement,identity));
    if(key!==undefined)matches.set(key,answer);return answer;
  };
  const componentUncached=(observation:HostObservation):RuntimeClaimAnswer=>{
    const path=name(observation.path),facts=path===undefined?[]:observations.get(path)??[];
    if(path!==undefined&&observation.kind==='runtimeKind'&&observation.value===null){
      const claims=missingMember(path);if(claims.length)return {kind:'claimed',claims};
    }
    const conservativePath=path!==undefined&&conservative.some(row=>row.path===''||path===row.path||path.startsWith(row.path+'/'));
    if(conservativePath){
      const same=facts.some(row=>row.kind===observation.kind&&sameOracleObservation(row.value as HostObservation['value'],observation.value));
      const parent=path===undefined?'':posix.dirname(path),siblings=observations.get(parent==='.'?'':parent)??[];
      const absent=observation.kind==='runtimeKind'&&observation.value===null&&path!==undefined&&siblings.some(row=>row.kind==='runtimeEntries'
        &&Array.isArray(row.value)&&!row.value.includes(posix.basename(path)));
      // A namespace obligation cannot bless a newly introduced link, even
      // when another generic byte/directory role also names its endpoint.
      if(!same&&!absent)return {kind:'uncovered',reason:'current conservative component differs from its captured kind/link: '+observation.path};
    }
    const requirement:InputRequirement=observation.kind==='readlink'?{kind:'readlink',following:'no-follow'}:{kind:'metadata',query:'path',following:'no-follow'};
    const answer=match(requirement,{state:'resolved',path:observation.path});if(answer.kind!=='claimed')return answer;
    const claims=answer.claims.filter(claim=>claim.role!=='observation'||facts.some(row=>row.kind===observation.kind
      &&row.claim.reader===claim.reader&&sameOracleObservation(row.value as HostObservation['value'],observation.value)));
    return claims.length?{kind:'claimed',claims}:{kind:'uncovered',reason:'current component differs from its canonical fact: '+observation.path};
  };
  return Object.freeze({match,matchComponent(observation:HostObservation):RuntimeClaimAnswer{
    const key=options.memoize===false?undefined:requestKey(observation),cached=key===undefined?undefined:components.get(key);
    if(cached){counts.componentHits++;return cached;}
    counts.componentMisses++;const answer=freeze(componentUncached(observation));
    if(key!==undefined)components.set(key,answer);return answer;
  },statistics:()=>({...counts,matchEntries:matches.size,componentEntries:components.size})});
}

/** Mutable public answers remain detached; streaming validation consumes the
 * frozen compiled answers directly without cloning them for each attempt. */
export function runtimeRepositoryClaims(root:string,snapshot:InputSnapshot){
  const compiled=compileRuntimeRepositoryClaims(root,snapshot);
  return {match:(requirement:InputRequirement,identity:InputIdentity)=>structuredClone(compiled.match(requirement,identity)),
    matchComponent:(observation:HostObservation)=>structuredClone(compiled.matchComponent(observation))};
}
