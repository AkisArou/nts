// Memory admission for work that starts one case at a time: the gate's token
// pool (elastic steps take a token per case) and the conformance runner's
// feeder (a worker gets its next path only when it asks).
//
// **Below 12 GB nothing new starts; at 14 GB it starts again; what is running
// is never stopped.** A case already running finishes on its own timeout. A
// SIGSTOP of timed work fabricates timeouts (docs/agents/lessons/measurement.md),
// and a phase admitted below the line is what turned a neighbour's gate red
// at its memory pre-check. The two thresholds differ so that admission does
// not flap around one number: a run that dropped to 11.9 waits for 14, and
// one admitted at 14 keeps going down to 12.
//
// Admission starts held, so the first case needs 14 GB as well -- the same
// threshold AGENTS.md sets for starting a heavy phase.
import { readFileSync } from "node:fs";

export const HOLD_BELOW_GB = 12;
export const RESUME_AT_GB = 14;

// `NTS_MEMINFO` names another file in /proc/meminfo's format, for the tests
// that drive a runner through a hold. Absent, it is the kernel's.
const MEMINFO = process.env.NTS_MEMINFO ?? "/proc/meminfo";

/** MemAvailable in GiB, or `null` when the file cannot be read or names none. */
export function memAvailableGB(path: string = MEMINFO): number | null {
  try {
    const kb = /^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync(path, "utf8"))?.[1];
    return kb === undefined ? null : Number(kb) / 2 ** 20;
  } catch {
    return null;
  }
}

export type AdmissionOptions = {
  read?: () => number | null;
  holdBelow?: number;
  resumeAt?: number;
  /** Told once each time admission closes and once when it opens again. */
  report?: (message: string) => void;
};

export class Admission {
  #held = true;
  #checked = false;
  #read: () => number | null;
  #holdBelow: number;
  #resumeAt: number;
  #report: (message: string) => void;

  constructor({ read = () => memAvailableGB(), holdBelow = HOLD_BELOW_GB, resumeAt = RESUME_AT_GB, report = () => {} }: AdmissionOptions = {}) {
    this.#read = read;
    this.#holdBelow = holdBelow;
    this.#resumeAt = resumeAt;
    this.#report = report;
  }

  /**
   * Whether a new case may start now; each call reads memory once.
   *
   * **A machine that does not say how much memory it has admits**: there is
   * nothing to wait for, and a run that waited for an answer that never comes
   * would hang rather than fail. That is a machine without /proc/meminfo, not
   * a low one, so it is not a way past the threshold here.
   */
  open(): boolean {
    const gb = this.#read();
    if (gb === null) return true;
    const first = !this.#checked;
    this.#checked = true;
    if (first && gb < this.#resumeAt) {
      // A run that waits before its first case says so, or it looks hung.
      this.#report(`memory: ${gb.toFixed(1)} GB available, waiting for ${this.#resumeAt} GB before the first case`);
    } else if (this.#held && gb >= this.#resumeAt) {
      this.#held = false;
      this.#report(`memory: ${gb.toFixed(1)} GB available, admitting new cases again (resume at ${this.#resumeAt})`);
    } else if (!this.#held && gb < this.#holdBelow) {
      this.#held = true;
      this.#report(`memory: ${gb.toFixed(1)} GB available, holding new cases until ${this.#resumeAt} GB (running ones continue)`);
    }
    return !this.#held;
  }

  /** Resolves once a new case may start, checking every `everyMs`; `cancelled` stops the wait. */
  async ready(everyMs = 2000, cancelled: () => boolean = () => false): Promise<boolean> {
    while (!cancelled()) {
      if (this.open()) return true;
      await new Promise((resolve) => setTimeout(resolve, everyMs).unref());
    }
    return false;
  }
}

export type FedWorker = { write: (path: string) => void; end: () => void; exited: () => boolean };

/**
 * The conformance runner's feed: one queue of paths shared by its workers,
 * held by `admission`. `feed(worker)` hands that worker its next path when
 * memory allows, or closes its input when no path is left -- at once, since a
 * finished worker waits for nothing. A worker that exits while its feed waits
 * is never written to, and a path is taken only when it is written.
 */
export function createFeed(paths: readonly string[], admission: Admission, everyMs = 2000) {
  let next = 0;
  const remaining = () => next < paths.length;
  return {
    get dispatched() {
      return next;
    },
    async feed(worker: FedWorker): Promise<void> {
      if (worker.exited()) return;
      if (!remaining()) return worker.end();
      const admitted = await admission.ready(everyMs, () => worker.exited() || !remaining());
      if (worker.exited()) return;
      // Another worker may have taken the last path while this one waited.
      if (!admitted || !remaining()) return worker.end();
      worker.write(paths[next++]);
    },
  };
}
