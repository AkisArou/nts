// `setImmediate`, from node v24.20.0 `lib/internal/timers.js`.
//
// An immediate is not a timeout with a delay of zero. A timeout waits for a
// clock; an immediate waits for the current operation and everything it queued
// to finish, and then runs before the loop goes back to waiting for I/O. The
// two land in different phases and a program can tell them apart, so they are
// different machinery here as they are in node.
//
// The list is null-terminated with a head and a tail, rather than the circular
// intrusive list the timers use. It reads like an inconsistency and is not: a
// timer list is walked from its oldest member repeatedly and has entries
// removed from the middle, which is what the circular form is for, while the
// immediate queue is taken whole, walked once, and discarded. A head and a
// tail is the smaller structure for that, and it makes the snapshot below a
// two-field assignment.

import * as host from "./host.ts";
import { AsyncContextFrame } from "../../internal/async-context.ts";
import {
  emitAfter,
  emitBefore,
  emitDestroy,
  emitInit,
  getDefaultTriggerAsyncId,
  initHooksExist,
  newAsyncId,
} from "../../internal/async-hooks.ts";

export const kRefed = Symbol("refed");

export type ImmediateCallback<Args extends unknown[] = []> = (...args: Args) => void;

/** The non-generic view retained by the heterogeneous immediate queue. */
export interface ImmediateHandle {
  _idleNext: ImmediateHandle | null;
  _idlePrev: ImmediateHandle | null;
  _onImmediate: CallableFunction | null | undefined;
  _argv: unknown[] | undefined;
  _destroyed: boolean;
  [kRefed]: boolean | null;
  _asyncId: number;
  _triggerAsyncId: number;
  _contextFrame: AsyncContextFrame | undefined;
  invoke(): void;
}

export class Immediate<Args extends unknown[] = []> implements ImmediateHandle {
  _idleNext: ImmediateHandle | null;
  _idlePrev: ImmediateHandle | null;
  _onImmediate: ImmediateCallback<Args> | null | undefined;
  _argv: Args | undefined;
  _destroyed: boolean;
  [kRefed]: boolean | null;
  _asyncId: number;
  _triggerAsyncId: number;
  _contextFrame: AsyncContextFrame | undefined;

  constructor(callback: ImmediateCallback<Args>, args: Args) {
    this._idleNext = null;
    this._idlePrev = null;
    this._onImmediate = callback;
    this._argv = args;
    this._destroyed = false;
    this[kRefed] = false;

    // Identity and context captured here, at the moment the immediate is
    // asked for, because that is the only moment its caller is still on the
    // stack. By the time it runs, the loop has moved on.
    const asyncId = newAsyncId();
    const trigger = getDefaultTriggerAsyncId();
    this._asyncId = asyncId;
    this._triggerAsyncId = trigger;
    this._contextFrame = AsyncContextFrame.current();
    if (initHooksExist()) emitInit(asyncId, "Immediate", trigger, this);

    this.ref();
    count++;
    immediateQueue.append(this);
    arm();
  }

  /** Invoke the callback with the tuple checked at construction. */
  invoke(): void {
    const callback = this._onImmediate;
    const args = this._argv;
    if (callback === null || callback === undefined || args === undefined) return;
    callback.apply(this, args);
  }

  ref(): this {
    if (this[kRefed] === false) {
      this[kRefed] = true;
      if (refCount++ === 0) host.toggleImmediateRef(true);
    }
    return this;
  }

  unref(): this {
    if (this[kRefed] === true) {
      this[kRefed] = false;
      if (--refCount === 0) host.toggleImmediateRef(false);
    }
    return this;
  }

  hasRef(): boolean {
    return Boolean(this[kRefed]);
  }
}

class ImmediateList {
  head: ImmediateHandle | null = null;
  tail: ImmediateHandle | null = null;

  append(item: ImmediateHandle): void {
    if (this.tail !== null) {
      this.tail._idleNext = item;
      item._idlePrev = this.tail;
    } else {
      this.head = item;
    }
    this.tail = item;
  }

  remove(item: ImmediateHandle): void {
    if (item._idleNext) {
      item._idleNext._idlePrev = item._idlePrev;
    }

    if (item._idlePrev) {
      item._idlePrev._idleNext = item._idleNext;
    }

    if (item === this.head) this.head = item._idleNext;
    if (item === this.tail) this.tail = item._idlePrev;

    item._idleNext = null;
    item._idlePrev = null;
  }
}

export const immediateQueue = new ImmediateList();

/**
 * What a callback that threw left behind.
 *
 * An immediate whose callback throws must not swallow the ones queued after
 * it. They are held here, and the next drain takes this queue in preference to
 * the new one, so that the order across the interruption is still the order
 * they were queued in.
 */
const outstandingQueue = new ImmediateList();

/** Live immediates, and how many of them hold the process open. */
let count = 0;
let refCount = 0;

/** Whether a drain is already arranged, so that arming is idempotent. */
let armed = false;
/** Whether the arranged drain is currently running. */
let draining = false;

function arm(): void {
  // An immediate created by an immediate callback belongs to the next pass.
  // Re-arm once the current snapshot is finished, after that callback's
  // destroy report has had a chance to schedule its native immediate.
  if (armed || draining) return;
  armed = true;
  host.scheduleImmediate();
}

/** For `--expose-internals` tests, which assert on these counts directly. */
export function getCount(): number {
  return count;
}
export function getRefCount(): number {
  return refCount;
}

export function clearImmediate(immediate: ImmediateHandle | null | undefined): void {
  if (!immediate?._onImmediate || immediate._destroyed) return;

  count--;
  immediate._destroyed = true;
  emitDestroy(immediate._asyncId);

  if (immediate[kRefed] && --refCount === 0) {
    host.toggleImmediateRef(false);
  }
  immediate[kRefed] = null;

  cleanImmediate(immediate);
  immediateQueue.remove(immediate);
}

/**
 * Drop the callback and its arguments, so the closure's scope can go.
 *
 * The same reason as for timers: an immediate that has run must not be the
 * reason a request's worth of objects stays reachable.
 */
export function cleanImmediate(immediate: ImmediateHandle): void {
  immediate._onImmediate = undefined;
  immediate._argv = undefined;
}

/**
 * Run every immediate queued before now.
 *
 * The queue is taken whole and replaced with an empty one before the first
 * callback runs, so an immediate queued *by* a callback waits for the next
 * pass rather than extending this one. Without that, `setImmediate` calling
 * itself would never give the loop back.
 */
export function processImmediate(): void {
  armed = false;
  draining = true;

  const resuming = outstandingQueue.head !== null;
  const queue = resuming ? outstandingQueue : immediateQueue;
  let immediate = queue.head;

  if (!resuming) {
    queue.head = queue.tail = null;
  }

  let previous: ImmediateHandle | null = null;
  let ranAtLeastOne = false;
  try {
    while (immediate !== null) {
      // Between callbacks, not before the first, for the same reason as in the
      // timer batch: getting here already followed a drain.
      if (ranAtLeastOne) host.checkpoint();
      else ranAtLeastOne = true;

      // A tick that ran just above may have cleared this one. Its `_idleNext`
      // was nulled by the removal, so the walk has to resume from the previous
      // entry, whose link is still intact.
      if (immediate._destroyed) {
        if (previous === null) {
          throw new Error("destroyed immediate has no preceding queue node");
        }
        outstandingQueue.head = immediate = previous._idleNext;
        continue;
      }

      immediate._destroyed = true;
      count--;
      if (immediate[kRefed] && --refCount === 0) host.toggleImmediateRef(false);
      immediate[kRefed] = null;

      previous = immediate;

      const asyncId = immediate._asyncId;
      const priorFrame = AsyncContextFrame.exchange(immediate._contextFrame);
      emitBefore(asyncId, immediate._triggerAsyncId, immediate);

      try {
        try {
          immediate.invoke();
        } finally {
          // An immediate runs once, so it is finished the moment its callback
          // returns -- there is no re-arming case as there is for a timer.
          emitDestroy(asyncId);
          cleanImmediate(immediate);
          // Recorded before the callback's exception unwinds, so a throw
          // leaves the remainder of the queue findable rather than lost.
          outstandingQueue.head = immediate = immediate._idleNext;
        }
      } finally {
        emitAfter(asyncId);
        AsyncContextFrame.setCurrent(priorFrame);
      }
    }
    if (resuming) outstandingQueue.head = null;
  } finally {
    draining = false;
    // Anything still queued needs another pass: either what a callback added
    // while this one ran, or what a callback that threw left behind.
    if (outstandingQueue.head !== null || immediateQueue.head !== null) arm();
  }
}
