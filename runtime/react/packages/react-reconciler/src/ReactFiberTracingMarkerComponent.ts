// Transition tracing (`<TracingMarker>`, `onTransitionStart` and friends).
// enableTransitionTracing is off in the stable channel, so every entry point
// here is the disabled branch: the types and exports stay so the callers
// keep upstream's shape.

import type { Transition } from "shared/ReactTypes.ts";
import { enableTransitionTracing } from "shared/ReactFeatureFlags.ts";
import type { OffscreenInstance } from "./ReactFiberOffscreenComponent.ts";
import type { Fiber } from "./ReactInternalTypes.ts";

export interface SuspenseInfo {
  name: string | null;
}

export interface PendingTransitionCallbacks {
  transitionStart: Transition[] | null;
  transitionProgress: Map<Transition, PendingBoundaries> | null;
  transitionComplete: Transition[] | null;
  markerProgress: Map<string, { pendingBoundaries: PendingBoundaries; transitions: Set<Transition> }> | null;
  markerIncomplete: Map<string, { aborts: TransitionAbort[]; transitions: Set<Transition> }> | null;
  markerComplete: Map<string, Set<Transition>> | null;
}

// TODO: Is there a way to not include the tag or name here?
export interface TracingMarkerInstance {
  tag?: TracingMarkerTag;
  transitions: Set<Transition> | null;
  pendingBoundaries: PendingBoundaries | null;
  aborts: TransitionAbort[] | null;
  name: string | null;
}

export interface TransitionAbort {
  reason: "error" | "unknown" | "marker" | "suspense";
  name?: string | null;
}

export const TransitionRoot = 0;
export const TransitionTracingMarker = 1;
export type TracingMarkerTag = 0 | 1;

export type PendingBoundaries = Map<OffscreenInstance, SuspenseInfo>;

export interface TracingMarkerProps {
  name: string;
  children?: unknown;
}

// enableTransitionTracing is off: there are no callbacks to call.
export function processTransitionCallbacks(
  _pendingTransitions: PendingTransitionCallbacks,
  _endTime: number,
  _callbacks: unknown,
): void {
  if (enableTransitionTracing) {
    throw new Error("Transition tracing is not supported in this build.");
  }
}

// The marker instance stack is only maintained when enableTransitionTracing
// is on; with it off, push and pop do nothing and the stack reads empty.
export function pushRootMarkerInstance(_workInProgress: Fiber): void {}

export function popRootMarkerInstance(_workInProgress: Fiber): void {}

export function pushMarkerInstance(_workInProgress: Fiber, _markerInstance: TracingMarkerInstance): void {}

export function popMarkerInstance(_workInProgress: Fiber): void {}

export function getMarkerInstances(): TracingMarkerInstance[] | null {
  return null;
}
