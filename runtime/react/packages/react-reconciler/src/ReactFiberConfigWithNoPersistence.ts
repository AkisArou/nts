// Renderers that don't support persistence
// can re-export everything from this module.

// Signatures over the renderer's own types: this module is re-exported by a
// renderer's config, which the build forks in for ReactFiberConfig.ts.
import type { ChildSet, Container, Instance, Props, TextInstance, Type } from "react-reconciler/ReactFiberConfig.ts";

function shim(..._args: unknown[]): never {
  throw new Error(
    "The current renderer does not support persistence. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export const supportsPersistence: boolean = false;
export const cloneInstance: (instance: Instance, type: Type, oldProps: Props, newProps: Props, keepChildren: boolean, newChildSet: ChildSet | null | undefined) => Instance = shim;
export const createContainerChildSet: () => ChildSet = shim;
export const appendChildToContainerChildSet: (childSet: ChildSet, child: Instance | TextInstance) => void = shim;
export const finalizeContainerChildren: (container: Container, newChildren: ChildSet) => void = shim;
export const replaceContainerChildren: (container: Container, newChildren: ChildSet) => void = shim;
export const cloneHiddenInstance: (instance: Instance, type: Type, props: Props) => Instance = shim;
export const cloneHiddenTextInstance: (instance: TextInstance, text: string) => TextInstance = shim;
