// The scheduler's host on GLib's main loop: what scheduler/src/Host.ts is for
// the JavaScript build. A native GTK program binds this module in its place.
//
// - The clock is `g_get_monotonic_time`, in milliseconds.
// - Work runs from an idle source at G_PRIORITY_HIGH_IDLE: after input and
//   timers (G_PRIORITY_DEFAULT), before GTK's redraw (GDK_PRIORITY_REDRAW),
//   as a macrotask runs before the browser paints. A default idle priority
//   would let every redraw go first and starve React's work behind it.
// - Timers are timeout sources, kept track of: removing a source that already
//   ran is a GLib critical, and a GTK program under test makes those fatal.

import { g_get_monotonic_time, g_idle_add_full, g_source_remove, g_timeout_add_full } from "c:GLib-2.0";

// GLib's priorities are macros, so they are not in the bindings.
const PRIORITY_DEFAULT = 0;
const PRIORITY_HIGH_IDLE = 100;

export function now(): number {
  return g_get_monotonic_time() / 1000;
}

// The scheduler's work loop, bound once when the scheduler's module loads.
class BoundWork {
  perform: (() => void) | null = null;
}

const bound = new BoundWork();

export function bindPerformWork(perform: () => void): void {
  bound.perform = perform;
}

export function postWork(): void {
  g_idle_add_full(PRIORITY_HIGH_IDLE, () => {
    const perform = bound.perform;
    if (perform !== null) {
      perform();
    }
    // A slice of work that yields posts again.
    return false;
  });
}

export type Timer = number;

// Timeout sources that have not run yet, by id.
const pending = new Set<number>();

// A timer is its source id, filled in once GLib has made the source: the
// callback reads it back when it runs to stop tracking a source that is gone.
class TimerSource {
  id = 0;
}

export function startTimer(callback: () => void, ms: number): Timer {
  const source = new TimerSource();
  source.id = g_timeout_add_full(PRIORITY_DEFAULT, Math.max(0, Math.ceil(ms)), () => {
    pending.delete(source.id);
    callback();
    return false;
  });
  pending.add(source.id);
  return source.id;
}

export function cancelTimer(timer: Timer): void {
  if (pending.delete(timer)) {
    g_source_remove(timer);
  }
}
