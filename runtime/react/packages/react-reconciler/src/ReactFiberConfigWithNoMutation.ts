// Renderers that don't support mutation
// can re-export everything from this module.

// Signatures over the renderer's own types: this module is re-exported by a
// renderer's config, which the build forks in for ReactFiberConfig.ts.
import type { ActivityInstance, Container, Instance, Props, SuspenseInstance, TextInstance, Type } from "react-reconciler/ReactFiberConfig.ts";

function shim(..._args: unknown[]): never {
  throw new Error(
    "The current renderer does not support mutation. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export type GestureTimeline = unknown;
export const supportsMutation: boolean = false;
export const cloneMutableInstance: (instance: Instance, keepChildren: boolean) => Instance = shim;
export const cloneMutableTextInstance: (textInstance: TextInstance) => TextInstance = shim;
export const appendChild: (parentInstance: Instance, child: Instance | TextInstance) => void = shim;
export const appendChildToContainer: (container: Container, child: Instance | TextInstance) => void = shim;
export const commitTextUpdate: (textInstance: TextInstance, oldText: string, newText: string) => void = shim;
export const commitMount: (instance: Instance, type: Type, newProps: Props, internalInstanceHandle: object) => void = shim;
export const commitUpdate: (instance: Instance, type: Type, oldProps: Props, newProps: Props, internalInstanceHandle: object) => void = shim;
export const insertBefore: (parentInstance: Instance, child: Instance | TextInstance, beforeChild: Instance | TextInstance | SuspenseInstance | ActivityInstance) => void = shim;
export const insertInContainerBefore: (container: Container, child: Instance | TextInstance, beforeChild: Instance | TextInstance | SuspenseInstance | ActivityInstance) => void = shim;
export const removeChild: (parentInstance: Instance, child: Instance | TextInstance | SuspenseInstance | ActivityInstance) => void = shim;
export const removeChildFromContainer: (container: Container, child: Instance | TextInstance | SuspenseInstance | ActivityInstance) => void = shim;
export const resetTextContent: (instance: Instance) => void = shim;
export const hideInstance: (instance: Instance) => void = shim;
export const hideTextInstance: (textInstance: TextInstance) => void = shim;
export const unhideInstance: (instance: Instance, props: Props) => void = shim;
export const unhideTextInstance: (textInstance: TextInstance, text: string) => void = shim;
export const clearContainer: (container: Container) => void = shim;
export const getCurrentGestureOffset: (provider: GestureTimeline) => number = shim;
