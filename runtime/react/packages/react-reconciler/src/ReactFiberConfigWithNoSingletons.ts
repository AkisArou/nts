// Renderers that don't support singletons
// can re-export everything from this module.

// Signatures over the renderer's own types: this module is re-exported by a
// renderer's config, which the build forks in for ReactFiberConfig.ts.
import type { Container, HostContext, Instance, Props, Type } from "react-reconciler/ReactFiberConfig.ts";

function notSupported(): Error {
  return new Error(
    "The current renderer does not support Singletons. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export const supportsSingletons: boolean = false;
export function resolveSingletonInstance(_type: Type, _props: Props, _rootContainerInstance: Container, _hostContext: HostContext, _validateDOMNestingDev: boolean): Instance {
  throw notSupported();
}
export function acquireSingletonInstance(_type: Type, _props: Props, _instance: Instance, _internalInstanceHandle: object): void {
  throw notSupported();
}
export function releaseSingletonInstance(_instance: Instance): void {
  throw notSupported();
}
export function isHostSingletonType(_type: Type): boolean {
  throw notSupported();
}
export function isSingletonScope(_type: Type): boolean {
  throw notSupported();
}
