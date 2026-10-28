import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {inferLayouts} from './layouts-interval.ts';
import {validateTrials} from './layouts-sitting.ts';

export function intervalTable(summaries:any[]){
 const pct=(v:number)=>(100*v).toFixed(2)+'%';
 let text='# Randomized layout A/B intervals\n\nIndependent joint code/heap draws have equal weight. Repeated hot brackets are not independent samples. Verdicts use the configured empirical cluster-bootstrap interval. Its scope is the chosen sampler and observed sitting.\n\n';
 text+='| Control / row | Backend | Layouts/arm | Metric | Mean delta | Confidence interval | A/B layout range | Per-layout delta range | Verdict |\n|---|---|---:|---|---:|---|---|---|---|\n';
 for(const s of summaries)for(const [metric,r]of Object.entries<any>(s.metrics))text+='| '+[s.name,s.backend,r.independentLayouts,metric,pct(r.delta),`${pct(r.confidence)} [${pct(r.interval.low)}, ${pct(r.interval.high)}]`,pct(r.base.relativeRange)+' / '+pct(r.changed.relativeRange),pct(r.perLayoutDelta.min)+' to '+pct(r.perLayoutDelta.max),r.verdict].join(' | ')+' |\n';
 return text+'\nAll draws remain in the record. Heap padding is live startup placement; native hot windows exclude it. Peak RSS includes it and is not an unperturbed memory baseline.\n';
}

const json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
export function checkedIntervalCase(directory:string){
 const plan=json(join(directory,'plan.json')),checkpoint=json(join(directory,'checkpoint.json')),rows=json(join(directory,'rows.json')),summary=json(join(directory,'summary.json'));
 validateTrials(plan.trials,plan.options);
 const rounds=plan.options.rounds??3,expected=plan.trials.length*(2+3*rounds);
 if(checkpoint.state!=='PASS'||checkpoint.current!==null||checkpoint.completed!==expected||rows.length!==expected
   ||rows.some(r=>r.state!=='PASS'||!r.observed?.signature))throw Error('incomplete or failed interval case');
 if(new Set(rows.map(r=>r.observed.signature)).size!==1)throw Error('changed work/output signature');
 const ids=new Set(plan.trials.map(t=>t.id)),keys=new Set<string>();
 for(const row of rows){
  const valid=row.phase==='equivalence'?row.round===-1&&row.position===0&&['base','changed'].includes(row.arm)
   :row.phase==='paired'&&Number.isSafeInteger(row.round)&&row.round>=0&&row.round<rounds&&[0,1,2].includes(row.position)&&row.arm===(row.position===1?'changed':'base');
  const key=JSON.stringify([row.trial,row.phase,row.round,row.position,row.arm]);
  if(!ids.has(row.trial)||!valid||keys.has(key))throw Error('duplicate or invalid interval coverage');keys.add(key);
 }
 const paired=rows.filter(r=>r.phase==='paired'),metrics=Object.keys(paired[0].observed.metrics).sort();
 if(metrics.join()!==Object.keys(summary.metrics).sort().join()||!metrics.includes(plan.options.primary))throw Error('missing measurement metric');
 if(paired.some(r=>Object.keys(r.observed.metrics).sort().join()!==metrics.join()))throw Error('inconsistent metric population');
 const brackets=new Map<string,any[]>();
 for(const row of paired){const key=row.trial+'\0'+row.round,bracket=brackets.get(key)??[];bracket.push(row);brackets.set(key,bracket);}
 const verified:Record<string,ReturnType<typeof inferLayouts>>={};
 for(const metric of metrics){
  const observations=plan.trials.map(trial=>({id:trial.id,rounds:Array.from({length:rounds},(_,round)=>{
   const b=brackets.get(trial.id+'\0'+round)??[];
   if(b.length!==3||b.map(r=>r.arm).join()!=='base,changed,base')throw Error('invalid bracket');
   return {before:b[0].observed.metrics[metric],changed:b[1].observed.metrics[metric],after:b[2].observed.metrics[metric]};
  })}));
  const result=inferLayouts(observations,plan.options);
  if(JSON.stringify(result)!==JSON.stringify(summary.metrics[metric]))throw Error('summary does not match complete raw layouts');
  verified[metric]=result;
 }
 if(summary.primary!==plan.options.primary||summary.verdict!==verified[summary.primary].verdict)throw Error('primary verdict mismatch');
 const scopes=[...new Set(paired.map(r=>r.observed.details?.scope??'adapter-defined'))];
 if(scopes.length!==1)throw Error('mixed counter scopes');
 return {metrics:verified,rows,scope:scopes[0],completed:expected};
}

export function recordIntervals(input:string,output:string,provenance:unknown=null){
 const checkpoint=json(join(input,'checkpoint.json')),summaries=json(join(input,'summary.json'));
 if(checkpoint.state!=='PASS'||checkpoint.current!==null||checkpoint.pairs!==summaries.length||!summaries.length)throw Error('incomplete parent sitting');
 const seen=new Set<string>(),allRows:any[]=[],verified=[];
 for(const summary of summaries){
  const key=summary.name+'-'+summary.backend;
  if(!/^[a-zA-Z0-9_-]+$/.test(summary.name)||!['c','llvm'].includes(summary.backend)||seen.has(key))throw Error('invalid pair');seen.add(key);
  const result=checkedIntervalCase(join(input,key));
  if(JSON.stringify(result.metrics)!==JSON.stringify(summary.metrics))throw Error('parent summary mismatch');
  verified.push({name:summary.name,backend:summary.backend,scope:result.scope,completed:result.completed,metrics:result.metrics});allRows.push(...result.rows);
 }
 const loads=allRows.map(r=>Number(r.start?.load?.split(' ')[0]));
 if(loads.some(n=>!Number.isFinite(n)))throw Error('missing machine load');
 const conditions={start:allRows.map(r=>r.start.utc).sort()[0],end:allRows.map(r=>r.observed.details.end.utc).sort().at(-1),
  loadMin:Math.min(...loads),loadMax:Math.max(...loads),trains:[...new Set(allRows.map(r=>JSON.stringify(r.start.train)))].map(s=>JSON.parse(s))};
 mkdirSync(output,{recursive:true});
 writeFileSync(join(output,'summary.json'),JSON.stringify({conditions,provenance,cases:verified},null,2)+'\n');
 writeFileSync(join(output,'report.md'),intervalTable(verified)+`\nSitting ${conditions.start}–${conditions.end}; load ${conditions.loadMin}–${conditions.loadMax}. Train state and input/control provenance remain in summary.json.\n`);
 copyFileSync(join(input,'checkpoint.json'),join(output,'checkpoint.json'));
 return {cases:verified.length,cells:allRows.length,conditions};
}
