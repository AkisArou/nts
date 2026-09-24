// The host config of `react-noop-renderer/persistent`: persistent mode, where
// host instances are immutable and every update clones. The build forks
// react-reconciler's ReactFiberConfig.ts to this module in that entry.

import { isDevelopment } from "shared/Build.ts";
import { checkPropStringCoercion } from "shared/CheckStringCoercion.ts";
import {
  computeText,
  countHostClone,
  hideFields,
  shouldSetTextContent,
  type ChildSet,
  type Container,
  type Instance,
  type Props,
  type TextInstance,
} from "./ReactFiberConfigNoop.ts";

export * from "./ReactFiberConfigNoop.ts";
export * from "./ReactFiberConfigNoopNoMutation.ts";

export type InstanceMeasurement = null;
export type RunningViewTransition = null;
export type ViewTransitionInstance = null | { name: string };
export type GestureTimeline = null;

export const supportsPersistence = true;

export function cloneInstance(
  instance: Instance,
  type: string,
  _oldProps: Props,
  newProps: Props,
  keepChildren: boolean,
  children: ChildSet | null,
): Instance {
  if (isDevelopment) {
    checkPropStringCoercion(newProps.children, "children");
  }
  const clone: Instance = {
    id: instance.id,
    type,
    parent: instance.parent,
    children: keepChildren ? instance.children : (children ?? []),
    text: shouldSetTextContent(type, newProps) ? computeText((newProps.children as string) + "", instance.context) : null,
    prop: newProps.prop,
    hidden: !!newProps.hidden,
    context: instance.context,
  };
  if (type === "suspensey-thing" && typeof newProps.src === "string") {
    clone.src = newProps.src;
  }
  hideFields(clone, ["id", "parent", "text", "context"]);
  countHostClone();
  return clone;
}

export function createContainerChildSet(): ChildSet {
  return [];
}

export function appendChildToContainerChildSet(childSet: ChildSet, child: Instance | TextInstance): void {
  childSet.push(child);
}

export function finalizeContainerChildren(container: Container, newChildren: ChildSet): void {
  container.pendingChildren = newChildren;
  const onlyChild = newChildren.length === 1 ? newChildren[0] : undefined;
  if (onlyChild !== undefined && onlyChild.text === "Error when completing root") {
    // Triggers an error for testing purposes.
    throw Error("Error when completing root");
  }
}

export function replaceContainerChildren(container: Container, newChildren: ChildSet): void {
  container.children = newChildren;
}

export function cloneHiddenInstance(instance: Instance, type: string, props: Props): Instance {
  const clone = cloneInstance(instance, type, props, props, true, null);
  clone.hidden = true;
  return clone;
}

export function cloneHiddenTextInstance(instance: TextInstance, _text: string): TextInstance {
  const clone: TextInstance = {
    text: instance.text,
    id: instance.id,
    parent: instance.parent,
    hidden: true,
    context: instance.context,
  };
  hideFields(clone, ["id", "parent", "context"]);
  return clone;
}
