// The only writer of empirical --count bands. Samples, not source constants,
// decide the bands; the record keeps the complete cohort and its provenance.
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {durableRecord} from '../gate/durable-record.ts';
import {runAsCommand} from '../differential/command-entry/main.ts';
import {COUNT_INSTRUMENT} from './count-driver.ts';

export const COUNT_BANDS=fileURLToPath(new URL('../../results/benchmarks/count-bands.json',import.meta.url));
function fail(what:string):never{throw Error('count bands: '+what);}
const object=(value:unknown,name:string):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return fail(name+' is not an object');
  return value as Record<string,unknown>;
};
const positive=(value:unknown,name:string):number=>{
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)return fail(name+' is not a positive safe integer');
  return value;
};

export function deriveBands(input:unknown,metadata:unknown){
  if(!Array.isArray(input)||input.length<2)fail('at least two complete runs are required');
  const provenance=object(metadata,'provenance');
  if(provenance.version!==1)fail('unsupported provenance version '+String(provenance.version));
  if(provenance.instrument!==COUNT_INSTRUMENT)fail('cohort has an unsupported count instrument');
  if(typeof provenance.source_commit!=='string'||! /^[a-f0-9]{40}$/.test(provenance.source_commit))fail('provenance has no source commit');
  if(typeof provenance.binary_sha256!=='string'||! /^[a-f0-9]{64}$/.test(provenance.binary_sha256))fail('provenance has no binary SHA-256');
  for(const key of ['case','profile','unit','host'])if(typeof provenance[key]!=='string'||!String(provenance[key]).trim())fail('provenance has no '+key);
  if(!Array.isArray(provenance.command)||!provenance.command.includes('--count')||provenance.command.some(x=>typeof x!=='string'||!x))fail('provenance has no --count command');
  if(!Number.isSafeInteger(provenance.counter_cpu)||(provenance.counter_cpu as number)<0||[4,5].includes(provenance.counter_cpu as number)||provenance.measurement_lock!==false)fail('cohort must count outside CPUs 4-5 without the lock');
  if(!Array.isArray(provenance.columns)||!provenance.columns.length)fail('provenance has no columns');
  const names=provenance.columns.map((value,index)=>{
    const name=object(value,'column '+index).name;
    if(typeof name!=='string'||!name.trim())return fail('column '+index+' has no name');
    return name;
  });
  if(new Set(names).size!==names.length)fail('column names repeat');
  const runs=input.map((value,index)=>{
    const row=object(value,'run '+index);
    if(row.run!==index||row.commit!==provenance.source_commit)fail('run '+index+' has a different identity or order');
    if(!Array.isArray(row.counts)||row.counts.length!==names.length)fail('run '+index+' has incomplete columns');
    if(typeof row.wall_s!=='number'||!Number.isFinite(row.wall_s)||row.wall_s<0||!Array.isArray(row.load)||row.load.length!==3||row.load.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0))fail('run '+index+' has invalid observation context');
    return {run:index,wall_s:row.wall_s,load:row.load as number[],counts:row.counts.map((x,column)=>positive(x,`run ${index} column ${column}`))};
  });
  if(provenance.runs!==runs.length)fail('provenance run count disagrees with the cohort');
  const {columns:_derivedColumns,...origin}=provenance;
  return {version:1,measure:'net-instructions:u/per-op',definition:'max-minus-min-over-min-ceil-bp-v1',provenance:origin,
    observations:runs.map(({counts:_,...context})=>context),
    columns:names.map((name,index)=>{
      const samples=runs.map(run=>run.counts[index]!);
      const low=Math.min(...samples),high=Math.max(...samples);
      const numerator=BigInt(high-low)*10000n,denominator=BigInt(low);
      const band=Number((numerator+denominator-1n)/denominator);
      if(!Number.isSafeInteger(band))fail('derived band is not a safe integer for '+name);
      return {name,samples,min:low,max:high,band_basis_points:band};
    })};
}

export function writeBands(cohort:string,provenance:string,output=COUNT_BANDS){
  const bytes=readFileSync(cohort),origin=object(JSON.parse(readFileSync(provenance,'utf8')),'provenance');
  if(origin.raw_cohort_sha256!==createHash('sha256').update(bytes).digest('hex'))fail('raw cohort SHA-256 disagrees');
  const record=deriveBands(JSON.parse(bytes.toString('utf8')),origin);
  if(existsSync(output)){
    const previous=object(JSON.parse(readFileSync(output,'utf8')),'existing record');
    if(previous.version!==1)fail('unsupported existing record version '+String(previous.version)+'; left unchanged');
  }
  durableRecord(output,record);return record;
}

runAsCommand(import.meta.url,()=>{
  try{
    const values=new Map<string,string>();let record=false;
    const args=process.argv.slice(2);
    for(let at=0;at<args.length;at++){
      const name=args[at]!;
      if(name==='--record'){if(record)fail('duplicate --record');record=true;continue;}
      if(!['--cohort','--provenance','--out'].includes(name))fail('unknown argument '+name);
      if(values.has(name))fail('duplicate '+name);
      const value=args[++at];if(!value||value.startsWith('--'))fail(name+' needs a path');values.set(name,value);
    }
    if(!record||!values.has('--cohort')||!values.has('--provenance'))fail('usage: count-bands.ts --cohort <json> --provenance <json> --record [--out <json>]');
    const output=values.get('--out')??COUNT_BANDS;
    const result=writeBands(values.get('--cohort')!,values.get('--provenance')!,output);
    console.log(`count bands: ${result.observations.length} runs, ${result.columns.length} columns written to ${output}`);
    return 0;
  }catch(error){console.error(String(error));return 2;}
});
