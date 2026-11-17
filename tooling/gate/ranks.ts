// The machine's three ranks of work, highest first: the landing check, an
// agent's own work, the full check. One table says what each rank gets from
// the kernel: the memory ledger admits by this order (memory-ledger.ts), the
// OOM killer takes the lowest rank's work first, and the CPU scheduler shares
// contended time by the rank's weight.
//
// A rank travels in NTS_MEMORY_PRIORITY. The cgroup an nts job runs in is
// placed under `nts.slice` with its rank's CPUWeight (tooling-slice.ts's
// `toolingSliceArgs`, scopes/bound-slice.ts's `startBoundSlice` and
// `rankedScopeArgs`); a unit that only controls such work carries the same
// weight (the landing service, an agent's unit, the full check's units).
// Weight shares a contended CPU; it never limits a run on an idle machine.

/** The rank a launcher's code gives the job it starts (`priorityOf`). */
export const PRIORITY_ENV = "NTS_MEMORY_PRIORITY";
/** Highest first. */
export const PRIORITIES = ["landing", "agent", "full-check"] as const;
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
 * full check's work first, then agents', and a landing's last. A user unit
 * cannot go below the user manager's own 100 (it asks 0 and is given 100), so
 * the landing check's unit asks 100; an agent's shell, started outside the
 * manager, sits at 0, so agents' work raises itself (memory-ledger.ts's
 * `rankForOom`).
 */
export const OOM_SCORE: Readonly<Record<Priority, number>> = { landing: 100, agent: 300, "full-check": 500 };

/**
 * The cgroup v2 `cpu.weight` of each rank's work. Siblings under `nts.slice`
 * share a saturated machine in proportion: a landing beside two agents' runs
 * gets 1000/1200 of it, an agent beside the full check 100/110. An agent's is
 * the kernel's default, so a cgroup that carries no rank (one made by older
 * code) ties with agents, never with a landing.
 */
export const CPU_WEIGHT: Readonly<Record<Priority, number>> = { landing: 1000, agent: 100, "full-check": 10 };

/** The parent under which every rank's work competes. */
export const RANK_SLICE = "nts.slice";
