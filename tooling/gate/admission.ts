// The census feed, which gives a worker its next case only when it asks, and
// none while its job's memory reservation is outranked; and a run temporary's
// disk admission. Memory itself is the memory ledger's (memory-ledger.ts): a
// job reserves it once, and no case reads the host's.
import { existsSync, realpathSync } from "node:fs";
import type {HostObservations} from "./host-observations.ts";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { assertRunTemporary, TEMP_DISK_FLOOR_BYTES, type RunTemporary } from "./run-temporary.ts";
import {releaseToken} from './case-context.ts';
import {DiskCapacity} from './disk-capacity.ts';

/** The source-owned caller chooses the policy; launcher variables never do. */
export type TemporaryAdmissionContext = { kind: "gate"; temporary: RunTemporary } | { kind: "standalone" };
export type TemporaryAdmissionSnapshot = {
  context: TemporaryAdmissionContext["kind"]; freeBytes: number;
  diskFloorBytes: number; reservedBytes: number; buildPromisesBytes:number; requiredFreeBytes: number; admitted: boolean;
};
type TemporaryAdmissionOptions = {
  path: string; context: TemporaryAdmissionContext; reservedBytes: number; host?:HostObservations;capacity?:DiskCapacity;
};

/** One policy for an allocation into a run's registered temporary space:
 * every capture reserves its measured size above the temporary disk floor.
 * Its memory is its job's reservation in the memory ledger, never this.
 * Check before starting the allocation, outside its execution budget. */
export class TemporaryAdmission {
  #options: TemporaryAdmissionOptions;
  constructor(options: TemporaryAdmissionOptions) {
    this.#options = options;
    if (!Number.isSafeInteger(options.reservedBytes) || options.reservedBytes <= 0) throw new Error("invalid temporary space reservation");
    if (options.context?.kind !== "gate" && options.context?.kind !== "standalone") throw new Error("invalid temporary admission context");
    this.#validate();
  }

  #validate(): void {
    const { path, context } = this.#options;
    if (context.kind === "gate") {
      assertRunTemporary(context.temporary, homedir());
      const root = context.temporary.path;
      const under = (candidate: string) => {
        const part = relative(root, candidate);
        return part !== ".." && !part.startsWith("../") && !isAbsolute(part);
      };
      let ancestor = resolve(path);
      if (!under(ancestor)) throw new Error("capture is outside the registered run temporary: " + path);
      while (!existsSync(ancestor)) ancestor = dirname(ancestor);
      if (!under(realpathSync(ancestor))) throw new Error("capture ancestor escapes the registered run temporary: " + path);
    }
  }

  check(): TemporaryAdmissionSnapshot {
    this.#validate();
    const { path, context, reservedBytes } = this.#options;
    const capacity=this.#options.capacity??new DiskCapacity({host:this.#options.host});
    const snapshot=capacity.snapshot(path),freeBytes=snapshot.freeBytes;
    if (!Number.isFinite(freeBytes) || freeBytes < 0) throw new Error("temporary disk availability was not measured");
    const diskFloorBytes = TEMP_DISK_FLOOR_BYTES;
    const buildPromisesBytes=snapshot.reservedBytes;
    const requiredFreeBytes = diskFloorBytes + reservedBytes + buildPromisesBytes;
    return { context: context.kind, freeBytes, diskFloorBytes, reservedBytes, buildPromisesBytes,requiredFreeBytes, admitted: freeBytes >= requiredFreeBytes };
  }
}

/**
 * One case's gate token: resolves to its release, or to `null` when `signal`
 * aborts first (`tokens.mjs`'s `acquireToken`).
 */
export type CaseToken = (path: string, signal: AbortSignal) => Promise<(() => void) | null>;

/**
 * `release` returns the case's token; the worker calls it once, when the case
 * is answered or lost. `signal` aborts the worker's wait for a token when the
 * worker stops.
 */
export type FedWorker = { write: (path: string, release: () => void) => unknown; end: () => void; exited: () => boolean; signal?: AbortSignal };

const untokened: CaseToken = () => Promise.resolve(() => {});
const never = new AbortController().signal;

export type FeedOptions = {
  /** Each case's gate token (`CaseToken`); none outside a gate. */
  token?: CaseToken;
  /**
   * Whether the job's memory reservation is outranked now (memory-ledger.ts),
   * asked before each case: while it is, no new case starts.
   */
  outranked?: () => boolean;
  /** How often a feed held by `outranked` looks again. */
  everyMs?: number;
};

/**
 * The census feed: one queue of paths shared by a job's workers.
 * `feed(worker)` hands that worker its next path, or closes its input when no
 * path is left -- at once, since a finished worker waits for nothing. A
 * worker that exits while its feed waits is never written to, and a path is
 * taken only when it is written.
 *
 * **Its memory is the job's reservation**, held for the whole job, so no case
 * asks the machine for memory of its own. **While that reservation is
 * outranked** -- a request of higher priority waits in the ledger -- no new
 * case starts: the job gives way case by case as its running ones end, and
 * never stops one, so a landing check never waits for the rest of an agent's
 * census.
 *
 * **Inside a gate each case holds one of its tokens**, from the write until
 * the worker returns it, so the step's share of the machine follows its work
 * the way an elastic step's does. No token is held while the feed gives way:
 * a worker reserves its path and asks for the token only when the job is not
 * outranked, and looks again before it writes. A reserved path whose worker
 * stops while it waits, or that the job gives way with, goes back to the
 * queue, so no worker waits for a token while no path is left for it.
 */
export function createFeed(paths: readonly string[], { token = untokened, outranked = () => false, everyMs = 1000 }: FeedOptions = {}) {
  let next = 0;
  let written = 0;
  const returned: number[] = [];
  const remaining = () => returned.length > 0 || next < paths.length;
  return {
    get dispatched() {
      return written;
    },
    async feed(worker: FedWorker): Promise<void> {
      for (;;) {
        if (worker.exited()) return;
        if (!remaining()) return worker.end();
        if (outranked()) {
          await pause(everyMs, undefined, { signal: worker.signal }).catch(() => {});
          continue;
        }
        const reserved = returned.pop() ?? next++;
        const release = await token(paths[reserved]!, worker.signal ?? never);
        if (release === null || worker.exited()) {
          if(release)await releaseToken(release);
          returned.push(reserved);
          if (worker.exited()) return;
          continue;
        }
        // Outranked while the token was awaited: the case gives way, with its token.
        if (outranked()) {
          await releaseToken(release);
          returned.push(reserved);
          continue;
        }
        written++;
        await worker.write(paths[reserved]!, release);
        return;
      }
    },
  };
}
