// The native half of `node:perf_hooks`, for the node-side run only.
//
// Every stand-in reads node's own `performance`: the clock, the time origin,
// the lifecycle milestones and the loop's idle time are facts about the
// process running the test, and node is the one that knows them. Captured
// before the module installs its `performance` global over node's.
import "../internal/bindings.node.mjs";
import "../timers/bindings.node.mjs";
// `Event`, which `resourcetimingbufferfull` is, asks the environment for a
// platform clock; this is the canonical emulation of those intrinsics.
import "../../web-platform/host/environment-shim.ts";
import { performance } from "node:perf_hooks";

globalThis.nts_perf_hooks_now = () => performance.now();
globalThis.nts_perf_hooks_time_origin = () => performance.timeOrigin;

// In node's numbering (`NODE_PERFORMANCE_MILESTONE_*`), which is the
// module's. Read live: `loopStart` and `loopExit` change as the loop runs.
const milestoneNames = new Map([
  [2, "environment"],
  [3, "nodeStart"],
  [4, "v8Start"],
  [5, "loopStart"],
  [6, "loopExit"],
  [7, "bootstrapComplete"],
]);
globalThis.nts_perf_hooks_milestone = (which) => performance.nodeTiming[milestoneNames.get(which)];

globalThis.nts_perf_hooks_loop_idle_time = () => performance.nodeTiming.idleTime;

const uvMetricNames = ["loopCount", "events", "eventsWaiting"];
globalThis.nts_perf_hooks_uv_metric = (field) =>
  performance.nodeTiming.uvMetricsInfo[uvMetricNames[field]];

// Per-iteration sampling needs libuv's prepare and check phases, which node
// does not expose to JavaScript -- its own sampler is C++. There is nothing
// here to stand in with, so asking for one says so rather than sampling
// something else under the same name.
globalThis.nts_perf_hooks_iteration_sampler_start = () => {
  throw new Error(
    "monitorEventLoopDelay({ samplePerIteration: true }) needs the event loop's " +
      "prepare and check phases, which node does not expose to JavaScript",
  );
};
globalThis.nts_perf_hooks_iteration_sampler_stop = () => {};
globalThis.nts_perf_hooks_iteration_sampler_take = () => 0;
