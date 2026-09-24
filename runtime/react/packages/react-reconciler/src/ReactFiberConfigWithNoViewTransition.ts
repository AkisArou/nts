// Renderers that don't support view transitions
// can re-export everything from this module.

// Signatures over the renderer's own types: this module is re-exported by a
// renderer's config, which the build forks in for ReactFiberConfig.ts.
import type { Container, Instance, Props } from "react-reconciler/ReactFiberConfig.ts";

function shim(..._args: unknown[]): never {
  throw new Error(
    "The current renderer does not support view transitions. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export type InstanceMeasurement = unknown;
export type RunningViewTransition = unknown;
export type ViewTransitionInstance = null | { name: string };
export const applyViewTransitionName: (instance: Instance, name: string, className: string | null) => void = shim;
export const restoreViewTransitionName: (instance: Instance, props: Props) => void = shim;
export const cancelViewTransitionName: (instance: Instance, name: string, props: Props) => void = shim;
export const cancelRootViewTransitionName: (rootContainer: Container) => void = shim;
export const restoreRootViewTransitionName: (rootContainer: Container) => void = shim;
export const cloneRootViewTransitionContainer: (rootContainer: Container) => Instance = shim;
export const removeRootViewTransitionClone: (rootContainer: Container, clone: Instance) => void = shim;
export const measureInstance: (instance: Instance) => InstanceMeasurement = shim;
export const measureClonedInstance: (instance: Instance) => InstanceMeasurement = shim;
export const wasInstanceInViewport: (measurement: InstanceMeasurement) => boolean = shim;
export const hasInstanceChanged: (oldMeasurement: InstanceMeasurement, newMeasurement: InstanceMeasurement) => boolean = shim;
export const hasInstanceAffectedParent: (oldMeasurement: InstanceMeasurement, newMeasurement: InstanceMeasurement) => boolean = shim;
export const startViewTransition: (rootContainer: Container, transitionTypes: string[] | null, mutationCallback: () => void, layoutCallback: () => void, afterMutationCallback: () => void, spawnedWorkCallback: () => void, passiveCallback: () => unknown, errorCallback: (error: unknown) => void, blockedCallback: (name: string) => void, finishedAnimation: () => void) => RunningViewTransition | null = shim;
export const startGestureTransition: (...args: unknown[]) => RunningViewTransition | null = shim;
export const stopViewTransition: (transition: RunningViewTransition) => void = shim;
export const addViewTransitionFinishedListener: (transition: RunningViewTransition, callback: () => void) => void = shim;
export const createViewTransitionInstance: (name: string) => ViewTransitionInstance = shim;
