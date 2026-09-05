// The scheduling machinery behind `setTimeout` and `setInterval`, from node
// v24.20.0 `lib/internal/timers.js`.
//
// The shape of it is unusual enough to be worth stating before the code, since
// the obvious design is different and worse.
//
// The obvious design gives every timeout its own host timer. That makes
// `setTimeout` a syscall and makes ten thousand pending timeouts ten thousand
// entries in the loop's heap. Node instead keys a list by duration: every
// `setTimeout(fn, 40)` lands in the `40` list, and because they all wait the
// same length of time, one enrolled later always expires later -- so the list
// is sorted by construction and enrolling is an append. Only the *lists*
// compete for the loop's attention, through a heap ordered by expiry, and the
// loop holds exactly one timer, set for the earliest.
//
// The cost falls where it is cheap: insertion and removal are constant time,
// and the logarithmic part is over the number of distinct durations a program
// uses, which is small and does not grow with the number of timers.
//
// Async-hook identity and context are part of this machinery rather than a
// host-side facade. Construction captures the current trigger id and context,
// and the drain emits the init/before/after/destroy lifecycle around the real
// callback. Importing the shared registry keeps timer resources observable to
// the same `node:async_hooks` instance that registered the hook.

import * as L from "./linkedlist.ts";
import type { ListNode } from "./linkedlist.ts";
import { PriorityQueue } from "./priority-queue.ts";
import * as host from "./host.ts";
import { ERR_OUT_OF_RANGE } from "../../internal/errors.ts";
import { validateFunction, validateNumber } from "../../internal/validators.ts";
import { AsyncContextFrame } from "../../internal/async-context.ts";
import { emitWarning } from "../../internal/process-warning.ts";
import {
  emitAfter,
  emitBefore,
  emitDestroy,
  emitInit,
  getDefaultTriggerAsyncId,
  initHooksExist,
  newAsyncId,
} from "../../internal/async-hooks.ts";

/** Above this a delay does not fit in the signed 32-bit field the loop uses. */
export const TIMEOUT_MAX = 2 ** 31 - 1;

/**
 * Whether this timer counts towards keeping the process alive.
 *
 * A symbol rather than a field because it must not appear in `Object.keys` or
 * in an inspection of a `Timeout`: node's tests print timer objects and
 * compare the text.
 */
export const kRefed = Symbol("refed");

export type TimerCallback<Args extends unknown[] = []> = (...args: Args) => void;

/**
 * The type-erased view held by the duration lists.
 *
 * Each `Timeout` constructor checks one callback against one argument tuple.
 * A duration list is deliberately heterogeneous, so it retains only the
 * operations the scheduler needs and asks the handle to invoke its own tuple.
 * This avoids both an unsound bottom-type callback and a wrapper allocation
 * for every timer.
 */
export interface TimeoutHandle extends ListNode {
  _idleTimeout: number;
  _idleStart: number | null;
  // Opaque on the erased scheduler view: only the concrete generic handle
  // invokes this value, through its typed `invoke()` method.
  _onTimeout: object | null | undefined;
  _timerArgs: unknown[] | undefined;
  _repeat: number | null;
  _destroyed: boolean;
  [kRefed]: boolean | null;
  _asyncId: number;
  _triggerAsyncId: number;
  _contextFrame: AsyncContextFrame | undefined;
  invoke(): void;
}

// A delay outside the representable range is clamped to 1ms, and the program
// is told. The negative and not-a-number cases warn once per process because
// they are usually a bug in a loop, and a warning per iteration would bury the
// output; an overflow warns every time, because it is usually a single
// miscalculated constant and every occurrence is worth seeing.
let warnedNegativeNumber = false;
let warnedNotNumber = false;

/**
 * Give `timer` an identity and the context of whoever created it.
 *
 * Both halves are captured here rather than when the timer fires, because the
 * gap a timer spans is exactly the thing that loses them: by the time the
 * callback runs, the code that scheduled it has returned and the runtime is
 * midway through a completely unrelated part of the loop.
 */
function initAsyncResource(timer: TimeoutHandle): void {
  const asyncId = newAsyncId();
  const trigger = getDefaultTriggerAsyncId();
  timer._asyncId = asyncId;
  timer._triggerAsyncId = trigger;
  timer._contextFrame = AsyncContextFrame.current();
  if (initHooksExist()) emitInit(asyncId, "Timeout", trigger, timer);
}

export class Timeout<Args extends unknown[] = []> implements TimeoutHandle {
  _idleTimeout: number;
  _idlePrev: ListNode | null;
  _idleNext: ListNode | null;
  _idleStart: number | null;
  _onTimeout: TimerCallback<Args> | null | undefined;
  _timerArgs: Args | undefined;
  _repeat: number | null;
  _destroyed: boolean;
  [kRefed]: boolean | null;
  _asyncId = 0;
  _triggerAsyncId = 0;
  _contextFrame: AsyncContextFrame | undefined = undefined;

  constructor(
    callback: TimerCallback<Args>,
    after: number | undefined,
    args: Args,
    isRepeat: boolean,
    isRefed: boolean,
  ) {
    let delay: number;
    if (after === undefined) {
      // Not coerced, which is why `setTimeout(fn)` and `setTimeout(fn, {})`
      // differ: the first is a missing argument and the second is a value that
      // is not a number, and only the second is worth warning about.
      delay = 1;
    } else {
      delay = after * 1;
    }

    if (!(delay >= 1 && delay <= TIMEOUT_MAX)) {
      if (delay > TIMEOUT_MAX) {
        emitWarning(
          `${delay} does not fit into a 32-bit signed integer.\nTimeout duration was set to 1.`,
          "TimeoutOverflowWarning",
          "",
        );
      } else if (delay < 0 && !warnedNegativeNumber) {
        warnedNegativeNumber = true;
        emitWarning(
          `${delay} is a negative number.\nTimeout duration was set to 1.`,
          "TimeoutNegativeWarning",
          "",
        );
      } else if (Number.isNaN(delay) && !warnedNotNumber) {
        warnedNotNumber = true;
        emitWarning(
          `${delay} is not a number.\nTimeout duration was set to 1.`,
          "TimeoutNaNWarning",
          "",
        );
      }
      // Browsers do the same, and a zero-delay timer that fired synchronously
      // would let a loop of them starve everything else.
      delay = 1;
    }

    this._idleTimeout = delay;
    // Pointing at itself rather than at null, so that a timer always has the
    // shape of a list element and `append` needs no special first case.
    this._idlePrev = this;
    this._idleNext = this;
    this._idleStart = null;
    this._onTimeout = callback;
    this._timerArgs = args;
    this._repeat = isRepeat ? delay : null;
    this._destroyed = false;

    if (isRefed) incRefCount();
    this[kRefed] = isRefed;
    initAsyncResource(this);
  }

  /** Invoke the callback with the tuple checked when this handle was built. */
  invoke(): void {
    const callback = this._onTimeout;
    const args = this._timerArgs;
    if (callback === null || callback === undefined || args === undefined) return;
    callback.apply(this, args);
  }

  /**
   * Restart the timer from now, without allocating a new one.
   *
   * This is why a fired timer is not thrown away. A server that resets an idle
   * timeout on every incoming byte would otherwise allocate a `Timeout` per
   * byte; refreshing moves the existing one to the end of its list, which is
   * the same four pointer writes as any other append.
   */
  refresh(): this {
    if (this[kRefed]) active(this);
    else unrefActive(this);
    return this;
  }

  unref(): this {
    if (this[kRefed]) {
      this[kRefed] = false;
      if (!this._destroyed) decRefCount();
    }
    return this;
  }

  ref(): this {
    if (!this[kRefed]) {
      this[kRefed] = true;
      if (!this._destroyed) incRefCount();
    }
    return this;
  }

  hasRef(): boolean {
    return Boolean(this[kRefed]);
  }

  close(): this {
    clearTimeout(this);
    return this;
  }

  [Symbol.dispose](): void {
    clearTimeout(this);
  }
}

/**
 * Cancel a timeout or an interval.
 *
 * One function for both, as the HTML standard requires: `clearInterval` on a
 * `setTimeout` handle has to work, because the two id spaces are one.
 *
 * Clearing something that is not a live timer -- already fired, already
 * cleared, never a timer at all -- is not an error. `clearTimeout` is what
 * cleanup paths call, and a cleanup path that has to know whether there is
 * anything to clean is one every caller gets wrong somewhere.
 */
export function clearTimeout(timer: TimeoutHandle | number | string | null | undefined): void {
  if (timer !== null && typeof timer === "object" && timer._onTimeout) {
    // Nulled rather than left alone, so that a batch already in flight sees
    // this timer as cancelled when it reaches it.
    timer._onTimeout = null;
    unenroll(timer);
  }
}

/**
 * One duration's worth of timers, and the head of their list.
 *
 * `expiry` is when the *oldest* member is due, which is what the heap orders
 * by. `id` breaks a tie between two lists due at the same instant, so that the
 * one created first goes first and the order is total rather than arbitrary.
 */
export class TimersList implements ListNode {
  _idleNext: ListNode;
  _idlePrev: ListNode;
  expiry: number;
  id: number;
  msecs: number;
  priorityQueuePosition: number | null;

  constructor(expiry: number, msecs: number) {
    this._idleNext = this;
    this._idlePrev = this;
    this.expiry = expiry;
    this.id = nextListId++;
    this.msecs = msecs;
    this.priorityQueuePosition = null;
  }
}

let nextListId = Number.MIN_SAFE_INTEGER;

/** Duration in whole milliseconds to the list of timers waiting that long. */
export const timerListMap = new Map<number, TimersList>();

export const timerListQueue = new PriorityQueue<TimersList>(
  (a, b) => {
    const byExpiry = a.expiry - b.expiry;
    return byExpiry === 0 ? a.id - b.id : byExpiry;
  },
  (list, position) => {
    list.priorityQueuePosition = position;
  },
);

/** The earliest expiry the host timer is currently set for. */
let nextExpiry = Infinity;

/** How many live timeouts are refed, and so should hold the process open. */
let refCount = 0;

function incRefCount(): void {
  if (refCount++ === 0) host.toggleRef(true);
}

/**
 * One fewer live refed timeout, and tell the host when it was the last.
 *
 * Node decrements its shared count here without toggling, because its loop
 * re-reads the count each time it re-arms the host timer. This module re-arms
 * itself, so nothing else would notice the count reaching zero, and a process
 * whose remaining timers were all unrefed would refuse to exit.
 */
export function decRefCount(): void {
  if (--refCount === 0) host.toggleRef(false);
}

/** For `--expose-internals` tests, which assert on the count directly. */
export function getRefCount(): number {
  return refCount;
}

/**
 * Enrol or re-enrol a timer, and arm the host if it is now the earliest.
 *
 * `start` is passed in when re-arming a repeating timer, so that the interval
 * is measured from when the callback began rather than from when it returned:
 * an interval whose callback takes longer than the interval would otherwise
 * drift by the duration of every callback.
 */
export function insert(item: TimeoutHandle, msecs: number, start: number = host.now()): void {
  // Truncated so that the key and the host's resolution agree. A `1.5` list
  // and a `1` list would both wake at the same millisecond and the second
  // would find nothing due.
  const duration = Math.trunc(msecs);
  item._idleStart = start;

  let list = timerListMap.get(duration);
  if (list === undefined) {
    const expiry = start + duration;
    list = new TimersList(expiry, duration);
    timerListMap.set(duration, list);
    timerListQueue.insert(list);

    if (nextExpiry > expiry) {
      host.schedule(duration);
      nextExpiry = expiry;
    }
  }

  L.append(list, item);
}

/** Schedule or reschedule, keeping the timer's current refed state. */
export function active(item: TimeoutHandle): void {
  insertGuarded(item, true);
}

/**
 * The same, but not holding the process open.
 *
 * What internal timers use: an idle-socket timeout should not be the reason a
 * program refuses to exit.
 */
export function unrefActive(item: TimeoutHandle): void {
  insertGuarded(item, false);
}

function insertGuarded(item: TimeoutHandle, refed: boolean): void {
  const msecs = item._idleTimeout;
  // `unenroll` sets this to -1, and a timer that was cleared must not come
  // back to life because something called `refresh` on it afterwards.
  if (msecs < 0) return;

  insert(item, msecs);

  const wasDestroyed = item._destroyed;
  if (wasDestroyed) {
    item._destroyed = false;
    // A refreshed timer is a new piece of asynchronous work, not a
    // continuation of the one that finished: it was scheduled from somewhere
    // else, and a hook that saw the old id would attribute it to the wrong
    // caller.
    initAsyncResource(item);
    if (refed) incRefCount();
  } else if (refed === !item[kRefed]) {
    if (refed) incRefCount();
    else decRefCount();
  }
  item[kRefed] = refed;
}

/**
 * Cancel a timer and let go of everything it holds.
 *
 * This lives beside the lists rather than with `clearTimeout`, because it is
 * the only thing that removes a list from the map and the heap, and those are
 * this file's. Node has it in `lib/timers.js` for reasons of module history.
 */
export function unenroll(item: TimeoutHandle): void {
  if (item._destroyed) {
    cleanTimer(item);
    return;
  }

  const wasEnrolled = item._idleNext !== null || item._idlePrev !== null;
  item._destroyed = true;
  // A cancelled timer is finished, and nothing else will say so: it will never
  // reach the batch that reports the ones that fired.
  emitDestroy(item._asyncId);

  L.remove(item);

  // Only a refed timer's list is dropped when it empties. An unrefed one is
  // overwhelmingly likely to be a socket timeout that will be recreated within
  // microseconds, and destroying the list to rebuild it costs a heap insert
  // each way.
  if (item[kRefed]) {
    const duration = Math.trunc(item._idleTimeout);
    const list = timerListMap.get(duration);
    if (list !== undefined && L.isEmpty(list)) {
      const position = list.priorityQueuePosition;
      if (position === null) throw new Error("timer list has no heap position");
      timerListQueue.removeAt(position);
      timerListMap.delete(list.msecs);
    }
    decRefCount();
  }

  if (wasEnrolled) cleanTimer(item);

  // So that a later `refresh` finds a duration that `insertGuarded` refuses.
  item._idleTimeout = -1;
}

/**
 * Drop the callback and its arguments.
 *
 * Not tidiness: a timer that fired keeps its callback alive, and the callback
 * closes over whatever the caller's scope held. A server that sets one timeout
 * per request would hold every request's scope until the timer object itself
 * became unreachable.
 */
export function cleanTimer(timer: TimeoutHandle): void {
  timer._onTimeout = undefined;
  timer._timerArgs = undefined;
}

/**
 * Validate a duration given to an API that takes one directly, such as a
 * socket's idle timeout.
 *
 * Stricter than the `Timeout` constructor, which clamps: here a bad duration
 * is the caller's mistake rather than a value to rescue, so it throws. An
 * overflow is still clamped, because a very large idle timeout means "never"
 * and refusing it would be less useful than truncating it.
 */
export function getTimerDuration(msecs: unknown, name: string): number {
  validateNumber(msecs, name);
  const value = msecs;
  if (value < 0 || !Number.isFinite(value)) {
    throw new ERR_OUT_OF_RANGE(name, "a non-negative finite number", value);
  }

  if (value > TIMEOUT_MAX) {
    emitWarning(
      `${value} does not fit into a 32-bit signed integer.\nTimer duration was truncated to ${TIMEOUT_MAX}.`,
      "TimeoutOverflowWarning",
      "",
    );
    return TIMEOUT_MAX;
  }

  return value;
}

/** A timeout that does not hold the process open, for internal use. */
export function setUnrefTimeout<Args extends unknown[]>(
  callback: TimerCallback<Args>,
  after?: number,
  ...args: Args
): Timeout<Args> {
  // Checked even though the caller is internal: this is the entry point other
  // subsystems reach for, and a non-function stored now fails much later, in
  // the drain, where nothing points back at who scheduled it.
  validateFunction(callback, "callback");
  const timer = new Timeout(callback, after, args, false, false);
  insert(timer, timer._idleTimeout);
  return timer;
}

/**
 * Run every timer that is due, then re-arm the host for the next one.
 *
 * `now` is the instant the loop woke, and every timer in this pass is judged
 * against it rather than against a clock read per timer. Otherwise a slow
 * callback would push a timer that was already due into the next wakeup, and a
 * batch of timers set for the same instant would dribble out over several
 * loop iterations.
 */
export function processTimers(now: number): void {
  // Nothing is scheduled from this module's point of view until the drain
  // finishes and `rearm` says what is. Any `insert` during the batch sees
  // `Infinity` and arms eagerly; `rearm` then replaces that with the truth.
  nextExpiry = Infinity;

  let ranAtLeastOneList = false;
  try {
    for (;;) {
      const list = timerListQueue.peek();
      if (list === undefined || list.expiry > now) break;
      // Between lists, not before the first: entering `processTimers` already
      // followed a drain, and draining an empty queue twice is only waste.
      if (ranAtLeastOneList) host.checkpoint();
      else ranAtLeastOneList = true;
      listOnTimeout(list, now);
    }
  } finally {
    rearm();
  }
}

/**
 * Set the host timer for the earliest expiry still on the heap.
 *
 * Read from the heap rather than from a value the loop tracked, and reached
 * through a `finally`, because a callback is allowed to throw. An interval
 * whose callback throws has to keep running -- browsers do that and node
 * matches them -- and it only can if the exception on its way out still leaves
 * the loop armed. Tracking the next expiry in a local would lose it: the
 * throwing timer's own reinsertion happens in *its* `finally`, after which the
 * stack unwinds past any bookkeeping the drain loop had left to do.
 *
 * Re-arming here rather than by returning the expiry to the host keeps the
 * decision on the side of the seam that owns the heap. A host that had to
 * interpret a return value would be a second place the rule lived.
 */
function rearm(): void {
  const next = timerListQueue.peek();
  if (next === undefined) {
    nextExpiry = Infinity;
    host.cancel();
    return;
  }
  nextExpiry = next.expiry;
  host.schedule(Math.max(nextExpiry - host.now(), 0));
}

function listOnTimeout(list: TimersList, now: number): void {
  const msecs = list.msecs;
  let ranAtLeastOneTimer = false;

  for (;;) {
    const node = L.peek(list);
    if (node === null) break;
    if (!(node instanceof Timeout)) {
      throw new Error("timer list contains a non-timeout node");
    }
    const timer: TimeoutHandle = node;

    const idleStart = timer._idleStart;
    if (idleStart === null) throw new Error("enrolled timer has no start time");
    const waited = now - idleStart;
    if (waited < msecs) {
      // The oldest timer in this list is not due, so none of them are. Push
      // the list back and let the heap find the next one.
      //
      // `now + 1` is a floor on the new expiry: without it, a list whose
      // computed expiry is still in the past would be picked again
      // immediately, and `processTimers` would spin.
      list.expiry = Math.max(idleStart + msecs, now + 1);
      list.id = nextListId++;
      timerListQueue.percolateDown(1);
      return;
    }

    if (ranAtLeastOneTimer) host.checkpoint();
    else ranAtLeastOneTimer = true;

    L.remove(timer);

    if (!timer._onTimeout) {
      // Cleared while this batch was running, by an earlier callback in it.
      if (!timer._destroyed) {
        timer._destroyed = true;
        cleanTimer(timer);
        if (timer[kRefed]) decRefCount();
        emitDestroy(timer._asyncId);
      }
      continue;
    }

    // Read before the callback runs, so a repeating timer's next due time is
    // measured from when it started rather than from when it finished.
    let start = 0;
    if (timer._repeat) start = host.now();

    // The context of whoever scheduled this timer, restored for the duration
    // of its callback. Nothing in the engine carries it across the gap a timer
    // spans, so it is put back by hand here and taken away again below.
    const asyncId = timer._asyncId;
    const priorFrame = AsyncContextFrame.exchange(timer._contextFrame);
    emitBefore(asyncId, timer._triggerAsyncId, timer);

    try {
      try {
        timer.invoke();
      } finally {
        if (timer._repeat && timer._idleTimeout !== -1) {
          timer._idleTimeout = timer._repeat;
          insert(timer, timer._idleTimeout, start);
        } else if (!timer._idleNext && !timer._idlePrev) {
          // Still unlinked, so the callback did not re-arm it and this timer
          // is finished. A callback that called `refresh` on its own timer
          // would have relinked it, and then it is live and must not be
          // destroyed.
          if (timer._destroyed) {
            timer._onTimeout = undefined;
            timer._timerArgs = undefined;
          } else {
            timer._destroyed = true;
            if (timer[kRefed]) decRefCount();
            emitDestroy(asyncId);
          }
        }
      }
    } finally {
      // Outside the re-arming block, and in this order: `destroy` above says
      // the timer is finished, `after` here says its scope has closed. A
      // resource cannot stop existing while a scope of its own is still open.
      emitAfter(asyncId);
      AsyncContextFrame.setCurrent(priorFrame);
    }
  }

  // The list emptied. Drop it, unless it was already dropped and rebuilt while
  // the callbacks ran -- in which case the map holds a different list under
  // this duration and removing that one would strand its timers.
  if (list === timerListMap.get(msecs)) {
    timerListMap.delete(msecs);
    timerListQueue.shift();
  }
}
