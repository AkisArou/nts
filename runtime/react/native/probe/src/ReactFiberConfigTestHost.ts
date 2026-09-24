// A small, fully typed mutation host for native tests: host nodes are
// classes, and the tree serialises itself to a string that the probe
// compares with node's. It supplies every name of the reconciler's
// ReactFiberConfig.ts contract; the parts it does not support come from the
// reconciler's `WithNo*` modules.

export * from "react-reconciler/ReactFiberConfigWithNoHydration.ts";
export * from "react-reconciler/ReactFiberConfigWithNoMicrotasks.ts";
export * from "react-reconciler/ReactFiberConfigWithNoPersistence.ts";
export * from "react-reconciler/ReactFiberConfigWithNoResources.ts";
export * from "react-reconciler/ReactFiberConfigWithNoScopes.ts";
export * from "react-reconciler/ReactFiberConfigWithNoSingletons.ts";
export * from "react-reconciler/ReactFiberConfigWithNoTestSelectors.ts";
export * from "react-reconciler/ReactFiberConfigWithNoViewTransition.ts";

import { createContext } from "react";
import type { ReactContext } from "shared/ReactTypes.ts";

export type Type = string;
export type Props = { [key: string]: unknown };

// A node of the host tree: an element or a text.
export abstract class TestNode {
  hidden = false;
  abstract serialize(): string;
}

export class TestText extends TestNode {
  text: string;
  constructor(text: string) {
    super();
    this.text = text;
  }
  serialize(): string {
    return this.hidden ? "" : this.text;
  }
}

export class TestInstance extends TestNode {
  readonly type: string;
  props: Props;
  readonly children: TestNode[] = [];
  constructor(type: string, props: Props) {
    super();
    this.type = type;
    this.props = props;
  }
  serialize(): string {
    if (this.hidden) {
      return "";
    }
    let out = "<" + this.type;
    const label = this.props["label"];
    if (typeof label === "string") {
      out += " label=" + label;
    }
    out += ">";
    for (const child of this.children) {
      out += child.serialize();
    }
    return out + "</" + this.type + ">";
  }
}

export class TestContainer {
  readonly children: TestNode[] = [];
  serialize(): string {
    let out = "";
    for (const child of this.children) {
      out += child.serialize();
    }
    return out;
  }
}

export type Instance = TestInstance;
export type TextInstance = TestText;
export type Container = TestContainer;
export type PublicInstance = TestInstance | TestText;
export type HostContext = number;
// Hydration and persistence are not supported; their instances never exist.
export type ActivityInstance = unknown;
export type SuspenseInstance = unknown;
export type HydratableInstance = unknown;
export type ChildSet = unknown;
export type UpdatePayload = null;
export type TimeoutHandle = number;
export type NoTimeout = number;
export type RendererInspectionConfig = null;
export type TransitionStatus = null;
// Features this host does not support: their values never exist.
export type FormInstance = unknown;
export type SuspendedState = unknown;
export type FragmentInstanceType = unknown;

export const rendererVersion = "19.3.0";
export const rendererPackageName = "react-nts-test-host";
export const extraDevToolsConfig = null;
export const isPrimaryRenderer = true;
export const warnsIfNotActing = false;
export const supportsMutation = true;
export const noTimeout: NoTimeout = -1;
export const NotPendingTransition: TransitionStatus = null;
// The context `useFormStatus`-style hooks read the host transition from.
export const HostTransitionContext: ReactContext<TransitionStatus> = createContext<TransitionStatus>(NotPendingTransition);

// Update priorities, as the host tracks them for events.
const NoEventPriority = 0;
const DefaultEventPriority = 32;
let currentUpdatePriority = NoEventPriority;

export function setCurrentUpdatePriority(newPriority: number): void {
  currentUpdatePriority = newPriority;
}
export function getCurrentUpdatePriority(): number {
  return currentUpdatePriority;
}
export function resolveUpdatePriority(): number {
  return currentUpdatePriority !== NoEventPriority ? currentUpdatePriority : DefaultEventPriority;
}
export function trackSchedulerEvent(): void {}
export function resolveEventType(): string | null {
  return null;
}
export function resolveEventTimeStamp(): number {
  return -1;
}
export function shouldAttemptEagerTransition(): boolean {
  return false;
}

export function getRootHostContext(_rootContainer: TestContainer): HostContext {
  return 0;
}
export function getChildHostContext(parentHostContext: HostContext, _type: string): HostContext {
  return parentHostContext;
}
export function getPublicInstance(instance: TestInstance | TestText): PublicInstance {
  return instance;
}
export function prepareForCommit(_containerInfo: TestContainer): object | null {
  return null;
}
export function resetAfterCommit(_containerInfo: TestContainer): void {}

export function shouldSetTextContent(_type: string, props: Props): boolean {
  const children = props["children"];
  return typeof children === "string" || typeof children === "number";
}

export function createInstance(type: string, props: Props, _root: TestContainer, _hostContext: HostContext, _handle: object): TestInstance {
  const instance = new TestInstance(type, props);
  const children = props["children"];
  if (typeof children === "string" || typeof children === "number") {
    instance.children.push(new TestText("" + children));
  }
  return instance;
}

export function createTextInstance(text: string, _root: TestContainer, _hostContext: HostContext, _handle: object): TestText {
  return new TestText(text);
}

export function appendInitialChild(parentInstance: TestInstance, child: TestNode): void {
  parentInstance.children.push(child);
}

export function finalizeInitialChildren(_instance: TestInstance, _type: string, _props: Props, _hostContext: HostContext): boolean {
  return false;
}

export function cloneMutableInstance(instance: TestInstance, _keepChildren: boolean): TestInstance {
  return instance;
}
export function cloneMutableTextInstance(textInstance: TestText): TestText {
  return textInstance;
}

function removeFrom(children: TestNode[], child: TestNode): void {
  const index = children.indexOf(child);
  if (index !== -1) {
    children.splice(index, 1);
  }
}

function insertInto(children: TestNode[], child: TestNode, beforeChild: TestNode): void {
  removeFrom(children, child);
  const beforeIndex = children.indexOf(beforeChild);
  if (beforeIndex === -1) {
    throw new Error("This child does not exist.");
  }
  // Shift the tail up by one and place the child.
  children.push(child);
  for (let i = children.length - 1; i > beforeIndex; i--) {
    children[i] = children[i - 1]!;
  }
  children[beforeIndex] = child;
}

export function appendChild(parentInstance: TestInstance, child: TestNode): void {
  removeFrom(parentInstance.children, child);
  parentInstance.children.push(child);
}
export function appendChildToContainer(container: TestContainer, child: TestNode): void {
  removeFrom(container.children, child);
  container.children.push(child);
}
export function insertBefore(parentInstance: TestInstance, child: TestNode, beforeChild: TestNode): void {
  insertInto(parentInstance.children, child, beforeChild);
}
export function insertInContainerBefore(container: TestContainer, child: TestNode, beforeChild: TestNode): void {
  insertInto(container.children, child, beforeChild);
}
export function removeChild(parentInstance: TestInstance, child: TestNode): void {
  removeFrom(parentInstance.children, child);
}
export function removeChildFromContainer(container: TestContainer, child: TestNode): void {
  removeFrom(container.children, child);
}
export function clearContainer(container: TestContainer): void {
  container.children.length = 0;
}

export function commitTextUpdate(textInstance: TestText, _oldText: string, newText: string): void {
  textInstance.text = newText;
}
export function commitMount(_instance: TestInstance, _type: string, _newProps: Props, _handle: object): void {}
export function commitUpdate(instance: TestInstance, _type: string, _oldProps: Props, newProps: Props, _handle: object): void {
  instance.props = newProps;
  const children = newProps["children"];
  if (typeof children === "string" || typeof children === "number") {
    instance.children.length = 0;
    instance.children.push(new TestText("" + children));
  }
}
export function resetTextContent(instance: TestInstance): void {
  instance.children.length = 0;
}

export function hideInstance(instance: TestInstance): void {
  instance.hidden = true;
}
export function hideTextInstance(textInstance: TestText): void {
  textInstance.hidden = true;
}
export function unhideInstance(instance: TestInstance, _props: Props): void {
  instance.hidden = false;
}
export function unhideTextInstance(textInstance: TestText, _text: string): void {
  textInstance.hidden = false;
}

export function detachDeletedInstance(_node: TestInstance): void {}
export function getInstanceFromNode(_node: unknown): TestInstance | null {
  return null;
}
export function beforeActiveInstanceBlur(_handle: object): void {}
export function afterActiveInstanceBlur(): void {}
export function preparePortalMount(_portalInstance: TestContainer): void {}
export function requestPostPaintCallback(_callback: (time: number) => void): void {}

// Commits never suspend on host resources here.
export function maySuspendCommit(_type: string, _props: Props): boolean {
  return false;
}
export function maySuspendCommitOnUpdate(_type: string, _oldProps: Props, _newProps: Props): boolean {
  return false;
}
export function maySuspendCommitInSyncRender(_type: string, _props: Props): boolean {
  return false;
}
export function preloadInstance(_instance: TestInstance, _type: string, _props: Props): boolean {
  return true;
}
export function startSuspendingCommit(): SuspendedState {
  return null;
}
export function suspendInstance(_state: SuspendedState, _instance: TestInstance, _type: string, _props: Props): void {}
export function suspendOnActiveViewTransition(_state: SuspendedState, _container: TestContainer): void {}
export function waitForCommitToBeReady(
  _state: SuspendedState,
  _timeoutOffset: number,
): ((initiateCommit: () => void) => () => void) | null {
  return null;
}
export function getSuspendedCommitReason(_state: SuspendedState, _rootContainer: TestContainer): string | null {
  return null;
}
export function resetFormInstance(_form: FormInstance): void {}
export function bindToConsole(_methodName: string, _args: unknown[], _badgeName: string): () => void {
  return () => {};
}

let nextTimeoutId = 1;
export function scheduleTimeout(_fn: () => void, _delay?: number): TimeoutHandle {
  // Timeouts (for suspended commits and retries) are not used by the probe's
  // scenarios; the reconciler only needs a handle.
  return nextTimeoutId++;
}
export function cancelTimeout(_id: TimeoutHandle): void {}

export function createFragmentInstance(_fragmentFiber: unknown): FragmentInstanceType {
  return null;
}
export function updateFragmentInstanceFiber(_fragmentFiber: unknown, _instance: FragmentInstanceType): void {}
export function commitNewChildToFragmentInstance(_child: TestNode, _fragmentInstance: FragmentInstanceType): void {}
export function deleteChildFromFragmentInstance(_child: TestNode, _fragmentInstance: FragmentInstanceType): void {}
