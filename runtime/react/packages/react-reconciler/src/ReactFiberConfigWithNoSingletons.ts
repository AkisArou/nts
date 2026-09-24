// Renderers that don't support singletons
// can re-export everything from this module.

// Signatures over the renderer's own types: this module is re-exported by a
// renderer's config, which the build forks in for ReactFiberConfig.ts.
import type { Container, HostContext, Instance, Props, Type } from "react-reconciler/ReactFiberConfig.ts";

function shim(..._args: unknown[]): never {
  throw new Error(
    "The current renderer does not support Singletons. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export const supportsSingletons: boolean = false;
export const resolveSingletonInstance: (type: Type, props: Props, rootContainerInstance: Container, hostContext: HostContext, validateDOMNestingDev: boolean) => Instance = shim;
export const acquireSingletonInstance: (type: Type, props: Props, instance: Instance, internalInstanceHandle: object) => void = shim;
export const releaseSingletonInstance: (instance: Instance) => void = shim;
export const isHostSingletonType: (type: Type) => boolean = shim;
export const isSingletonScope: (type: Type) => boolean = shim;
