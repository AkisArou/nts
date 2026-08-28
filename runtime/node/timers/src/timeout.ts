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
// What this file does not do is async_hooks. Node emits an init/before/after/
// destroy quartet around every timer, and threads an async context frame
// through it. That belongs to `async_hooks`, which this profile does not have;
// the timer semantics here are complete without it, and the places node emits
// from are not marked because they are not this module's business.

import * as L from "./linkedlist.ts";
import type { ListNode } from "./linkedlist.ts";
import { PriorityQueue } from "./priority-queue.ts";
import * as host from "./host.ts";
import { ERR_OUT_OF_RANGE } from "../../internal/errors.ts";
import { validateFunction, validateNumber } from "../../internal/validators.ts";

declare function nts_process_emit_warning(message: string, name: string, code: string): void;

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

/** Whether this timer has been coerced to a number, and so is in the id map. */
export const kHasPrimitive = Symbol("hasPrimitive");

/** The number a timer coerces to, and the key `clearTimeout` accepts. */
export const kTimerId = Symbol("timerId");

export type TimerCallback = (...args: never[]) => void;

/**
 * Ids for timers, handed out in creation order.
 *
 * Node reuses the async-hooks resource id here, which this profile has no
 * source of. The contract the id has to meet is only that it is a number, that
 * two live timers never share one, and that `clearTimeout` can find the timer
 * from it -- a counter meets all three. It starts away from zero so that a
 * falsy id cannot be mistaken for a missing one.
 */
let nextTimerId = 1;

/** Timers that have been coerced to a number, so `clearTimeout(id)` works. */
export const knownTimersById = new Map<number, Timeout>();

// A delay outside the representable range is clamped to 1ms, and the program
// is told. The negative and not-a-number cases warn once per process because
// they are usually a bug in a loop, and a warning per iteration would bury the
// output; an overflow warns every time, because it is usually a single
// miscalculated constant and every occurrence is worth seeing.
let warnedNegativeNumber = false;
let warnedNotNumber = false;

export class Timeout implements ListNode {
  _idleTimeout: number;
  _idlePrev: ListNode | null;
  _idleNext: ListNode | null;
  _idleStart: number | null;
  _onTimeout: TimerCallback | null | undefined;
  _timerArgs: unknown[] | undefined;
  _repeat: number | null;
  _destroyed: boolean;
  [kRefed]: boolean | null;
  [kHasPrimitive]: boolean;
  [kTimerId]: number;

  constructor(
    callback: TimerCallback,
    after: number | undefined,
    args: unknown[] | undefined,
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
      delay = (after as number) * 1;
    }

    if (!(delay >= 1 && delay <= TIMEOUT_MAX)) {
      if (delay > TIMEOUT_MAX) {
        nts_process_emit_warning(
          `${delay} does not fit into a 32-bit signed integer.\nTimeout duration was set to 1.`,
          "TimeoutOverflowWarning",
          "",
        );
      } else if (delay < 0 && !warnedNegativeNumber) {
        warnedNegativeNumber = true;
        nts_process_emit_warning(
          `${delay} is a negative number.\nTimeout duration was set to 1.`,
          "TimeoutNegativeWarning",
          "",
        );
      } else if (Number.isNaN(delay) && !warnedNotNumber) {
        warnedNotNumber = true;
        nts_process_emit_warning(
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
    this[kHasPrimitive] = false;
    this[kTimerId] = nextTimerId++;
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

  /**
   * The number this timer coerces to, which `clearTimeout` also accepts.
   *
   * Browsers return an integer from `setTimeout`, and code written for both
   * stores `+timer` or uses it as a key. Registering here rather than in the
   * constructor means a program that never coerces its timers never populates
   * the map, and the map never keeps a cleared timer alive.
   */
  [Symbol.toPrimitive](): number {
    const id = this[kTimerId];
    if (!this[kHasPrimitive]) {
      this[kHasPrimitive] = true;
      knownTimersById.set(id, this);
    }
    return id;
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
export function clearTimeout(timer: Timeout | number | string | null | undefined): void {
  if (timer !== null && typeof timer === "object" && timer._onTimeout) {
    // Nulled rather than left alone, so that a batch already in flight sees
    // this timer as cancelled when it reaches it.
    timer._onTimeout = null;
    unenroll(timer);
    return;
  }
  if (typeof timer === "number" || typeof timer === "string") {
    // Through `Number` because node keys this map with an object, where `5`
    // and `"5"` are the same property. A caller that stored `String(timer)`
    // must be able to clear with it.
    const found = knownTimersById.get(Number(timer));
    if (found !== undefined) {
      found._onTimeout = null;
      unenroll(found);
    }
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
export function insert(item: Timeout, msecs: number, start: number = host.now()): void {
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
export function active(item: Timeout): void {
  insertGuarded(item, true);
}

/**
 * The same, but not holding the process open.
 *
 * What internal timers use: an idle-socket timeout should not be the reason a
 * program refuses to exit.
 */
export function unrefActive(item: Timeout): void {
  insertGuarded(item, false);
}

function insertGuarded(item: Timeout, refed: boolean): void {
  const msecs = item._idleTimeout;
  // `unenroll` sets this to -1, and a timer that was cleared must not come
  // back to life because something called `refresh` on it afterwards.
  if (msecs < 0) return;

  insert(item, msecs);

  const wasDestroyed = item._destroyed;
  if (wasDestroyed) {
    item._destroyed = false;
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
export function unenroll(item: Timeout): void {
  if (item._destroyed) {
    cleanTimer(item);
    return;
  }

  const wasEnrolled = item._idleNext !== null || item._idlePrev !== null;
  item._destroyed = true;

  if (item[kHasPrimitive]) knownTimersById.delete(item[kTimerId]);

  L.remove(item);

  // Only a refed timer's list is dropped when it empties. An unrefed one is
  // overwhelmingly likely to be a socket timeout that will be recreated within
  // microseconds, and destroying the list to rebuild it costs a heap insert
  // each way.
  if (item[kRefed]) {
    const duration = Math.trunc(item._idleTimeout);
    const list = timerListMap.get(duration);
    if (list !== undefined && L.isEmpty(list)) {
      timerListQueue.removeAt(list.priorityQueuePosition as number);
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
export function cleanTimer(timer: Timeout): void {
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
  const value = msecs as number;
  if (value < 0 || !Number.isFinite(value)) {
    throw new ERR_OUT_OF_RANGE(name, "a non-negative finite number", value);
  }

  if (value > TIMEOUT_MAX) {
    nts_process_emit_warning(
      `${value} does not fit into a 32-bit signed integer.\nTimer duration was truncated to ${TIMEOUT_MAX}.`,
      "TimeoutOverflowWarning",
      "",
    );
    return TIMEOUT_MAX;
  }

  return value;
}

/** A timeout that does not hold the process open, for internal use. */
export function setUnrefTimeout(callback: TimerCallback, after?: number): Timeout {
  // Checked even though the caller is internal: this is the entry point other
  // subsystems reach for, and a non-function stored now fails much later, in
  // the drain, where nothing points back at who scheduled it.
  validateFunction(callback, "callback");
  const timer = new Timeout(callback, after, undefined, false, false);
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
      if (ranAtLeastOneList) host.runTicks();
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
    const timer = L.peek(list) as Timeout | null;
    if (timer === null) break;

    const waited = now - (timer._idleStart as number);
    if (waited < msecs) {
      // The oldest timer in this list is not due, so none of them are. Push
      // the list back and let the heap find the next one.
      //
      // `now + 1` is a floor on the new expiry: without it, a list whose
      // computed expiry is still in the past would be picked again
      // immediately, and `processTimers` would spin.
      list.expiry = Math.max((timer._idleStart as number) + msecs, now + 1);
      list.id = nextListId++;
      timerListQueue.percolateDown(1);
      return;
    }

    if (ranAtLeastOneTimer) host.runTicks();
    else ranAtLeastOneTimer = true;

    L.remove(timer);

    if (!timer._onTimeout) {
      // Cleared while this batch was running, by an earlier callback in it.
      if (!timer._destroyed) {
        timer._destroyed = true;
        cleanTimer(timer);
        if (timer[kHasPrimitive]) knownTimersById.delete(timer[kTimerId]);
        if (timer[kRefed]) decRefCount();
      }
      continue;
    }

    // Read before the callback runs, so a repeating timer's next due time is
    // measured from when it started rather than from when it finished.
    let start = 0;
    if (timer._repeat) start = host.now();

    try {
      const args = timer._timerArgs;
      if (args === undefined) timer._onTimeout();
      // Through `Reflect.apply` rather than `callback.apply(...)`, because the
      // callback is the caller's object and `apply` is one of its properties.
      // A function with `fn.apply = "not a function"` is a strange thing to
      // write and a real one to receive, and calling through it would throw
      // inside the timer rather than in the caller's own code.
      else Reflect.apply(timer._onTimeout as (...a: unknown[]) => void, timer, args);
    } finally {
      if (timer._repeat && timer._idleTimeout !== -1) {
        timer._idleTimeout = timer._repeat;
        insert(timer, timer._idleTimeout, start);
      } else if (!timer._idleNext && !timer._idlePrev) {
        // Still unlinked, so the callback did not re-arm it and this timer is
        // finished. A callback that called `refresh` on its own timer would
        // have relinked it, and then it is live and must not be destroyed.
        if (timer._destroyed) {
          timer._onTimeout = undefined;
          timer._timerArgs = undefined;
        } else {
          timer._destroyed = true;
          if (timer[kHasPrimitive]) knownTimersById.delete(timer[kTimerId]);
          if (timer[kRefed]) decRefCount();
        }
      }
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
