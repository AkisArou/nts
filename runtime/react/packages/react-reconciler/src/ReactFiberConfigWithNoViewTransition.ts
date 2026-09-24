// Renderers that don't support view transitions
// can re-export everything from this module.

// Signatures over the renderer's own types: this module is re-exported by a
// renderer's config, which the build forks in for ReactFiberConfig.ts.
import type { Container, Instance, Props } from "react-reconciler/ReactFiberConfig.ts";

function notSupported(): Error {
  return new Error(
    "The current renderer does not support view transitions. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export type InstanceMeasurement = unknown;
export type RunningViewTransition = unknown;
export type ViewTransitionInstance = null | { name: string };
export function applyViewTransitionName(_instance: Instance, _name: string, _className: string | null): void {
  throw notSupported();
}
export function restoreViewTransitionName(_instance: Instance, _props: Props): void {
  throw notSupported();
}
export function cancelViewTransitionName(_instance: Instance, _name: string, _props: Props): void {
  throw notSupported();
}
export function cancelRootViewTransitionName(_rootContainer: Container): void {
  throw notSupported();
}
export function restoreRootViewTransitionName(_rootContainer: Container): void {
  throw notSupported();
}
export function cloneRootViewTransitionContainer(_rootContainer: Container): Instance {
  throw notSupported();
}
export function removeRootViewTransitionClone(_rootContainer: Container, _clone: Instance): void {
  throw notSupported();
}
export function measureInstance(_instance: Instance): InstanceMeasurement {
  throw notSupported();
}
export function measureClonedInstance(_instance: Instance): InstanceMeasurement {
  throw notSupported();
}
export function wasInstanceInViewport(_measurement: InstanceMeasurement): boolean {
  throw notSupported();
}
export function hasInstanceChanged(_oldMeasurement: InstanceMeasurement, _newMeasurement: InstanceMeasurement): boolean {
  throw notSupported();
}
export function hasInstanceAffectedParent(_oldMeasurement: InstanceMeasurement, _newMeasurement: InstanceMeasurement): boolean {
  throw notSupported();
}
export function startViewTransition(_rootContainer: Container, _transitionTypes: string[] | null, _mutationCallback: () => void, _layoutCallback: () => void, _afterMutationCallback: () => void, _spawnedWorkCallback: () => void, _passiveCallback: () => unknown, _errorCallback: (error: unknown) => void, _blockedCallback: (name: string) => void, _finishedAnimation: () => void): RunningViewTransition | null {
  throw notSupported();
}
export function startGestureTransition(..._args: unknown[]): RunningViewTransition | null {
  throw notSupported();
}
export function stopViewTransition(_transition: RunningViewTransition): void {
  throw notSupported();
}
export function addViewTransitionFinishedListener(_transition: RunningViewTransition, _callback: () => void): void {
  throw notSupported();
}
export function createViewTransitionInstance(_name: string): ViewTransitionInstance {
  throw notSupported();
}
