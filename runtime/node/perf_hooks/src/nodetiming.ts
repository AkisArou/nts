// `performance.nodeTiming`, from node v24.20.0 `lib/internal/perf/nodetiming.js`.
//
// The process's own lifecycle as a performance entry: when it started, when
// its event loop started and stopped, and how long that loop has spent
// waiting. Every field is read when asked, never cached -- `loopStart` is -1
// until the loop runs, and `duration` is the process's age at the moment of
// the read.

import {
  kMilestoneBootstrapComplete,
  kMilestoneEnvironment,
  kMilestoneLoopExit,
  kMilestoneLoopStart,
  kMilestoneNodeStart,
  kMilestoneV8Start,
  loopIdleTime,
  milestone,
  now,
  uvMetricsInfo,
  type UVMetrics,
} from "./clock.ts";
import { customInspectSymbol, inspect, type InspectOptions } from "../../util/src/inspect.ts";
import { PerformanceEntry, atDepthLimit, kSkipThrow } from "./entry.ts";

/** What `toJSON` reports: every field but `uvMetricsInfo`, as node's does. */
export interface PerformanceNodeTimingJSON {
  name: "node";
  entryType: "node";
  startTime: number;
  duration: number;
  nodeStart: number;
  v8Start: number;
  bootstrapComplete: number;
  environment: number;
  loopStart: number;
  loopExit: number;
  idleTime: number;
}

/**
 * An entry, as node makes it one by giving it `PerformanceEntry.prototype`:
 * `nodeTiming instanceof PerformanceEntry`. Its four entry fields are its own,
 * because `duration` is live.
 */
export class PerformanceNodeTiming extends PerformanceEntry {
  constructor(skipThrow: unknown) {
    super(skipThrow, "node", "node", 0, 0);
  }

  override get name(): "node" {
    return "node";
  }

  override get entryType(): "node" {
    return "node";
  }

  override get startTime(): number {
    return 0;
  }

  override get duration(): number {
    return now();
  }

  get nodeStart(): number {
    return milestone(kMilestoneNodeStart);
  }

  get v8Start(): number {
    return milestone(kMilestoneV8Start);
  }

  get environment(): number {
    return milestone(kMilestoneEnvironment);
  }

  get loopStart(): number {
    return milestone(kMilestoneLoopStart);
  }

  get loopExit(): number {
    return milestone(kMilestoneLoopExit);
  }

  get bootstrapComplete(): number {
    return milestone(kMilestoneBootstrapComplete);
  }

  get idleTime(): number {
    return loopIdleTime();
  }

  get uvMetricsInfo(): UVMetrics {
    return uvMetricsInfo();
  }

  override [customInspectSymbol](depth: number, options: InspectOptions): unknown {
    if (depth < 0) return atDepthLimit(this);
    const nested: InspectOptions = {
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };
    return `PerformanceNodeTiming ${inspect(this.toJSON(), nested)}`;
  }

  override toJSON(): PerformanceNodeTimingJSON {
    return {
      name: "node",
      entryType: "node",
      startTime: this.startTime,
      duration: this.duration,
      nodeStart: this.nodeStart,
      v8Start: this.v8Start,
      bootstrapComplete: this.bootstrapComplete,
      environment: this.environment,
      loopStart: this.loopStart,
      loopExit: this.loopExit,
      idleTime: this.idleTime,
    };
  }
}

export const nodeTiming = new PerformanceNodeTiming(kSkipThrow);

/**
 * The milestone names a measure may use in place of a mark, and a mark may not
 * take: node's `nodeTimingReadOnlyAttributes`.
 */
export function isNodeTimingMilestone(name: string): boolean {
  switch (name) {
    case "nodeStart":
    case "v8Start":
    case "environment":
    case "loopStart":
    case "loopExit":
    case "bootstrapComplete":
      return true;
    default:
      return false;
  }
}

/** `nodeTiming[name]` for a name `isNodeTimingMilestone` accepted. */
export function nodeTimingMilestone(name: string): number {
  switch (name) {
    case "nodeStart":
      return nodeTiming.nodeStart;
    case "v8Start":
      return nodeTiming.v8Start;
    case "environment":
      return nodeTiming.environment;
    case "loopStart":
      return nodeTiming.loopStart;
    case "loopExit":
      return nodeTiming.loopExit;
    default:
      return nodeTiming.bootstrapComplete;
  }
}
