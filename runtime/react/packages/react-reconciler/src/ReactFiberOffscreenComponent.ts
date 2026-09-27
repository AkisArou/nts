import type { Transition, Wakeable } from "shared/ReactTypes.ts";
import type { SpawnedCachePool } from "./ReactFiberCacheComponent.ts";
import type { Lanes } from "./ReactFiberLane.ts";
import type { RetryQueue } from "./ReactFiberSuspenseComponent.ts";
import type { TracingMarkerInstance } from "./ReactFiberTracingMarkerComponent.ts";
import { propOf } from "./ReactFiberProps.ts";

type OffscreenMode = "hidden" | "unstable-defer-without-hiding" | "visible";

export interface LegacyHiddenProps {
  mode?: OffscreenMode | null | undefined;
  children?: unknown;
}

// A LegacyHiddenProps field of the record, its key checked against the interface.
function legacyHiddenField(props: unknown, key: keyof LegacyHiddenProps): unknown {
  return propOf(props, key);
}

/** The LegacyHiddenProps a fiber holds as a record, read into its declared shape (ReactFiberProps.ts). */
export function legacyHiddenPropsOf(props: unknown): LegacyHiddenProps {
  return {
    mode: legacyHiddenField(props, "mode") as LegacyHiddenProps["mode"],
    children: legacyHiddenField(props, "children") as LegacyHiddenProps["children"],
  };
}

export interface OffscreenProps {
  // Default mode is visible. Kind of a weird default for a component
  // called "Offscreen." Possible alt: <Visibility />?
  mode?: OffscreenMode | null | undefined;
  children?: unknown;
}

// A OffscreenProps field of the record, its key checked against the interface.
function offscreenField(props: unknown, key: keyof OffscreenProps): unknown {
  return propOf(props, key);
}

/** The OffscreenProps a fiber holds as a record, read into its declared shape (ReactFiberProps.ts). */
export function offscreenPropsOf(props: unknown): OffscreenProps {
  return {
    mode: offscreenField(props, "mode") as OffscreenProps["mode"],
    children: offscreenField(props, "children") as OffscreenProps["children"],
  };
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
  // A Set rather than upstream's WeakSet-when-available: a union of the two
  // has no fixed layout. Retried wakeables are held until the boundary
  // unmounts instead of until they are collected.
  _retryCache: Set<Wakeable> | null;
}
