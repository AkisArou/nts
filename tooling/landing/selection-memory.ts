// The memory a landing selection holds (docs/workflow.md, "The machine").
//
// Selecting a commit's owed steps evaluates the rules at both endpoints of
// its range, each in a worker of its own (gate/owed-range.ts), and holds a
// few GiB while it does. It is heavy work, so it reserves through the
// machine's one ledger like any other job: under one stable key, sized only
// from that key's measured history in the tree it selects for, at the rank
// its caller's code names. The landing service's selection is a landing's;
// an agent's `check.ts --dry-run` and `--here` are an agent's, so a landing's
// selection outranks them and they yield to it.
//
// The service and `--here` hand the selection's reservation on to their run
// (run.ts's `handover`): the landing build takes it over, or the gate run
// when nothing is built, so nothing is admitted between the selection and
// the work it chose.
import { reserveJob, type JobRequest, type Reservation } from "../gate/memory-ledger.ts";
import { PRIORITY_ENV, type Priority } from "../gate/ranks.ts";

/** Who selects: the landing service, an agent's `--here`, or an agent's `--dry-run`. */
export type SelectionCaller = "service" | "here" | "dry-run";

/** The selection's name in the scheduling history, the same for every caller. */
export const SELECTION_KEY = "landing-selection";

/** Each caller's rank, from its own code, never from the shell it was started in. */
export const SELECTION_RANK = { service: "landing", here: "agent", "dry-run": "agent" } as const satisfies Record<SelectionCaller, Priority>;

/**
 * The job a selection reserves as: its key (a whole job: the selection is one
 * process and its endpoint workers), what it says in the ledger, and the
 * environment it reserves in -- `env` with the caller's rank and the target
 * whose history sizes it (the tree it selects for: the landing tree's for the
 * service, the agent's own for `--here` and `--dry-run`).
 */
export function selectionJob(caller: SelectionCaller, commit: string, target: string, env: NodeJS.ProcessEnv = process.env): { request: JobRequest; env: NodeJS.ProcessEnv } {
  const what = `landing selection of ${commit.slice(0, 12)}${caller === "service" ? "" : ` (${caller === "here" ? "--here" : "--dry-run"})`}`;
  return { request: { key: SELECTION_KEY, what }, env: { ...env, CARGO_TARGET_DIR: target, [PRIORITY_ENV]: SELECTION_RANK[caller] } };
}

/**
 * Reserve a selection's memory, waiting its turn at its caller's rank; a wait
 * is said through `report` as it starts. Release it (once, idempotently) when
 * the selection's work is done or handed on; its peak then goes to the key's
 * history. Inside a reservation already (an `admit.ts` job), it is that one.
 */
export function holdSelection(caller: SelectionCaller, commit: string, target: string,
  options: { env?: NodeJS.ProcessEnv; signal?: AbortSignal; report?: (line: string) => void } = {}): Promise<Reservation> {
  const job = selectionJob(caller, commit, target, options.env);
  return reserveJob(job.request, { env: job.env, ...(options.signal ? { signal: options.signal } : {}), ...(options.report ? { report: options.report } : {}) });
}

/** End a selection's reservation if its run did not already take it over, and wait for its peak to be written. */
export async function closeSelection(hold: Reservation | undefined): Promise<void> {
  if (hold === undefined) return;
  hold.release();
  await hold.closed;
}
