// The landing queue the full check submits its reverts and records commits to:
// the landing check's own (tooling/landing/queue.ts). A revert goes in first,
// ahead of every change waiting; a records or benchmark commit takes its turn.
// Submitting starts the landing service when none is draining the queue. A
// revert the full check no longer stands behind is withdrawn. The queue's
// answers are read back, so a records commit it refused is seen and retried.
import { LANDING_HOME, Queue, submit, type State } from "../landing/queue.ts";

export type SubmitOptions = { first?: boolean };
/** What withdrawing did: answered at once while waiting or held, asked of the check running it, or nothing queued. */
export type Withdrawal = "withdrawn" | "requested" | "unknown";
/** The landing check's answer to a commit: what came of it, when, its message, and main's tip once it landed. */
export type LandingAnswer = { state: State; at: string; message: string; tip?: string };
export type LandingQueue = {
  submit(commit: string, options: SubmitOptions): unknown;
  withdraw(commit: string): Withdrawal;
  /** "waiting" while the commit waits or is checked, the landing check's latest answer once it has one, null when the queue has no record of it. */
  answer(commit: string): LandingAnswer | "waiting" | null;
  /** A queued or running landing prevents new wide work, while held answers do not. */
  busy(): string | null;
};

/**
 * The landing check's queue, as the full check submits to it: every entry is
 * the full check's. `root` (the shared checkout) and `home` (the landing
 * check's state) are this machine's unless a test names its own.
 */
export function landingQueue(where: { root?: string; home?: string } = {}): LandingQueue {
  return {
    submit: (commit, options) => submit(commit, { first: options.first === true, by: "full-check", ...where }),
    withdraw: commit => new Queue(where.home ?? LANDING_HOME).withdraw(commit),
    answer: commit => answerOf(new Queue(where.home ?? LANDING_HOME), commit),
    busy: () => {
      const queue = new Queue(where.home ?? LANDING_HOME);
      const checking = queue.checking();
      if (checking) return `landing ${checking.id} is running`;
      const first = queue.waiting()[0];
      return first ? `landing ${first.id} is queued` : null;
    },
  };
}

/**
 * Where the queue has `commit`: "waiting" while it waits or is checked, its
 * latest answer once it has one (a held change's included, until it is
 * retried), null when it has no record of it.
 */
export function answerOf(queue: Queue, commit: string): LandingAnswer | "waiting" | null {
  const found = queue.find(commit);
  if (found && found.where !== "held") return "waiting";
  const result = queue.results().filter(one => one.sha === commit).at(-1);
  if (!result) return null;
  return { state: result.state, at: result.at, message: result.message, ...(result.tip ? { tip: result.tip } : {}) };
}

/** When the landing check landed each commit it landed: its answer's time, for every commit of the change. */
export function landedTimes(home = LANDING_HOME): Map<string, string> {
  const times = new Map<string, string>();
  for (const result of new Queue(home).results()) {
    if (result.state === "landed") for (const commit of result.commits ?? (result.tip ? [result.tip] : [])) times.set(commit, result.at);
  }
  return times;
}

/** Submit, and say what happened in one line; a failure is reported, not thrown. */
export async function submitTo(queue: Pick<LandingQueue, "submit">, commit: string, options: SubmitOptions): Promise<{ submitted: boolean; line: string }> {
  try {
    await queue.submit(commit, options);
    return { submitted: true, line: `submitted ${commit}${options.first ? " first" : ""} to the landing queue` };
  } catch (error) {
    return { submitted: false, line: `the landing queue refused ${commit}: ${error instanceof Error ? error.message : String(error)}` };
  }
}
