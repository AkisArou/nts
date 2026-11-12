// Immutable oracle run seals. This leaf imports only Node builtins so Cargo
// test entry points can validate preparation without importing the launchers.
import {appendFileSync,lstatSync} from 'node:fs';
import {dirname,isAbsolute,join} from 'node:path';

export const ENVIRONMENT_CONTEXT='NTS_GATE_ENV_CONTEXT';
/** A canonical parent pins this read-only record after complete validation. */
export type DependencySealIdentity={dev:string;ino:string;uid:string;mode:string;nlink:string;size:string;mtimeNs:string;ctimeNs:string};
export type DependencyRunSeal={version:1;nodeVersion:string;record:string;readySha256:string;semanticSha256:string;identity:DependencySealIdentity};
export const DEPENDENCY_SEAL_FIELDS=['dev','ino','uid','mode','nlink','size','mtimeNs','ctimeNs'] as const;
export function dependencySealIdentity(file:string):DependencySealIdentity{
  const info=lstatSync(file,{bigint:true});
  if(!info.isFile()||info.nlink!==1n||(info.mode&0o222n)!==0n)throw dependencySealError(file);
  return Object.fromEntries(DEPENDENCY_SEAL_FIELDS.map(key=>[key,String(info[key])])) as DependencySealIdentity;
}
export function dependencySealError(record:string):Error&{code:string}{
  return Object.assign(new Error('oracle dependency seal changed: '+record),{code:'NTS_ORACLE_SEAL_CHANGED'});
}
/** Only exact owned canonical handoffs can carry a run seal. */
export function ownsDependencyRun(cap:{seal?:DependencyRunSeal},env:NodeJS.ProcessEnv,required=false):boolean{
  if(!required&&!cap.seal)return false;
  const raw=env.NTS_ORACLE_DEPENDENCIES,declared=env.NTS_GATE_ENV_CONTEXT;
  if(!declared){if(required)throw dependencySealError(cap.seal?.record??'missing canonical run');return false;}
  try{
    const context=JSON.parse(declared);
    if(!raw||JSON.stringify(cap)!==raw||context.report?.version!==1||context.owned?.NTS_ORACLE_DEPENDENCIES!==raw||context.report.host?.NTS_ORACLE_DEPENDENCIES!==raw)throw Error('invalid owned handoff');
    return true;
  }catch{throw dependencySealError(cap.seal?.record??'invalid canonical handoff');}
}
/** One lstat and compare; no source, package, Git or helper-process work. */
export function dependencySealReady(cap:{version:number;directory:string;ownerStep?:string|null;admission?:{kind:string;temporary?:{parent:string}};seal?:DependencyRunSeal},env:NodeJS.ProcessEnv=process.env,nodeVersion=process.versions.node):string|null{
  if(!ownsDependencyRun(cap,env))return null;
  const began=performance.now(),seal=cap.seal!,record=join(cap.directory,'node-'+nodeVersion,'ready.json');
  const identity=seal.identity;
  if(cap.version!==1||seal.version!==1||seal.record!==record||seal.nodeVersion!==nodeVersion||!isAbsolute(cap.directory)||
     !/^26\.\d+\.\d+$/.test(nodeVersion)||!identity||Object.keys(identity).sort().join(',')!==[...DEPENDENCY_SEAL_FIELDS].sort().join(',')||
     DEPENDENCY_SEAL_FIELDS.some(key=>typeof identity[key]!=='string'||!/^\d+$/.test(identity[key]))||
     !/^[0-9a-f]{64}$/.test(seal.readySha256)||!/^[0-9a-f]{64}$/.test(seal.semanticSha256))throw dependencySealError(record);
  try{const actual=dependencySealIdentity(record);if(DEPENDENCY_SEAL_FIELDS.some(key=>actual[key]!==identity[key]))throw dependencySealError(record);}
  catch{throw dependencySealError(record);}
  // Telemetry never changes product authority and never fsyncs a hit.
  try{
    const root=cap.admission?.kind==='gate'?cap.admission.temporary?.parent:cap.directory;
    if(root)appendFileSync(join(root,'oracle-dependency-calls.jsonl'),JSON.stringify({version:1,step:cap.ownerStep??null,nodeVersion,directory:dirname(record),mode:'hit',sealed:true,helperProcess:false,wallMs:performance.now()-began,pnpmSelectionCommands:0})+'\n');
  }catch{}
  return record;
}

/** A supplied run must already own the complete pinned oracle services. */
export function assertSealedOracleRun(env:NodeJS.ProcessEnv):void{
  const raw=env.NTS_ORACLE_DEPENDENCIES;
  let cap:Parameters<typeof dependencySealReady>[0]|undefined,context:{resolutionOwner?:unknown}|null=null;
  try{
    cap=raw?JSON.parse(raw) as Parameters<typeof dependencySealReady>[0]:undefined;
    context=JSON.parse(env[ENVIRONMENT_CONTEXT]??'null') as {resolutionOwner?:unknown}|null;
  }catch{/* named setup refusal below */}
  if(!cap?.seal||process.platform==='linux'&&!context?.resolutionOwner)
    throw Error('supplied gate environment is not sealed for oracle runs; seal it with sealOracleRun');
  ownsDependencyRun(cap,env,true);dependencySealReady(cap,env);
}
