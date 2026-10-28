// Whole fresh-command cost uses the one audited exec-inherited counter. A
// caller's decoder checks its own population/work contract and rejects errors.
import {closeSync,openSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnCounted,counterProblem} from '../gate/cputime.mjs';
import {admitted,conditions} from './layouts-native.ts';
import {heapCommand,heapReport} from './layouts-heap.ts';
import type {Adapter,Arm,Cell} from './layouts-sitting.ts';

export type CostDecode = (stdout:string,stderr:string,cell:Cell) => {signature:string;details?:unknown};
export function costAdapter(commands:Map<string,Record<Arm,readonly string[]>>,library:string,directory:string,decode:CostDecode):Adapter {
  return {admit:()=>admitted(directory),run:async cell=>{
    const target=commands.get(cell.trial.id)?.[cell.arm];if(!target)throw Error('missing cost command');
    const report=join(cell.folder,'heap.jsonl');
    const argv=heapCommand(target,library,cell.trial.heapSeed[cell.arm],report);
    const stdout=join(cell.folder,'stdout'),stderr=join(cell.folder,'stderr');
    const fd=openSync(stdout,'wx'),err=openSync(stderr,'wx'),start=conditions(directory);
    writeFileSync(join(cell.folder,'command.json'),JSON.stringify({argv,start},null,2));
    const {measurement}=spawnCounted(argv[0],argv.slice(1),{cpu:4,events:['cycles','branches','branch-misses'],
      counterFile:join(cell.folder,'perf.txt'),timeoutMs:120_000,stdio:['ignore',fd,err]});
    closeSync(fd);closeSync(err);const row=await measurement;
    writeFileSync(join(cell.folder,'exit.json'),JSON.stringify({...row,end:conditions(directory)},null,2));
    if(row.status!==0||row.signal||row.counter_error||counterProblem(row))throw Error('invalid launch counter; raw failure retained');
    const decoded=decode(readFileSync(stdout,'utf8'),readFileSync(stderr,'utf8'),cell);
    const heap=heapReport(report,cell.trial.heapSeed[cell.arm]);
    return {signature:decoded.signature,metrics:{cpu:row.cpu_s,instructions:row.metrics.instructions.value,cycles:row.metrics.cycles.value},
      details:{...row,start,end:conditions(directory),heap,decoded:decoded.details,
        prefixIncluded:true,scope:'whole-fresh-command-with-startup-placement; '+row.counter_scope}};
  }};
}
