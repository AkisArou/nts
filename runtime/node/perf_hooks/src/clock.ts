// The clocks and loop facts `node:perf_hooks` reads, from node v24.20.0
// `lib/internal/perf/utils.js` and the `performance` binding in
// `src/node_perf.cc`.
//
// Every one of them is a native, because each is a fact about the process or
// its event loop rather than about anything this module holds: when the
// process started, how long the loop has spent waiting, whether it has started
// at all. The module computes nothing here that a caller could compute better.

/**
 * Milliseconds since the process's time origin, from the monotonic clock:
 * `performance.now()`. Node's is `(uv_hrtime() - process_start) / 1e6`.
 */
/** @ntsAbi managed */
declare function nts_perf_hooks_now(): number;

/**
 * The time origin as a wall-clock time, in milliseconds since the epoch with
 * microsecond precision: `performance.timeOrigin`.
 */
/** @ntsAbi managed */
declare function nts_perf_hooks_time_origin(): number;

/**
 * One lifecycle milestone, in milliseconds after the time origin, or -1 when
 * the process has not reached it. `milestone` is one of the `kMilestone*`
 * values below.
 */
/** @ntsAbi managed */
declare function nts_perf_hooks_milestone(milestone: number): number;

/**
 * Milliseconds the event loop has spent blocked waiting for events since it
 * started: libuv's `uv_metrics_idle_time`.
 */
/** @ntsAbi managed */
declare function nts_perf_hooks_loop_idle_time(): number;

/**
 * One of libuv's `uv_metrics_info` counters: 0 for the loop's iteration count,
 * 1 for the events it has processed, 2 for the events that were waiting when
 * the provider was entered.
 */
/** @ntsAbi managed */
declare function nts_perf_hooks_uv_metric(field: number): number;

/**
 * The milestones node records, in node's own numbering
 * (`NODE_PERFORMANCE_MILESTONE_*` in `src/node_perf_common.h`), which is what
 * the native answers by.
 */
export const kMilestoneEnvironment = 2;
export const kMilestoneNodeStart = 3;
export const kMilestoneV8Start = 4;
export const kMilestoneLoopStart = 5;
export const kMilestoneLoopExit = 6;
export const kMilestoneBootstrapComplete = 7;

export const now: () => number = nts_perf_hooks_now;

export const timeOrigin: () => number = nts_perf_hooks_time_origin;

export const milestone: (which: number) => number = nts_perf_hooks_milestone;

export const loopIdleTime: () => number = nts_perf_hooks_loop_idle_time;

/** `uv_metrics_info`, as node's `performance.nodeTiming.uvMetricsInfo` spells it. */
export interface UVMetrics {
  loopCount: number;
  events: number;
  eventsWaiting: number;
}

export function uvMetricsInfo(): UVMetrics {
  return {
    loopCount: nts_perf_hooks_uv_metric(0),
    events: nts_perf_hooks_uv_metric(1),
    eventsWaiting: nts_perf_hooks_uv_metric(2),
  };
}
