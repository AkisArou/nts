// Raw events are evidence until a completed green run has a cost summary.
// This owner removes only costs/, under its own collector lock. It never
// discovers historical temporaries or changes a summary or a run log.
import {lstatSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,unlinkSync,type Stats} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {durableRecord} from '../gate/durable-record.ts';
import {readSummaryFacts,summaryDigest} from './summary-facts.ts';
import {GateResource} from '../gate/gate-resource.ts';
import {liveReclaimOwnership,type ReclaimOwnership} from '../gate/disk-reclamation.ts';
import {hostObservations,type HostObservations} from '../gate/host-observations.ts';

export const RAW_COST_COMPLETED_RUNS=3;
export type CostRetention={removed:{run:string;allocatedBytes:number}[];kept:{run:string;reason:string;routine:boolean}[]};
type Options={roots:readonly string[];onlyRun?:string;host?:HostObservations;ownership?:ReclaimOwnership;removePayload?:(path:string,remove:()=>void)=>void;inventoryOnly?:boolean};
const same=(a:Stats,b:Stats)=>a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid;
function directory(path:string):Stats{
  const info=lstatSync(path);
  if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||realpathSync(path)!==resolve(path))
    throw Error('not an owned physical directory: '+path);
  return info;
}
function lstatExists(path:string):boolean{try{lstatSync(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}}
function regular(path:string):string{
  const info=lstatSync(path);
  if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid?.())throw Error('not an owned regular record: '+path);
  return readFileSync(path,'utf8');
}
function record(path:string):Record<string,unknown>{
  const value:unknown=JSON.parse(regular(path));
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid record: '+path);
  return value as Record<string,unknown>;
}
/** Unknown, future, unreadable or missing terminal state grants no removal. */
function terminalState(run:string){
  const lifecycleText=regular(join(run,'run-lifecycle.json')),lifecycle=JSON.parse(lifecycleText) as Record<string,unknown>;
  if(lifecycle?.version!==1||!Number.isSafeInteger(lifecycle.events)||Number(lifecycle.events)<0||!Array.isArray(lifecycle.running)||lifecycle.running.length)
    throw Error('unknown or unfinished terminal lifecycle');
  let progressText:string|null=null;
  try{
    progressText=regular(join(run,'measurement-progress.json'));
    const progress=JSON.parse(progressText) as Record<string,unknown>;
    if(progress?.version!==1||progress.live!==false)throw Error('unknown or live measurement terminal state');
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  try{lstatSync(join(run,'measurement-hold.txt'));throw Error('held measurement');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  return {lifecycleDigest:createHash('sha256').update(lifecycleText).digest('hex'),
    progressDigest:progressText===null?null:createHash('sha256').update(progressText).digest('hex')};
}
function terminal(run:string){
  const state=terminalState(run),summary=readSummaryFacts(join(run,'summary.json'));
  const scalar=(path:string)=>{const fact=summary.facts.get(path);return fact?.kind==='scalar'?fact.value:undefined;};
  if(scalar('schema')!==1)throw Error('unknown summary schema');
  const verdict=scalar('verdict');
  if(verdict!=='green'&&verdict!=='red')throw Error('unknown terminal verdict');
  const started=typeof scalar('started')==='string'?Date.parse(scalar('started') as string):NaN,wall=scalar('wall_s');
  const finished=started+Number(wall)*1000;
  if(!Number.isFinite(started)||typeof wall!=='number'||!Number.isFinite(wall)||wall<0||!Number.isFinite(finished)){
    if(verdict==='red')throw new RoutineKeep('non-green run without an ordering timestamp');
    throw Error('missing or invalid terminal timestamp');
  }
  // A readable known red summary is a policy keep even after interruption or
  // failed cleanup. Only green deletion candidates need these completion facts.
  if(verdict==='green'&&(scalar('scope_cleanup.state')!=='complete'||scalar('interrupted')!==null))
    throw Error('interrupted or incomplete green cleanup');
  // summarizeCosts sets partial for errors.length || missingChecks ||
  // checks.some(c => !c.complete). Coverage gaps and incomplete cases are
  // materialized too; reader failures alone require raw evidence.
  const errors=summary.facts.get('case_costs.errors');
  const costFailure=scalar('case_costs.version')!==1||!['complete','partial'].includes(String(scalar('case_costs.status')))||
    scalar('case_costs.error_count')!==0||errors?.kind!=='array'||!errors.empty||summary.facts.get('case_costs.steps')?.kind!=='object';
  const reason=scalar('environment.canonical')!==true?'noncanonical or unknown environment':
    costFailure?'case_costs not materialized without reader errors':null;
  return {verdict,reason,...state,summaryDigest:summary.digest,finished};
}
class RoutineKeep extends Error{}

export function pruneRawCosts(options:Options):CostRetention{
  const result:CostRetention={removed:[],kept:[]};
  const keep=(run:string,error:unknown,routine=error instanceof RoutineKeep)=>result.kept.push({run,reason:String(error),routine});
  const host=options.host??hostObservations(),ownership=options.ownership??liveReclaimOwnership;
  for(const root of options.roots){
    let lock:GateResource|null=null;
    try{
      let rootIdentity:Stats;
      try{rootIdentity=directory(root);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
      lock=GateResource.tryAcquire(root+'.cost-retention.lock');
      if(!lock){keep(root,'raw-cost collector lock held');continue;}
      const completed:{run:string;identity:Stats;terminal:ReturnType<typeof terminal>}[]=[];
      for(const name of readdirSync(root)){
        if(name.startsWith('.'))continue;
        const run=join(root,name);
        try{
          const info=lstatSync(run);
          if(!info.isDirectory()||info.isSymbolicLink())throw new RoutineKeep('not a run directory');
          const identity=directory(run);
          if(!lstatExists(join(run,'costs'))&&!lstatExists(join(run,'.cost-retention.json')))throw new RoutineKeep('no raw costs or detach receipt');
          if(!lstatExists(join(run,'summary.json')))throw new RoutineKeep('no summary.json');
          completed.push({run,identity,terminal:terminal(run)});
        }catch(error){keep(run,error);}
      }
      // Runs with no raw payload cannot lose evidence. Ranking the remaining
      // completed runs conservatively retains at least the newest three overall.
      completed.sort((a,b)=>b.terminal.finished-a.terminal.finished||b.run.localeCompare(a.run));
      for(const [index,row] of completed.entries()){
        const {run}=row;
        try{
          if(options.onlyRun!==undefined&&resolve(run)!==resolve(options.onlyRun))throw new RoutineKeep('outside selected candidate');
          if(index<RAW_COST_COMPLETED_RUNS)throw new RoutineKeep('newest three completed runs');
          if(row.terminal.verdict!=='green')throw new RoutineKeep('non-green run');
          if(row.terminal.reason)throw Error(row.terminal.reason);
          const receipt=join(run,'.cost-retention.json');
          type Detach={version:1;name:string;dev:number;ino:number;uid:number;summary:string};
          let parked:Detach|null=null;
          try{
            const value=record(receipt);
            if(value.version!==1||typeof value.name!=='string'||!/^\.retired-costs-[a-f0-9-]{36}$/.test(value.name)||
              !['dev','ino','uid'].every(key=>Number.isSafeInteger(value[key]))||typeof value.summary!=='string')throw Error('unknown raw-cost detach receipt');
            parked=value as Detach;
          }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
          const digest=row.terminal.summaryDigest;
          if(parked&&parked.summary!==digest)throw Error('raw-cost detach summary changed');
          const ordinary=join(run,'costs'),detached=join(run,parked?.name??'.retired-costs-'+randomUUID());
          const path=parked&&lstatExists(detached)?detached:ordinary;
          let identity:Stats;
          try{identity=directory(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
          if(parked&&(parked.dev!==identity.dev||parked.ino!==identity.ino||parked.uid!==identity.uid))throw Error('raw-cost detach identity changed');
          const allocatedBytes=host.allocatedBytes(path);
          ownership(run,path);
          if(!same(rootIdentity,directory(root))||!same(row.identity,directory(run))||!same(identity,directory(path)))throw Error('raw-cost directory identity changed');
          const current=terminalState(run);
          if(summaryDigest(join(run,'summary.json'))!==row.terminal.summaryDigest||current.lifecycleDigest!==row.terminal.lifecycleDigest||current.progressDigest!==row.terminal.progressDigest)throw Error('terminal record changed');
          if(options.inventoryOnly){keep(run,new RoutineKeep('inventory only: eligible raw costs'));continue;}
          // A private sibling detachment fixes the deletion grant to the
          // observed directory. A new producer at costs/ is outside it.
          if(path===ordinary){
            durableRecord(receipt,{version:1,name:detached.slice(run.length+1),dev:identity.dev,ino:identity.ino,uid:identity.uid,summary:digest});
            renameSync(path,detached);
          }
          const remove=()=>rmSync(detached,{recursive:true});
          if(options.removePayload)options.removePayload(detached,remove);else remove();
          unlinkSync(receipt);
          result.removed.push({run,allocatedBytes});
        }catch(error){keep(run,error);}
      }
    }catch(error){keep(root,error);}
    finally{lock?.close();}
  }
  return result;
}
