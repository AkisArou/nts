// The host config of `react-noop-renderer`: mutation mode. The build forks
// react-reconciler's ReactFiberConfig.ts to this module in that entry.

import { isDevelopment } from "shared/Build.ts";
import { checkPropStringCoercion } from "shared/CheckStringCoercion.ts";
import {
  computeText,
  countHostUpdate,
  shouldSetTextContent,
  type Container,
  type Instance,
  type Props,
  type TextInstance,
} from "./ReactFiberConfigNoop.ts";

export * from "./ReactFiberConfigNoop.ts";
export * from "./ReactFiberConfigNoopNoPersistence.ts";

export type InstanceMeasurement = null;
export type RunningViewTransition = null;
export type ViewTransitionInstance = null | { name: string };
export type GestureTimeline = null;

export const supportsMutation = true;

function isContainer(parent: Container | Instance): parent is Container {
  return typeof (parent as Partial<Container>).rootID === "string";
}

function appendChildToContainerOrInstance(parentInstance: Container | Instance, child: Instance | TextInstance): void {
  const prevParent = child.parent;
  // A container has no id; comparing with `undefined` never matches, as upstream's does.
  const parentId = (parentInstance as Partial<Instance>).id;
  if (prevParent !== -1 && prevParent !== parentId) {
    throw new Error("Reparenting is not allowed");
  }
  child.parent = parentId as number;
  const index = parentInstance.children.indexOf(child);
  if (index !== -1) {
    parentInstance.children.splice(index, 1);
  }
  parentInstance.children.push(child);
}

// Some calls to these are not type safe; the checks surface mistakes in tests.

export function appendChildToContainer(parentInstance: Container, child: Instance | TextInstance): void {
  if (!isContainer(parentInstance)) {
    throw new Error("appendChildToContainer() first argument is not a container.");
  }
  appendChildToContainerOrInstance(parentInstance, child);
}

export function appendChild(parentInstance: Instance, child: Instance | TextInstance): void {
  if (isContainer(parentInstance)) {
    throw new Error("appendChild() first argument is not an instance.");
  }
  appendChildToContainerOrInstance(parentInstance, child);
}

function insertInContainerOrInstanceBefore(
  parentInstance: Container | Instance,
  child: Instance | TextInstance,
  beforeChild: Instance | TextInstance,
): void {
  const index = parentInstance.children.indexOf(child);
  if (index !== -1) {
    parentInstance.children.splice(index, 1);
  }
  const beforeIndex = parentInstance.children.indexOf(beforeChild);
  if (beforeIndex === -1) {
    throw new Error("This child does not exist.");
  }
  parentInstance.children.splice(beforeIndex, 0, child);
}

export function insertInContainerBefore(
  parentInstance: Container,
  child: Instance | TextInstance,
  beforeChild: Instance | TextInstance,
): void {
  if (!isContainer(parentInstance)) {
    throw new Error("insertInContainerBefore() first argument is not a container.");
  }
  insertInContainerOrInstanceBefore(parentInstance, child, beforeChild);
}

export function insertBefore(parentInstance: Instance, child: Instance | TextInstance, beforeChild: Instance | TextInstance): void {
  if (isContainer(parentInstance)) {
    throw new Error("insertBefore() first argument is not an instance.");
  }
  insertInContainerOrInstanceBefore(parentInstance, child, beforeChild);
}

export function clearContainer(container: Container): void {
  container.children.splice(0);
}

function removeChildFromContainerOrInstance(parentInstance: Container | Instance, child: Instance | TextInstance): void {
  const index = parentInstance.children.indexOf(child);
  if (index === -1) {
    throw new Error("This child does not exist.");
  }
  parentInstance.children.splice(index, 1);
}

export function removeChildFromContainer(parentInstance: Container, child: Instance | TextInstance): void {
  if (!isContainer(parentInstance)) {
    throw new Error("removeChildFromContainer() first argument is not a container.");
  }
  removeChildFromContainerOrInstance(parentInstance, child);
}

export function removeChild(parentInstance: Instance, child: Instance | TextInstance): void {
  if (isContainer(parentInstance)) {
    throw new Error("removeChild() first argument is not an instance.");
  }
  removeChildFromContainerOrInstance(parentInstance, child);
}

// Required for enableGestureTransition, which is off in the stable channel.
export function cloneMutableInstance(): never {
  throw new Error("Not yet implemented.");
}

export function cloneMutableTextInstance(): never {
  throw new Error("Not yet implemented.");
}

export function commitMount(): void {}

export function commitUpdate(instance: Instance, type: string, oldProps: Props | null, newProps: Props): void {
  if (oldProps === null) {
    throw new Error("Should have old props");
  }
  countHostUpdate();
  instance.prop = newProps.prop;
  instance.hidden = !!newProps.hidden;
  if (type === "suspensey-thing" && typeof newProps.src === "string") {
    instance.src = newProps.src;
  }
  if (shouldSetTextContent(type, newProps)) {
    if (isDevelopment) {
      checkPropStringCoercion(newProps.children, "children");
    }
    instance.text = computeText((newProps.children as string) + "", instance.context);
  }
}

export function commitTextUpdate(textInstance: TextInstance, _oldText: string, newText: string): void {
  countHostUpdate();
  textInstance.text = computeText(newText, textInstance.context);
}

export function hideInstance(instance: Instance): void {
  instance.hidden = true;
}

export function hideTextInstance(textInstance: TextInstance): void {
  textInstance.hidden = true;
}

export function unhideInstance(instance: Instance, props: Props): void {
  if (!props.hidden) {
    instance.hidden = false;
  }
}

export function unhideTextInstance(textInstance: TextInstance, _text: string): void {
  textInstance.hidden = false;
}

export function resetTextContent(instance: Instance): void {
  instance.text = null;
}

// View transitions: the noop renderer does not animate. It runs the
// callbacks a real transition would, in order.

export function applyViewTransitionName(): void {}

export function restoreViewTransitionName(): void {}

export function cancelViewTransitionName(): void {}

export function cancelRootViewTransitionName(): void {}

export function restoreRootViewTransitionName(): void {}

export function cloneRootViewTransitionContainer(): never {
  throw new Error("Not yet implemented.");
}

export function removeRootViewTransitionClone(): never {
  throw new Error("Not implemented.");
}

export function measureInstance(): InstanceMeasurement {
  return null;
}

export function measureClonedInstance(): InstanceMeasurement {
  return null;
}

export function wasInstanceInViewport(): boolean {
  return true;
}

export function hasInstanceChanged(): boolean {
  return false;
}

export function hasInstanceAffectedParent(): boolean {
  return false;
}

export function startViewTransition(
  _rootContainer: Container,
  _transitionTypes: string[] | null,
  mutationCallback: () => void,
  layoutCallback: () => void,
  _afterMutationCallback: () => void,
  spawnedWorkCallback: () => void,
): RunningViewTransition {
  mutationCallback();
  layoutCallback();
  // No afterMutationCallback: nothing animates.
  spawnedWorkCallback();
  // No passiveCallback: the spawned work schedules a task.
  return null;
}

export function startGestureTransition(
  _rootContainer: Container,
  _timeline: GestureTimeline,
  _rangeStart: number,
  _rangeEnd: number,
  _transitionTypes: string[] | null,
  mutationCallback: () => void,
  animateCallback: () => void,
): RunningViewTransition {
  mutationCallback();
  animateCallback();
  return null;
}

export function stopViewTransition(): void {}

export function addViewTransitionFinishedListener(_transition: RunningViewTransition, callback: () => void): void {
  callback();
}

export function createViewTransitionInstance(): ViewTransitionInstance {
  return null;
}

export function getCurrentGestureOffset(): number {
  return 0;
}
