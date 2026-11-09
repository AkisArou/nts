// Test infrastructure only: the memory an inner gate run, or any tool a test
// starts that reserves memory, decides by. A run reserves its memory in the
// machine's ledger (memory-ledger.ts), so a test's run that used the real one
// would queue behind the machine's own jobs, and be decided by the host's
// free memory. Each gets a reading of its own (NTS_MEMINFO) and a ledger of
// its own (NTS_MEMORY_LEDGER), as gateEnvironment's owned values or in the
// tool's environment, so neither the host nor a neighbour ever decides it.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type OwnMemory = { NTS_MEMINFO: string; NTS_MEMORY_LEDGER: string };

/** A memory reading and an empty ledger under `dir`: by default an ample machine, 61 GiB, all of it available. */
export function ownMemory(dir: string, { availableKiB = 64_000_000, totalKiB = Math.max(availableKiB, 64_000_000) } = {}): OwnMemory {
  mkdirSync(dir, { recursive: true });
  const meminfo = join(dir, "meminfo");
  writeFileSync(meminfo, `MemTotal:       ${totalKiB} kB\nMemFree:        ${availableKiB} kB\nMemAvailable:   ${availableKiB} kB\n`);
  return { NTS_MEMINFO: meminfo, NTS_MEMORY_LEDGER: join(dir, "ledger") };
}
