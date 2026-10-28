import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {random} from './layouts-interval.ts';

/** Only the measured executable receives the helper, not perf/time/taskset. */
export function heapCommand(command: readonly string[], library: string, seed: number, report: string): string[] {
  random(seed);
  if (!command.length || command.some(s=>typeof s!=='string') || !isAbsolute(library) || !isAbsolute(report)) throw Error('absolute helper/report and explicit argv required');
  return ['/usr/bin/env','LD_PRELOAD='+library,'NTS_LAYOUT_HEAP_SEED='+seed,'NTS_LAYOUT_HEAP_REPORT='+report,...command];
}

export function heapReport(path: string, seed: number) {
  const lines=readFileSync(path,'utf8').trim().split('\n');
  if(!lines.length||lines.length>4096)throw Error('missing/excessive heap placement reports');
  const rows=lines.map(line=>JSON.parse(line));
  const keys=new Set<string>();
  for(const r of rows){
    if(r.schema!==1||r.seed!==seed||![r.pid,r.tid,r.thread,r.blocks,r.requested,r.anchor].every(Number.isSafeInteger)
      ||r.pid<=0||r.tid<=0||r.thread<0||r.thread>=128||r.blocks<9||r.blocks>32||r.requested<64||r.requested>2*1024**2||r.anchor<=0)
      throw Error('invalid heap placement report');
    const key=r.pid+':'+r.thread;
    if(keys.has(key))throw Error('duplicate heap thread report');keys.add(key);
  }
  if(!rows.some(r=>r.thread===0))throw Error('main placement report missing');
  return rows;
}
