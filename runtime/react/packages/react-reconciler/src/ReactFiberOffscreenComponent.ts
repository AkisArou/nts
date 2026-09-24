import type { Transition, Wakeable } from "shared/ReactTypes.ts";
import type { SpawnedCachePool } from "./ReactFiberCacheComponent.ts";
import type { Lanes } from "./ReactFiberLane.ts";
import type { RetryQueue } from "./ReactFiberSuspenseComponent.ts";
import type { TracingMarkerInstance } from "./ReactFiberTracingMarkerComponent.ts";

type OffscreenMode = "hidden" | "unstable-defer-without-hiding" | "visible";

export interface LegacyHiddenProps {
  mode?: OffscreenMode | null | undefined;
  children?: unknown;
}

export interface OffscreenProps {
  // Default mode is visible. Kind of a weird default for a component
  // called "Offscreen." Possible alt: <Visibility />?
  mode?: OffscreenMode | null | undefined;
  children?: unknown;
}

// We use the existence of the state object as an indicator that the component
// is hidden.
export interface OffscreenState {
  // TODO: This doesn't do anything, yet. It's always NoLanes. But eventually it
  // will represent the pending work that must be included in the render in
  // order to unhide the component.
  baseLanes: Lanes;
  cachePool: SpawnedCachePool | null;
}

export interface OffscreenQueue {
  transitions: Transition[] | null;
  markerInstances: TracingMarkerInstance[] | null;
  retryQueue: RetryQueue | null;
}

type OffscreenVisibility = number;

export const OffscreenVisible = 0b001;
export const OffscreenPassiveEffectsConnected = 0b010;

export interface OffscreenInstance {
  _visibility: OffscreenVisibility;
  _pendingMarkers: Set<TracingMarkerInstance> | null;
  _transitions: Set<Transition> | null;
  _retryCache: WeakSet<Wakeable> | Set<Wakeable> | null;
}
