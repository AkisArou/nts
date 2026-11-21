// The machine's four ranks of work, highest first: the landing check, the
// full check's culprit probes and core runs advancing stale verified, an
// agent's own work, the full check's other runs. One table says what each rank
// gets from the kernel: the memory ledger admits by this order (memory-ledger.ts), the
// OOM killer takes the lowest rank's work first, and the CPU scheduler shares
// contended time by the rank's weight.
//
// A rank travels in NTS_MEMORY_PRIORITY. The cgroup an nts job runs in is
// placed under `nts.slice` with its rank's CPUWeight (tooling-slice.ts's
// `toolingSliceArgs`, scopes/bound-slice.ts's `startBoundSlice` and
// `rankedScopeArgs`); a unit that only controls such work carries the same
// weight (the landing service, an agent's unit, the full check's units).
// Weight shares a contended CPU; it never limits a run on an idle machine.
//
// A culprit search exists to restore `verified`, which every record,
// benchmark and later bisection waits on, so its probes outrank agents' work
// and stay below a landing. The full check's controller gives that rank to
// each probe run and to core runs that can advance verified when the oldest
// outstanding first-parent change has been unverified on main for over two
// hours since its landing: the rank ends with
// the run (full-check/service.ts). Within that bound, core runs keep the full
// check's rank, as do wide runs, records and benchmarks.

/** The rank a launcher's code gives the job it starts (`priorityOf`). */
export const PRIORITY_ENV = "NTS_MEMORY_PRIORITY";
/** Highest first. */
export const PRIORITIES = ["landing", "culprit-search", "agent", "full-check"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** The rank `env` names (PRIORITY_ENV), else an agent's. */
export function priorityOf(env: NodeJS.ProcessEnv = process.env): Priority {
  const named = env[PRIORITY_ENV];
  if (named === undefined || named === "") return "agent";
  if (!(PRIORITIES as readonly string[]).includes(named)) throw new RangeError(`${PRIORITY_ENV}=${named} is not a priority; one of ${PRIORITIES.join(", ")}`);
  return named as Priority;
}

/**
 * The kernel's OOM score adjustment of each rank's work, lowest first to
 * keep: if the machine itself runs out of memory, its OOM killer takes the
 * full check's ordinary work first, then agents', then a culprit search's
 * or stale-verified core's, and a landing's last. A user unit cannot go below
 * the user manager's own 100 (it asks 0 and is given 100), so the landing check's unit asks 100; an
 * agent's shell, started outside the manager, sits at 0, so agents' work
 * raises itself (memory-ledger.ts's `rankForOom`). A culprit-search run
 * starts inside the full check's unit at 500 and is placed at its own 200 by
 * the controller's measurement (`placeForOom`), which may lower a score as far
 * as the manager's 100.
 */
export const OOM_SCORE: Readonly<Record<Priority, number>> = { landing: 100, "culprit-search": 200, agent: 300, "full-check": 500 };

/**
 * The cgroup v2 `cpu.weight` of each rank's work. Siblings under `nts.slice`
 * share a saturated machine in proportion: a landing beside two agents' runs
 * gets 1000/1200 of it, an agent beside the full check 100/110. An agent's is
 * the kernel's default, so a cgroup that carries no rank (one made by older
 * code) ties with agents, never with a landing.
 */
export const CPU_WEIGHT: Readonly<Record<Priority, number>> = { landing: 1000, "culprit-search": 300, agent: 100, "full-check": 10 };

/** The parent under which every rank's work competes. */
export const RANK_SLICE = "nts.slice";
