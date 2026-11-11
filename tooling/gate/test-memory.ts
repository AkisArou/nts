// Test infrastructure: each run owns its complete resource observations,
// memory ledger and scheduling history. Dependencies and samplers receive
// the same NTS_HOST_OBSERVATIONS capability through gateEnvironment.
import { resolve } from "node:path";
import {fileURLToPath} from "node:url";
import {HOST_OBSERVATION_ENVIRONMENT} from "./host-observations.ts";
import {assignTestValues,testEnvironment} from './test-environment.ts';

import {ownMemory,type OwnMemory} from './test-host-observations.ts';
export {ownMemory,type OwnMemory} from './test-host-observations.ts';

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
