// Renderers that don't support resources
// can re-export everything from this module.

// Signatures over the renderer's own types: this module is re-exported by a
// renderer's config, which the build forks in for ReactFiberConfig.ts.
import type { Container, HostContext, Instance, Props, SuspendedState, Type } from "react-reconciler/ReactFiberConfig.ts";

function notSupported(): Error {
  return new Error(
    "The current renderer does not support Resources. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export type HoistableRoot = unknown;
export type Resource = unknown;
export const supportsResources: boolean = false;
export function isHostHoistableType(_type: Type, _props: Props, _hostContext: HostContext): boolean {
  throw notSupported();
}
export function getHoistableRoot(_container: Container): HoistableRoot {
  throw notSupported();
}
export function getResource(_type: Type, _currentProps: Props | null, _pendingProps: Props, _currentResource: Resource | null): Resource | null {
  throw notSupported();
}
export function acquireResource(_hoistableRoot: HoistableRoot, _resource: Resource, _props: Props): Instance {
  throw notSupported();
}
export function releaseResource(_resource: Resource): void {
  throw notSupported();
}
export function hydrateHoistable(_hoistableRoot: HoistableRoot, _type: Type, _props: Props, _internalInstanceHandle: object): Instance {
  throw notSupported();
}
export function mountHoistable(_hoistableRoot: HoistableRoot, _type: Type, _instance: Instance): void {
  throw notSupported();
}
export function unmountHoistable(_instance: Instance): void {
  throw notSupported();
}
export function createHoistableInstance(_type: Type, _props: Props, _rootContainerInstance: Container, _internalInstanceHandle: object): Instance {
  throw notSupported();
}
export function prepareToCommitHoistables(): void {
  throw notSupported();
}
export function mayResourceSuspendCommit(_resource: Resource): boolean {
  throw notSupported();
}
export function preloadResource(_resource: Resource): boolean {
  throw notSupported();
}
export function suspendResource(_state: SuspendedState, _hoistableRoot: HoistableRoot, _resource: Resource, _props: Props): void {
  throw notSupported();
}
