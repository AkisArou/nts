// Test infrastructure only: the memory an inner gate run, or any tool a test
// starts that reserves memory, decides by. A run reserves its memory in the
// machine's ledger (memory-ledger.ts), so a test's run that used the real one
// would queue behind the machine's own jobs, and be decided by the host's
// free memory. Each gets a reading of its own (NTS_MEMINFO) and a ledger of
// its own (NTS_MEMORY_LEDGER), as gateEnvironment's owned values or in the
// tool's environment, so neither the host nor a neighbour ever decides it.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type OwnMemory = { NTS_MEMINFO: string; NTS_MEMORY_LEDGER: string };

/**
 * A memory reading and an empty ledger under `dir`: by default an ample
 * machine, 61 GiB, all of it available. Called again, it changes the reading
 * at once, as a reader polling it sees it: whole, never half written.
 */
export function ownMemory(dir: string, { availableKiB = 64_000_000, totalKiB = Math.max(availableKiB, 64_000_000) } = {}): OwnMemory {
  mkdirSync(dir, { recursive: true });
  const meminfo = join(dir, "meminfo");
  writeFileSync(`${meminfo}.next`, `MemTotal:       ${totalKiB} kB\nMemFree:        ${availableKiB} kB\nMemAvailable:   ${availableKiB} kB\n`);
  renameSync(`${meminfo}.next`, meminfo);
  return { NTS_MEMINFO: meminfo, NTS_MEMORY_LEDGER: join(dir, "ledger") };
}

type Reading = Parameters<typeof ownMemory>[1];
// What a test's own environment may carry from a gate step it runs in -- the
// step's reservation, and the run's priority -- which must not reach a tool
// the test has given memory of its own.
const HANDED = ["NTS_MEMORY_RESERVATION", "NTS_MEMORY_PRIORITY"];

/** A copy of `env` without what a gate step hands the test it runs. */
export function withoutHanded(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const own: NodeJS.ProcessEnv = { ...env };
  for (const name of HANDED) delete own[name];
  return own;
}

/** `env` for a tool a test starts, with its own reading and ledger under `dir` in place of any reservation the test runs inside. */
export function ownMemoryEnv(dir: string, env: NodeJS.ProcessEnv = process.env, reading?: Reading): NodeJS.ProcessEnv {
  return withoutHanded({ ...env, ...ownMemory(dir, reading) });
}

/** The same for this test process, which runs a job (the census pool) itself: its own reading and ledger under `dir`. */
export function useOwnMemory(dir: string, reading?: Reading): OwnMemory {
  for (const name of HANDED) delete process.env[name];
  const memory = ownMemory(dir, reading);
  Object.assign(process.env, memory);
  return memory;
}
