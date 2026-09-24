// Renderers that don't support resources
// can re-export everything from this module.

// Signatures over the renderer's own types: this module is re-exported by a
// renderer's config, which the build forks in for ReactFiberConfig.ts.
import type { Container, HostContext, Instance, Props, SuspendedState, Type } from "react-reconciler/ReactFiberConfig.ts";

function shim(..._args: unknown[]): never {
  throw new Error(
    "The current renderer does not support Resources. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export type HoistableRoot = unknown;
export type Resource = unknown;
export const supportsResources: boolean = false;
export const isHostHoistableType: (type: Type, props: Props, hostContext: HostContext) => boolean = shim;
export const getHoistableRoot: (container: Container) => HoistableRoot = shim;
export const getResource: (type: Type, currentProps: Props | null, pendingProps: Props, currentResource: Resource | null) => Resource | null = shim;
export const acquireResource: (hoistableRoot: HoistableRoot, resource: Resource, props: Props) => Instance = shim;
export const releaseResource: (resource: Resource) => void = shim;
export const hydrateHoistable: (hoistableRoot: HoistableRoot, type: Type, props: Props, internalInstanceHandle: object) => Instance = shim;
export const mountHoistable: (hoistableRoot: HoistableRoot, type: Type, instance: Instance) => void = shim;
export const unmountHoistable: (instance: Instance) => void = shim;
export const createHoistableInstance: (type: Type, props: Props, rootContainerInstance: Container, internalInstanceHandle: object) => Instance = shim;
export const prepareToCommitHoistables: () => void = shim;
export const mayResourceSuspendCommit: (resource: Resource) => boolean = shim;
export const preloadResource: (resource: Resource) => boolean = shim;
export const suspendResource: (state: SuspendedState, hoistableRoot: HoistableRoot, resource: Resource, props: Props) => void = shim;
