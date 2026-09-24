// What the production scheduler needs from its platform: a monotonic clock, a
// way to run its work loop on a later turn of the event loop, and a timer.
//
// This is the JavaScript host, with upstream's behaviour: the platform's
// functions are captured when the module loads, so a later polyfill or
// override cannot change them, and the transport is chosen once. A native
// build supplies its own module with this interface over the platform's loop
// and clock.

const localSetTimeout = typeof setTimeout === "function" ? setTimeout : null;
const localClearTimeout = typeof clearTimeout === "function" ? clearTimeout : null;
const localSetImmediate = typeof setImmediate !== "undefined" ? setImmediate : null;

export const now: () => number = createClock();

function createClock(): () => number {
  if (typeof performance === "object" && typeof performance.now === "function") {
    const localPerformance = performance;
    return () => localPerformance.now();
  }
  const localDate = Date;
  const initialTime = localDate.now();
  return () => localDate.now() - initialTime;
}

// The scheduler's work loop, bound when its module loads so that the
// transport is chosen then, as upstream does, and requested on a later turn
// by postWork. The scheduler yields so the host can paint and handle input
// between slices of work.
let poster: (() => void) | null = null;

export function bindPerformWork(perform: () => void): void {
  poster = createWorkPoster(perform);
}

export function postWork(): void {
  poster!();
}

function createWorkPoster(perform: () => void): () => void {
  if (typeof localSetImmediate === "function") {
    // Node and jsdom. It runs earlier than a message, and unlike a
    // MessageChannel it does not keep a Node process alive.
    const setImmediateNow = localSetImmediate;
    return () => {
      setImmediateNow(perform);
    };
  }
  if (typeof MessageChannel !== "undefined") {
    // Browsers and workers: a message avoids setTimeout's 4ms clamping.
    const channel = new MessageChannel();
    const port = channel.port2;
    // Node's typings describe worker_threads' port, which has no `onmessage`;
    // the browser's port has one, and so does node's at run time. Assigning
    // through Object.assign performs the same [[Set]] as `port1.onmessage =`.
    Object.assign(channel.port1, { onmessage: perform });
    return () => {
      port.postMessage(null);
    };
  }
  return () => {
    localSetTimeout!(perform, 0);
  };
}

export type Timer = ReturnType<typeof setTimeout>;

export function startTimer(callback: () => void, ms: number): Timer {
  return localSetTimeout!(callback, ms);
}

export function cancelTimer(timer: Timer): void {
  localClearTimeout!(timer);
}
