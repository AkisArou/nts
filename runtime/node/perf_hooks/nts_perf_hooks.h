/* The process and event-loop facts `perf_hooks/src/clock.ts` and
 * `perf_hooks/src/histogram.ts` declare, over libuv.
 *
 * # The time origin is this library's load
 *
 * Node's is the moment its `main` starts. A compiled program's earliest point
 * that belongs to this module is its constructor, which the loader runs before
 * `main` -- so `performance.timeOrigin` and `performance.now()` count from
 * there, and `nodeStart` is 0. In the addon, loaded into a running node, it is
 * the addon's load instead, which is what the addon measures.
 *
 * # Milestones a compiled program does not have
 *
 * `v8Start`, `environment` and `bootstrapComplete` are points in node's own
 * startup -- starting V8, creating an `Environment`, finishing the JavaScript
 * bootstrap -- and a compiled program passes none of them, so they report -1,
 * node's value for a milestone not reached.
 *
 * `loopStart` is the first iteration an unreferenced prepare handle observes,
 * which is the loop's first poll: node marks it just before `uv_run`, a timers
 * phase earlier. `loopExit` is -1 throughout: the loop is run by
 * `runtime/c/nts_uv_host.c`, and nothing it does on the way out is visible
 * from here. */
#ifndef NTS_PERF_HOOKS_H
#define NTS_PERF_HOOKS_H

#include "nts_runtime.h"

/** Milliseconds since the time origin, from the monotonic clock. */
double nts_perf_hooks_now(void);

/** The time origin as milliseconds since the epoch, to the microsecond. */
double nts_perf_hooks_time_origin(void);

/** A `NODE_PERFORMANCE_MILESTONE_*`, in milliseconds after the origin, or -1. */
double nts_perf_hooks_milestone(double milestone);

/** Milliseconds the loop has spent blocked in its poll phase. */
double nts_perf_hooks_loop_idle_time(void);

/** `uv_metrics_info`: 0 loop count, 1 events, 2 events waiting. */
double nts_perf_hooks_uv_metric(double field);

/** Start sampling every loop iteration; the sampler's id. */
double nts_perf_hooks_iteration_sampler_start(void);

/** Stop a sampler and release it. Its unread samples are discarded. */
void nts_perf_hooks_iteration_sampler_stop(double sampler);

/** The oldest unread sample in nanoseconds, or 0 when there is none. */
double nts_perf_hooks_iteration_sampler_take(double sampler);

#endif /* NTS_PERF_HOOKS_H */
