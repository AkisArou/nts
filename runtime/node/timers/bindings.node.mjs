// The native half of `node:timers`, for the node-side run only.
//
// Node's event loop standing in for the compiled runtime's. The seam is the
// same either way: one timer and one check-phase slot for the whole process,
// armed and disarmed by the module above, which owns all the bookkeeping about
// which callback that slot should run.
//
// Node's own scheduling functions are captured here, before the module
// installs its globals over them. Without that the module would be built on
// itself.
import "../internal/bindings.node.mjs";
import process from "node:process";

const hostSetTimeout = globalThis.setTimeout;
const hostClearTimeout = globalThis.clearTimeout;
const hostSetImmediate = globalThis.setImmediate;

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

// The same expression the module's `host.now()` uses, so that a timer's start
// and the instant it is judged against come from one clock.
const now = () => Number(process.hrtime.bigint() / NANOSECONDS_PER_MILLISECOND);

let onTimers;
let onImmediates;

// What is currently armed, so that arming again replaces rather than adds.
let armedTimer = null;
let armedImmediate = null;

// Whether an armed slot should hold the process open. Kept here because the
// answer has to survive being re-armed: the module tells us when the answer
// changes, not every time it schedules.
let timersHoldProcess = true;
let immediatesHoldProcess = true;

globalThis.nts_timers_install = (timers, immediates) => {
  onTimers = timers;
  onImmediates = immediates;
};

globalThis.nts_timers_schedule = (delayMs) => {
  if (armedTimer !== null) hostClearTimeout(armedTimer);
  armedTimer = hostSetTimeout(() => {
    // Cleared before the drain rather than after: the drain re-arms as its
    // last act, and clearing afterwards would throw that away.
    armedTimer = null;
    onTimers(now());
  }, delayMs);
  if (!timersHoldProcess) armedTimer.unref();
};

globalThis.nts_timers_cancel = () => {
  if (armedTimer !== null) {
    hostClearTimeout(armedTimer);
    armedTimer = null;
  }
};

globalThis.nts_timers_schedule_immediate = () => {
  armedImmediate = hostSetImmediate(() => {
    armedImmediate = null;
    globalThis.nts_drain_unreferenced_immediates();
    onImmediates();
  });
  if (!immediatesHoldProcess) armedImmediate.unref();
};

globalThis.nts_timers_toggle_ref = (hasRefs) => {
  timersHoldProcess = hasRefs;
  if (armedTimer === null) return;
  if (hasRefs) armedTimer.ref();
  else armedTimer.unref();
};

globalThis.nts_timers_toggle_immediate_ref = (hasRefs) => {
  immediatesHoldProcess = hasRefs;
  if (armedImmediate === null) return;
  if (hasRefs) armedImmediate.ref();
  else armedImmediate.unref();
};

// A complete checkpoint, where node runs its own: between two callbacks of one
// batch, so a `nextTick` queued by the first runs before the second rather
// than after the whole batch.
//
// `process._tickCallback` gives both halves here. Node drains its microtask
// queue at the end of each tick callback, so running the tick queue to
// exhaustion runs the microtasks with it -- which is what the measured
// ordering `A -> tick-A -> micro-A -> B` requires.
globalThis.nts_checkpoint = () => {
  process._tickCallback();
};
