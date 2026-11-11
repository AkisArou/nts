// Test infrastructure: each run owns its complete resource observations,
// memory ledger and scheduling history. Dependencies and samplers receive
// the same NTS_HOST_OBSERVATIONS capability through gateEnvironment.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join,resolve } from "node:path";
import {fileURLToPath} from "node:url";
import {HOST_OBSERVATIONS,HOST_OBSERVATION_ENVIRONMENT,type HostObservationFixture} from "./host-observations.ts";
import {assignTestValues,testEnvironment} from './test-environment.ts';

export type OwnMemory = Record<(typeof HOST_OBSERVATION_ENVIRONMENT)[number],string>;

/**
 * A memory reading, an empty ledger and an empty history under `dir`: by
 * default an ample machine, 61 GiB, all of it available, that pages nothing.
 * Called again, it changes the reading at once, as a reader polling it sees
 * it: whole, never half written.
 */
export function ownMemory(dir: string, { availableKiB = 64_000_000, totalKiB = Math.max(availableKiB, 64_000_000), disk, resident, clock }:
  {availableKiB?:number;totalKiB?:number;disk?:HostObservationFixture['disk'];resident?:HostObservationFixture['resident'];clock?:HostObservationFixture['clock']} = {}): OwnMemory {
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
    width:previous?.width??{logical:32,available:30},load:previous?.load??[0,0,0],clock:clock??previous?.clock??{kind:'live'}};
  writeFileSync(capability+'.next',JSON.stringify(observations)+'\n');renameSync(capability+'.next',capability);
  return { [HOST_OBSERVATIONS]:capability, NTS_MEMINFO: meminfo, NTS_VMSTAT: vmstat, NTS_MEMORY_LEDGER: join(dir, "ledger"), NTS_GATE_COSTS_DIR: join(dir, "costs") };
}

type Reading = Parameters<typeof ownMemory>[1];
// What a test's own environment may carry from a gate step it runs in -- the
// step's reservation, and the run's priority -- which must not reach a tool
// the test has given memory of its own.
const HANDED = ["NTS_MEMORY_RESERVATION", "NTS_MEMORY_PRIORITY"];

/** A copy of `env` without what a gate step hands the test it runs. */
export function withoutHanded(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const own: NodeJS.ProcessEnv = { ...env };
  assignTestValues(own,Object.fromEntries(HANDED.map(name=>[name,undefined])));
  return own;
}

/** `env` for a tool a test starts, with its own reading and ledger under `dir` in place of any reservation the test runs inside. */
export function ownMemoryEnv(dir: string, env: NodeJS.ProcessEnv = testEnvironment(), reading?: Reading): NodeJS.ProcessEnv {
  const child={...env};assignTestValues(child,ownMemory(dir, reading));
  return withoutHanded(child);
}

/** The same for this test process, which runs a job (the census pool) itself: its own reading and ledger under `dir`. */
export function useOwnMemory(dir: string, reading?: Reading): OwnMemory {
  for (const name of HANDED) delete process.env[name];
  const memory = ownMemory(dir, reading);
  Object.assign(process.env, memory);
  return memory;
}


// Rust fixtures use this same owner, rather than constructing a second schema.
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [directory,...extra]=process.argv.slice(2);
  if(!directory||extra.length)throw new Error('usage: test-memory.ts <owned directory>');
  const environment=ownMemory(resolve(directory));
  process.stdout.write(JSON.stringify({version:1,fields:HOST_OBSERVATION_ENVIRONMENT,environment})+'\n');
}
