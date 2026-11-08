// The landing queue the full check submits its reverts and records commits to:
// the landing check's own (tooling/landing/queue.ts). A revert goes in first,
// ahead of every change waiting; a records or benchmark commit takes its turn.
// Submitting starts the landing service when none is draining the queue. A
// revert the full check no longer stands behind is withdrawn.
import { LANDING_HOME, Queue, submit } from "../landing/queue.ts";

export type SubmitOptions = { first?: boolean };
/** What withdrawing did: answered at once while waiting or held, asked of the check running it, or nothing queued. */
export type Withdrawal = "withdrawn" | "requested" | "unknown";
export type LandingQueue = { submit(commit: string, options: SubmitOptions): unknown; withdraw(commit: string): Withdrawal };

/**
 * The landing check's queue, as the full check submits to it: every entry is
 * the full check's. `root` (the shared checkout) and `home` (the landing
 * check's state) are this machine's unless a test names its own.
 */
export function landingQueue(where: { root?: string; home?: string } = {}): LandingQueue {
  return {
    submit: (commit, options) => submit(commit, { first: options.first === true, by: "full-check", ...where }),
    withdraw: commit => new Queue(where.home ?? LANDING_HOME).withdraw(commit),
  };
}

/** Submit, and say what happened in one line; a failure is reported, not thrown. */
export async function submitTo(queue: LandingQueue, commit: string, options: SubmitOptions): Promise<{ submitted: boolean; line: string }> {
  try {
    await queue.submit(commit, options);
    return { submitted: true, line: `submitted ${commit}${options.first ? " first" : ""} to the landing queue` };
  } catch (error) {
    return { submitted: false, line: `the landing queue refused ${commit}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
