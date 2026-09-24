// Renderers that don't support persistence
// can re-export everything from this module.

// Signatures over the renderer's own types: this module is re-exported by a
// renderer's config, which the build forks in for ReactFiberConfig.ts.
import type { ChildSet, Container, Instance, Props, TextInstance, Type } from "react-reconciler/ReactFiberConfig.ts";

function notSupported(): Error {
  return new Error(
    "The current renderer does not support persistence. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export const supportsPersistence: boolean = false;
export function cloneInstance(_instance: Instance, _type: Type, _oldProps: Props, _newProps: Props, _keepChildren: boolean, _newChildSet: ChildSet | null | undefined): Instance {
  throw notSupported();
}
export function createContainerChildSet(): ChildSet {
  throw notSupported();
}
export function appendChildToContainerChildSet(_childSet: ChildSet, _child: Instance | TextInstance): void {
  throw notSupported();
}
export function finalizeContainerChildren(_container: Container, _newChildren: ChildSet): void {
  throw notSupported();
}
export function replaceContainerChildren(_container: Container, _newChildren: ChildSet): void {
  throw notSupported();
}
export function cloneHiddenInstance(_instance: Instance, _type: Type, _props: Props): Instance {
  throw notSupported();
}
export function cloneHiddenTextInstance(_instance: TextInstance, _text: string): TextInstance {
  throw notSupported();
}
