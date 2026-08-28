// Everything this module needs from underneath it.
//
// The shape is node's: the event loop owns one timer and one check-phase slot
// for the whole process, and this module owns the bookkeeping that decides
// which JavaScript callback that one slot should run. Node installs its two
// drains once, at bootstrap, through `setupTimers(processImmediate,
// processTimers)`; the same two functions are installed here, for the same
// reason. A host that held one reference per scheduled timer would be back to
// one host timer per `setTimeout`, and the duration lists would be pointless.
//
// Six primitives, and each earns its place:
//
//   - the two `schedule` calls arm the loop, and `cancel` disarms it,
//   - the two `toggle` calls say whether anything armed should keep the
//     process alive, which is what `unref` means and cannot be expressed by
//     not arming,
//   - `install` hands over the drains,
//   - `checkpoint` runs ticks and microtasks between callbacks, which node
//     does between every timer in a batch and is observable from user code.

import { now as monotonicNanoseconds } from "../../internal/time.ts";

/**
 * Install the two drains. Called once, when this module is first evaluated.
 *
 * `onTimers` is given the time the loop woke, so that every timer in a batch
 * is judged against one instant rather than against a clock that advances
 * while the batch runs -- otherwise a long callback can push a timer that was
 * due into the next batch.
 */
declare function nts_timers_install(
  onTimers: (now: number) => void,
  onImmediates: () => void,
): void;

/**
 * Arrange for the timer drain to run in about `delayMs`.
 *
 * Replaces any previous arrangement rather than adding to it: there is one
 * host timer, and it is always set for the earliest expiry known.
 */
declare function nts_timers_schedule(delayMs: number): void;

/**
 * Disarm the host timer.
 *
 * Distinct from scheduling a very long delay: an armed timer holds the loop
 * open, so a process whose last timeout was cleared would not exit. It is a
 * separate call rather than a sentinel delay because "no timer" is not a
 * duration.
 */
declare function nts_timers_cancel(): void;

/** Arrange for the immediate drain to run after the current operation. */
declare function nts_timers_schedule_immediate(): void;

/** Whether any live timeout should hold the process open. */
declare function nts_timers_toggle_ref(hasRefs: boolean): void;

/** Whether any live immediate should hold the process open. */
declare function nts_timers_toggle_immediate_ref(hasRefs: boolean): void;

/**
 * Run a complete checkpoint here: ticks, then microtasks, to a fixpoint.
 *
 * Node does this between every two callbacks of one batch, so a `nextTick`
 * queued by the first timer runs before the second rather than after all of
 * them. It is the *full* checkpoint and not a tick drain -- measured against
 * node, three timers at one deadline give
 * `A -> tick-A -> micro-A -> B -> tick-B -> C`, so the microtasks run there
 * too.
 *
 * A host that supplied `enqueue_microtask` owns checkpointing, and this
 * declines rather than draining beside it.
 */
declare function nts_checkpoint(): void;

export const install = nts_timers_install;
export const schedule = nts_timers_schedule;
export const cancel = nts_timers_cancel;
export const scheduleImmediate = nts_timers_schedule_immediate;
export const toggleRef = nts_timers_toggle_ref;
export const toggleImmediateRef = nts_timers_toggle_immediate_ref;
export const checkpoint = nts_checkpoint;

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

/**
 * The clock every expiry is measured against, in whole milliseconds.
 *
 * Whole because the loop underneath cannot do better: a delay becomes an
 * integer number of milliseconds before any host sees it, so a list keyed by
 * `1.5` and a list keyed by `1` would be two lists that expire at the same
 * instant. Truncating here keeps the key and the wakeup in the same units.
 *
 * Node reads the loop's *cached* time, which is taken once per iteration and
 * does not move while callbacks run; this reads the clock. The difference is
 * that two timers enrolled either side of a slow callback get start times a
 * few milliseconds apart where node's would be equal. They still land in the
 * same duration list and still expire in enrolment order, so what it changes
 * is the recorded `_idleStart`, not the ordering.
 */
export function now(): number {
  return Number(monotonicNanoseconds() / NANOSECONDS_PER_MILLISECOND);
}
