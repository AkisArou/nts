// Renderers that don't support mutation
// can re-export everything from this module.

// Signatures over the renderer's own types: this module is re-exported by a
// renderer's config, which the build forks in for ReactFiberConfig.ts.
import type { ActivityInstance, Container, Instance, Props, SuspenseInstance, TextInstance, Type } from "react-reconciler/ReactFiberConfig.ts";

function notSupported(): Error {
  return new Error(
    "The current renderer does not support mutation. " +
      "This error is likely caused by a bug in React. " +
      "Please file an issue.",
  );
}

export type GestureTimeline = unknown;
export const supportsMutation: boolean = false;
export function cloneMutableInstance(_instance: Instance, _keepChildren: boolean): Instance {
  throw notSupported();
}
export function cloneMutableTextInstance(_textInstance: TextInstance): TextInstance {
  throw notSupported();
}
export function appendChild(_parentInstance: Instance, _child: Instance | TextInstance): void {
  throw notSupported();
}
export function appendChildToContainer(_container: Container, _child: Instance | TextInstance): void {
  throw notSupported();
}
export function commitTextUpdate(_textInstance: TextInstance, _oldText: string, _newText: string): void {
  throw notSupported();
}
export function commitMount(_instance: Instance, _type: Type, _newProps: Props, _internalInstanceHandle: object): void {
  throw notSupported();
}
export function commitUpdate(_instance: Instance, _type: Type, _oldProps: Props, _newProps: Props, _internalInstanceHandle: object): void {
  throw notSupported();
}
export function insertBefore(_parentInstance: Instance, _child: Instance | TextInstance, _beforeChild: Instance | TextInstance | SuspenseInstance | ActivityInstance): void {
  throw notSupported();
}
export function insertInContainerBefore(_container: Container, _child: Instance | TextInstance, _beforeChild: Instance | TextInstance | SuspenseInstance | ActivityInstance): void {
  throw notSupported();
}
export function removeChild(_parentInstance: Instance, _child: Instance | TextInstance | SuspenseInstance | ActivityInstance): void {
  throw notSupported();
}
export function removeChildFromContainer(_container: Container, _child: Instance | TextInstance | SuspenseInstance | ActivityInstance): void {
  throw notSupported();
}
export function resetTextContent(_instance: Instance): void {
  throw notSupported();
}
export function hideInstance(_instance: Instance): void {
  throw notSupported();
}
export function hideTextInstance(_textInstance: TextInstance): void {
  throw notSupported();
}
export function unhideInstance(_instance: Instance, _props: Props): void {
  throw notSupported();
}
export function unhideTextInstance(_textInstance: TextInstance, _text: string): void {
  throw notSupported();
}
export function clearContainer(_container: Container): void {
  throw notSupported();
}
export function getCurrentGestureOffset(_provider: GestureTimeline): number {
  throw notSupported();
}
