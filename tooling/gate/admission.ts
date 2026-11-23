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
import {releaseToken,type TokenRelease} from './case-context.ts';
import {DiskCapacity,describeDiskWait,diskHolders,type CapacitySnapshot,type DiskWaitRecord,type TemporaryDiskLease} from './disk-capacity.ts';

/** The source-owned caller chooses the policy; launcher variables never do. */
export type TemporaryAdmissionContext = { kind: "gate"; temporary: RunTemporary } | { kind: "standalone" };
export type TemporaryAdmissionSnapshot = {
  context: TemporaryAdmissionContext["kind"]; freeBytes: number;
  diskFloorBytes: number; reservedBytes: number; buildPromisesBytes:number; temporaryPromisesBytes:number; requiredFreeBytes: number; admitted: boolean;
};
/** How an admission waits: the request in words, its abort, and where its two
 * reports go (first refusal and admission; by default stderr). */
export type TemporaryWait = { what: string; signal?: AbortSignal; report?: (line: string, snapshot: TemporaryAdmissionSnapshot) => void; everyMs?: number };
type TemporaryAdmissionOptions = {
  path: string; context: TemporaryAdmissionContext; reservedBytes: number; host?:HostObservations;capacity?:DiskCapacity;env?:NodeJS.ProcessEnv;
};

/** One policy for an allocation into a run's registered temporary space:
 * every capture reserves its measured size above the temporary disk floor.
 * Its memory is its job's reservation in the memory ledger, never this.
 * Acquire before allocation, outside its execution budget; retain the returned
 * lease through publication and drain, and release it in finally. */
export class TemporaryAdmission {
  #options: TemporaryAdmissionOptions;
  #capacity:DiskCapacity;
  constructor(options: TemporaryAdmissionOptions) {
    this.#options = options;
    if (!Number.isSafeInteger(options.reservedBytes) || options.reservedBytes <= 0) throw new Error("invalid temporary space reservation");
    if (options.context?.kind !== "gate" && options.context?.kind !== "standalone") throw new Error("invalid temporary admission context");
    this.#validate();
    this.#capacity=options.capacity??new DiskCapacity({host:options.host,env:options.env});
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

  /**
   * **The one owner of a temporary's disk wait.** Tries until the bytes are
   * admitted, or `signal` aborts. A refused request is recorded in the
   * capacity's waits (DiskCapacity.beginWait) for as long as it waits, with the
   * holders of the disk it needs, so an observer outside the process (the full
   * check's run bound) names the wait; the record ends in every exit path. It
   * reports once when first refused and once when admitted. Free disk admits
   * at once, with no record and no report. A disk wait is never excused as
   * progress: what holds the disk may never end on its own.
   */
  async acquire({ what, signal, report = line => process.stderr.write(line + "\n"), everyMs = 1000 }: TemporaryWait): Promise<{ snapshot: TemporaryAdmissionSnapshot; lease: TemporaryDiskLease }> {
    signal?.throwIfAborted();
    const host = this.#capacity.host, began = host.now();
    let waiting: DiskWaitRecord | undefined, described = "";
    try {
      for (;;) {
        const { snapshot, lease, capacity } = this.#attempt();
        if (lease) {
          if (waiting) report(`disk: ${what} admitted after ${Math.round((host.now() - began) / 1000)} s`, snapshot);
          return { snapshot, lease };
        }
        const line = describeDiskWait({ what, bytes: this.#options.reservedBytes, freeBytes: capacity.freeBytes, floorBytes: capacity.floorBytes, holders: diskHolders(capacity) });
        if (!waiting) {
          waiting = this.#capacity.beginWait(what, this.#options.path, this.#options.reservedBytes, capacity, new Date(host.wallNow()).toISOString());
          report(`disk: ${line}`, snapshot);
        } else if (line !== described) waiting.update(capacity);
        described = line;
        await pause(everyMs, undefined, { signal });
      }
    } finally { waiting?.end(); }
  }

  #attempt():{snapshot:TemporaryAdmissionSnapshot;lease:TemporaryDiskLease|null;capacity:CapacitySnapshot} {
    this.#validate();
    const { path, context, reservedBytes } = this.#options;
    const {snapshot,lease}=this.#capacity.tryTemporary(path,reservedBytes),freeBytes=snapshot.freeBytes;
    const diskFloorBytes = TEMP_DISK_FLOOR_BYTES;
    const buildPromisesBytes=snapshot.buildReservedBytes,temporaryPromisesBytes=snapshot.temporaryReservedBytes;
    const requiredFreeBytes = diskFloorBytes + reservedBytes + buildPromisesBytes+temporaryPromisesBytes;
    return {lease,capacity:snapshot,snapshot:{context:context.kind,freeBytes,diskFloorBytes,reservedBytes,buildPromisesBytes,temporaryPromisesBytes,requiredFreeBytes,admitted:lease!==null}};
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
export type FedWorker = { write: (path: string, release: () => void) => unknown; end: () => void; exited: () => boolean; signal?: AbortSignal;
  /** Close and join only this idle worker's resources, never an active case. */
  yield?:()=>Promise<void> };

export type FeedEndpoint = Omit<FedWorker,'write'>;
/** The feed retains the path until its caller actually dispatches it. */
export type FeedOffer = {
  path:string; release:TokenRelease; readonly committed:boolean;
  commit():void;
  /** Return the unused path only after its old token has fully drained. */
  return():Promise<void>;
};

const untokened: CaseToken = () => Promise.resolve(() => {});

export type FeedOptions = {
  /** Each case's gate token (`CaseToken`); none outside a gate. */
  token?: CaseToken;
  /**
   * Whether the job's memory reservation is outranked now (memory-ledger.ts),
   * asked before each case: while it is, no new case starts.
   */
  outranked?: () => boolean;
  /** One shared owned pause/resume boundary after idle workers have drained. */
  pause?:()=>Promise<void>;
  resume?:()=>Promise<void>;
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
 * queue, so no worker waits for a token while no path is left for it. Its
 * wait is withdrawn, and the token pool decides which came first: a grant
 * that won comes back here like any other, and is returned as an offer
 * (`returnedOffers`) with its path, so every grant is a dispatch or a
 * returned offer.
 */
export function createFeed(paths: readonly string[], { token = untokened, outranked = () => false, everyMs = 1000, pause:pauseOwner,resume:resumeOwner }: FeedOptions = {}) {
  let next = 0;
  let written = 0;
  let returnedOffers=0;
  const returned: number[] = [];
  const remaining = () => returned.length > 0 || next < paths.length;
  // The feed's one priority yield in flight. A worker keeps the flight it
  // entered: the flight pauses once, after its first idle close, and never
  // once its resume has started; it resumes once, and every worker that
  // entered it joins that resume. Only then is it cleared.
  type Flight={pause?:Promise<void>;resume?:Promise<void>};
  let yielding:Flight|undefined;
  const idle=async(worker:FeedEndpoint):Promise<Flight>=>{
    if(!pauseOwner||!resumeOwner)throw Error('case feed priority yield requires its owned pause and resume');
    const flight=yielding??={};
    if(!flight.resume)await worker.yield?.();
    if(!flight.resume)await(flight.pause??=pauseOwner());
    return flight;
  };
  const resumed=async(flight:Flight)=>{
    await(flight.resume??=resumeOwner!());
    if(yielding===flight)yielding=undefined;
  };
  const waitingToken=async(path:string,worker:FeedEndpoint)=>{
    const withdraw=new AbortController(),watch=new AbortController();let failure:unknown;
    const signal=worker.signal?AbortSignal.any([worker.signal,withdraw.signal]):withdraw.signal;
    const observer=(async()=>{
      try{for(;;){await pause(everyMs,undefined,{signal:watch.signal});if(outranked()||yielding){withdraw.abort();return;}}}
      catch(error){if(!watch.signal.aborted){failure=error;withdraw.abort(error);}}
    })();
    try{
      let release;
      try{release=await token(path,signal);}catch(error){if(!signal.aborted||(error as Error)?.name!=='AbortError')throw error;release=null;}
      if(failure){if(release)await releaseToken(release);throw failure;}
      return release;
    }finally{watch.abort();await observer;}
  };
  const reserve=async(worker:FeedEndpoint):Promise<FeedOffer|undefined>=>{
      for (;;) {
        if (worker.exited()||worker.signal?.aborted) return;
        if (!remaining()) {worker.end();return;}
        if (outranked()||yielding) {
          const flight=await idle(worker);
          if(worker.exited()||worker.signal?.aborted)return;
          if(flight.resume||!outranked())await resumed(flight);
          else await pause(everyMs, undefined, { signal: worker.signal }).catch(() => {});
          continue;
        }
        const reserved = returned.pop() ?? next++;
        let grant;
        try{grant=await waitingToken(paths[reserved]!,worker);}
        catch(error){returned.push(reserved);throw error;}
        if(grant===null){returned.push(reserved);continue;}
        let released=false,committed=false,returning:Promise<void>|undefined;
        const release:TokenRelease=()=>{if(!released){released=true;grant();}};
        release.case=(grant as TokenRelease).case;release.closed=(grant as TokenRelease).closed;
        const offer:FeedOffer={path:paths[reserved]!,release,get committed(){return committed;},
          commit(){if(committed||returning)throw Error('case feed offer is no longer reserved');committed=true;written++;},
          return(){
            if(committed)throw Error('case feed cannot return an already dispatched offer');
            return returning??=Promise.resolve().then(async()=>{await releaseToken(release);returned.push(reserved);returnedOffers++;});
          },
        };
        if(worker.exited()||worker.signal?.aborted||outranked()||yielding){
          await offer.return();
          if(worker.exited()||worker.signal?.aborted)return;
          continue;
        }
        return offer;
      }
  };
  return {
    get dispatched() {return written;},
    get returnedOffers(){return returnedOffers;},
    reserve,
    async feed(worker: FedWorker): Promise<void> {
      const offer=await reserve(worker);if(!offer)return;
      try{await worker.write(offer.path,offer.release);offer.commit();}
      catch(error){
        try{await offer.return();}catch(cleanup){throw new AggregateError([error,cleanup],'case feed dispatch and token return failed',{cause:error});}
        throw error;
      }
    },
  };
}
