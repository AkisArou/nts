// `node:perf_hooks`, from node v24.20.0 `lib/perf_hooks.js`.
//
// High-resolution timing: the `performance` object and its timeline of marks,
// measures and resource timings; observers of that timeline; `timerify`; the
// event loop's utilization; and HDR histograms, including one that samples the
// event loop's delay.
//
// The GC and per-subsystem entry types node reports (`gc`, `http`, `net`,
// `dns`) come from its C++ observing V8 and its own sockets. Observing them is
// supported -- `PerformanceObserver.supportedEntryTypes` lists them, as node's
// does -- and nothing in this profile produces them yet.

export { PerformanceEntry } from "./entry.ts";
export { PerformanceMark, PerformanceMeasure } from "./usertiming.ts";
export { PerformanceObserver, PerformanceObserverEntryList } from "./observe.ts";
export { PerformanceResourceTiming } from "./resource-timing.ts";
export { Performance, performance, eventLoopUtilization } from "./performance.ts";
export { createHistogram, monitorEventLoopDelay } from "./histogram.ts";
export { timerify } from "./timerify.ts";

/**
 * The GC kinds and flags a `gc` entry's `detail` reports, from
 * `src/node_perf_common.h`. Values of V8's `GCType` and `GCCallbackFlags`.
 */
export const constants = {
  NODE_PERFORMANCE_GC_MAJOR: 4,
  NODE_PERFORMANCE_GC_MINOR: 1,
  NODE_PERFORMANCE_GC_MINOR_MARK_SWEEP: 2,
  NODE_PERFORMANCE_GC_INCREMENTAL: 8,
  NODE_PERFORMANCE_GC_WEAKCB: 16,
  NODE_PERFORMANCE_GC_FLAGS_NO: 0,
  NODE_PERFORMANCE_GC_FLAGS_CONSTRUCT_RETAINED: 2,
  NODE_PERFORMANCE_GC_FLAGS_FORCED: 4,
  NODE_PERFORMANCE_GC_FLAGS_SYNCHRONOUS_PHANTOM_PROCESSING: 8,
  NODE_PERFORMANCE_GC_FLAGS_ALL_AVAILABLE_GARBAGE: 16,
  NODE_PERFORMANCE_GC_FLAGS_ALL_EXTERNAL_MEMORY: 32,
  NODE_PERFORMANCE_GC_FLAGS_SCHEDULE_IDLE: 64,
} as const;
