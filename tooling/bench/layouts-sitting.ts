// Bench and command-cost adapters share scheduling, failure retention and
// inference. Adapters own their exact output/work and counter-scope checks.
import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {inferLayouts,random,type IntervalOptions} from './layouts-interval.ts';

export type Arm = 'base' | 'changed';
export type Trial = {id: string; geometry: Record<Arm,string>; heapSeed: Record<Arm,number>};
export type Cell = {trial: Trial; arm: Arm; phase: 'equivalence' | 'paired'; round: number; position: number; folder: string};
export type Observation = {signature: string; metrics: Record<string,number>; details?: unknown};
export type Adapter = {admit: () => Promise<unknown>; run: (cell: Cell) => Promise<Observation>};
export type SittingOptions = IntervalOptions & {rounds?: number; orderSeed?: number; primary: string};

export function validateTrials(trials: readonly Trial[], options: SittingOptions) {
  if (trials.length < 20 || trials.length > 1000 || new Set(trials.map(t => t.id)).size !== trials.length)
    throw Error('twenty unique code/heap trials required');
  for (const arm of ['base','changed'] as const) {
    if (new Set(trials.map(t => t.geometry[arm])).size !== trials.length || trials.some(t => !t.geometry[arm]))
      throw Error('distinct verified code geometry required for each arm');
    if (new Set(trials.map(t => t.heapSeed[arm])).size !== trials.length) throw Error('distinct heap seeds required');
    for (const t of trials) random(t.heapSeed[arm]);
  }
  if (trials.some(t => !/^[a-zA-Z0-9_-]+$/.test(t.id))) throw Error('invalid trial id');
  const rounds=options.rounds??3;
  if (!Number.isSafeInteger(rounds) || rounds<3 || rounds>25 || !options.primary) throw Error('invalid sitting options');
  random(options.orderSeed??0x2468ace1);
  // Validate inference limits without executing any command.
  inferLayouts(trials.map(t => ({id:t.id,rounds:Array.from({length:rounds},()=>({before:1,changed:1,after:1}))})),options);
}

export async function sampleLayouts(trials: readonly Trial[], output: string, adapter: Adapter, options: SittingOptions) {
  validateTrials(trials,options);
  mkdirSync(output);
  const rows: any[]=[];
  let current: any=null, signature: string|undefined, metrics: string[]|undefined, completed=0;
  const save=(state:string)=>{
    if(state!=='RUNNING')writeFileSync(join(output,'rows.json'),JSON.stringify(rows,null,2)+'\n');
    writeFileSync(join(output,'checkpoint.json'),JSON.stringify({state,current,completed,utc:new Date().toISOString()},null,2)+'\n');
  };
  const retain=(row:any)=>{rows.push(row);appendFileSync(join(output,'rows.jsonl'),JSON.stringify(row)+'\n');};
  const cell=async(trial:Trial,arm:Arm,phase:Cell['phase'],round:number,position:number)=>{
    const start=await adapter.admit();
    const folder=join(output,String(rows.length).padStart(4,'0')+'-'+trial.id+'-'+arm+'-'+phase);
    mkdirSync(folder);current={trial:trial.id,arm,phase,round,position,folder,start};save('RUNNING');
    try {
      const observed=await adapter.run({trial,arm,phase,round,position,folder});
      if (!observed.signature || (signature!==undefined&&observed.signature!==signature)) throw Error('work/output signature changed');
      signature=observed.signature;
      if (phase==='paired') {
        const keys=Object.keys(observed.metrics).sort();
        if (!keys.includes(options.primary) || (metrics&&keys.join()!==metrics.join()) || keys.some(k=>
          !Number.isFinite(observed.metrics[k])||observed.metrics[k]<=0||observed.metrics[k]>Number.MAX_SAFE_INTEGER)) throw Error('invalid/inconsistent measurement metrics');
        metrics=keys;
      }
      retain({...current,state:'PASS',observed});completed++;current=null;save('RUNNING');
    } catch(error) {
      retain({...current,state:'FAIL',error:String(error)});save('FAIL');throw error;
    }
  };
  writeFileSync(join(output,'plan.json'),JSON.stringify({trials,options},null,2)+'\n');
  for (const trial of trials) for (const arm of ['base','changed'] as const) await cell(trial,arm,'equivalence',-1,0);
  const rounds=options.rounds??3,draw=random(options.orderSeed??0x2468ace1);
  for(let round=0;round<rounds;round++) {
    const order=[...trials];
    for(let i=order.length-1;i>0;i--){const j=draw()%(i+1);[order[i],order[j]]=[order[j],order[i]];}
    for(const trial of order) for(const [position,arm] of (['base','changed','base'] as const).entries())
      await cell(trial,arm,'paired',round,position);
  }
  if(current!==null||rows.length!==trials.length*(2+rounds*3)||!metrics) throw Error('incomplete sitting');
  const brackets=new Map<string,any[]>();
  for(const row of rows)if(row.phase==='paired'){
    const key=row.trial+'\0'+row.round;
    const bracket=brackets.get(key)??[];bracket.push(row);brackets.set(key,bracket);
  }
  const summary=Object.fromEntries(metrics.map(metric=>[metric,inferLayouts(trials.map(trial=>({id:trial.id,
    rounds:Array.from({length:rounds},(_,round)=>{
      const bracket=brackets.get(trial.id+'\0'+round)??[];
      if(bracket.length!==3||bracket.map(r=>r.arm).join()!=='base,changed,base')throw Error('incomplete bracket');
      return {before:bracket[0].observed.metrics[metric],changed:bracket[1].observed.metrics[metric],after:bracket[2].observed.metrics[metric]};
    })})),options)]));
  writeFileSync(join(output,'summary.json'),JSON.stringify({primary:options.primary,verdict:summary[options.primary].verdict,metrics:summary},null,2)+'\n');
  save('PASS');return summary;
}
