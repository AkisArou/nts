// Raw events are evidence until a completed green run has a cost summary.
// This owner removes only costs/, under its own collector lock. It never
// discovers historical temporaries or changes a summary or a run log.
import {lstatSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,unlinkSync,type Stats} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {durableRecord} from '../gate/durable-record.ts';
import {GateResource} from '../gate/gate-resource.ts';
import {liveReclaimOwnership,type ReclaimOwnership} from '../gate/disk-reclamation.ts';
import {hostObservations,type HostObservations} from '../gate/host-observations.ts';

export const RAW_COST_COMPLETED_RUNS=3;
export type CostRetention={removed:{run:string;allocatedBytes:number}[];kept:{run:string;reason:string}[]};
type Options={roots:readonly string[];host?:HostObservations;ownership?:ReclaimOwnership;removePayload?:(path:string,remove:()=>void)=>void};
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
function terminal(run:string){
  const summaryText=regular(join(run,'summary.json')),summary=JSON.parse(summaryText) as Record<string,unknown>;
  if(summary?.schema!==1)throw Error('unknown summary schema');
  const lifecycle=record(join(run,'run-lifecycle.json'));
  if(lifecycle.version!==1||!Number.isSafeInteger(lifecycle.events)||Number(lifecycle.events)<0||!Array.isArray(lifecycle.running)||lifecycle.running.length)
    throw Error('unknown or unfinished terminal lifecycle');
  // The full-check's outer supervisor can hold a green inner runner. An
  // absent supervisor record is normal for hand/landing runs; a present one
  // must be known, readable and closed. A hold receipt always protects raw.
  let progressText:string|null=null;
  try{
    progressText=regular(join(run,'measurement-progress.json'));
    const progress=JSON.parse(progressText) as Record<string,unknown>;
    if(progress?.version!==1||progress.live!==false)throw Error('unknown or live measurement terminal state');
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  try{lstatSync(join(run,'measurement-hold.txt'));throw Error('held measurement');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const started=typeof summary.started==='string'?Date.parse(summary.started):NaN;
  if(!Number.isFinite(started)||typeof summary.wall_s!=='number'||!Number.isFinite(summary.wall_s)||summary.wall_s<0||
    (summary.scope_cleanup as {state?:unknown}|undefined)?.state!=='complete'||summary.interrupted!==false)
    throw Error('missing or unfinished terminal summary');
  const verdict=summary.verdict;
  if(verdict!=='green'&&verdict!=='red')throw Error('unknown terminal verdict');
  return {summary,summaryText,progressText,finished:started+summary.wall_s*1000};
}

export function pruneRawCosts(options:Options):CostRetention{
  const result:CostRetention={removed:[],kept:[]};
  const host=options.host??hostObservations(),ownership=options.ownership??liveReclaimOwnership;
  for(const root of options.roots){
    let lock:GateResource|null=null;
    try{
      let rootIdentity:Stats;
      try{rootIdentity=directory(root);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
      lock=GateResource.tryAcquire(join(root,'.cost-retention.lock'));
      if(!lock){result.kept.push({run:root,reason:'raw-cost collector lock held'});continue;}
      const completed:{run:string;identity:Stats;terminal:ReturnType<typeof terminal>}[]=[];
      for(const name of readdirSync(root)){
        if(name.startsWith('.'))continue;
        const run=join(root,name);
        try{const identity=directory(run);completed.push({run,identity,terminal:terminal(run)});}
        catch(error){result.kept.push({run,reason:String(error)});}
      }
      completed.sort((a,b)=>b.terminal.finished-a.terminal.finished||b.run.localeCompare(a.run));
      for(const [index,row] of completed.entries()){
        const {run}=row;
        try{
          if(index<RAW_COST_COMPLETED_RUNS)throw Error('newest three completed runs');
          if(row.terminal.summary.verdict!=='green')throw Error('non-green run');
          const costs=row.terminal.summary.case_costs as {version?:unknown;status?:unknown;steps?:unknown}|undefined;
          if(costs?.version!==1||costs.status!=='complete'||!costs.steps||typeof costs.steps!=='object'||Array.isArray(costs.steps))
            throw Error('case_costs not completely materialized');
          const receipt=join(run,'.cost-retention.json');
          type Detach={version:1;name:string;dev:number;ino:number;uid:number;summary:string};
          let parked:Detach|null=null;
          try{
            const value=record(receipt);
            if(value.version!==1||typeof value.name!=='string'||!/^\.retired-costs-[a-f0-9-]{36}$/.test(value.name)||
              !['dev','ino','uid'].every(key=>Number.isSafeInteger(value[key]))||typeof value.summary!=='string')throw Error('unknown raw-cost detach receipt');
            parked=value as Detach;
          }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
          const digest=createHash('sha256').update(row.terminal.summaryText).digest('hex');
          if(parked&&parked.summary!==digest)throw Error('raw-cost detach summary changed');
          const ordinary=join(run,'costs'),detached=join(run,parked?.name??'.retired-costs-'+randomUUID());
          const path=parked&&lstatExists(detached)?detached:ordinary;
          let identity:Stats;
          try{identity=directory(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
          if(parked&&(parked.dev!==identity.dev||parked.ino!==identity.ino||parked.uid!==identity.uid))throw Error('raw-cost detach identity changed');
          const allocatedBytes=host.allocatedBytes(path);
          ownership(run,path);
          if(!same(rootIdentity,directory(root))||!same(row.identity,directory(run))||!same(identity,directory(path)))throw Error('raw-cost directory identity changed');
          const current=terminal(run);
          if(current.summaryText!==row.terminal.summaryText||current.progressText!==row.terminal.progressText)throw Error('terminal record changed');
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
        }catch(error){result.kept.push({run,reason:String(error)});}
      }
    }catch(error){result.kept.push({run:root,reason:String(error)});}
    finally{lock?.close();}
  }
  return result;
}
