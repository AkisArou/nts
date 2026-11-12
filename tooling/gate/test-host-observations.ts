// Single constructor for complete fixture observations; it never samples the host.
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {HOST_OBSERVATIONS,HOST_OBSERVATION_ENVIRONMENT,type HostObservationFixture} from './host-observations.ts';

export type OwnMemory = Record<(typeof HOST_OBSERVATION_ENVIRONMENT)[number],string>;

/**
 * A memory reading, an empty ledger and an empty history under `dir`: by
 * default an ample machine, 61 GiB, all of it available, that pages nothing.
 * Called again, it changes the reading at once, as a reader polling it sees
 * it: whole, never half written.
 */
export function ownMemory(dir: string, { availableKiB = 64_000_000, totalKiB = Math.max(availableKiB, 64_000_000), disk, resident, clock, cpu }:
  {availableKiB?:number;totalKiB?:number;disk?:HostObservationFixture['disk'];resident?:HostObservationFixture['resident'];clock?:HostObservationFixture['clock'];cpu?:HostObservationFixture['cpu']} = {}): OwnMemory {
  mkdirSync(dir, { recursive: true });
  const meminfo = join(dir, "meminfo"), vmstat = join(dir, "vmstat");
  writeFileSync(`${meminfo}.next`, `MemTotal:       ${totalKiB} kB\nMemFree:        ${availableKiB} kB\nMemAvailable:   ${availableKiB} kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n`);
  renameSync(`${meminfo}.next`, meminfo);
  writeFileSync(`${vmstat}.next`, "pswpin 0\npswpout 0\n");
  renameSync(`${vmstat}.next`, vmstat);
  const capability=join(dir,'host-observations.json');
  const previous:HostObservationFixture|undefined=existsSync(capability)?JSON.parse(readFileSync(capability,'utf8')):undefined;
  const observations:HostObservationFixture={version:1,memory:{file:meminfo},paging:{file:vmstat},
    disk:disk??previous?.disk??{freeBytes:2**40,freeInodes:2**30},
    resident:resident??previous?.resident??{kind:'fixed',defaultBytes:0},
    cpu:cpu??previous?.cpu??{kind:'fixed',default:{usageUsec:0,userUsec:0,systemUsec:0}},
    width:previous?.width??{logical:32,available:30},load:previous?.load??[0,0,0],clock:clock??previous?.clock??{kind:'live'}};
  writeFileSync(capability+'.next',JSON.stringify(observations)+'\n');renameSync(capability+'.next',capability);
  return { [HOST_OBSERVATIONS]:capability, NTS_MEMINFO: meminfo, NTS_VMSTAT: vmstat, NTS_MEMORY_LEDGER: join(dir, "ledger"), NTS_GATE_COSTS_DIR: join(dir, "costs") };
}

