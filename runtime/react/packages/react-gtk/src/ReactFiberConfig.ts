// react-gtk: React's host config for GTK 4 (see ../DESIGN.md). A native GTK
// program binds this module for `react-reconciler/ReactFiberConfig.ts`.
//
// A host node is a class per kind of widget (src/widgets.ts, generated from
// GIR): it holds the widget and what React needs beside it, the handlers its
// signal props hold. GTK sees the widget; React sees the node. A slot element
// (`<Paned.StartChild>`) is a node too, which holds no widget of its own
// (HostNode.ts).

export * from "react-reconciler/ReactFiberConfigWithNoHydration.ts";
export * from "react-reconciler/ReactFiberConfigWithNoMicrotasks.ts";
export * from "react-reconciler/ReactFiberConfigWithNoPersistence.ts";
export * from "react-reconciler/ReactFiberConfigWithNoResources.ts";
export * from "react-reconciler/ReactFiberConfigWithNoScopes.ts";
export * from "react-reconciler/ReactFiberConfigWithNoSingletons.ts";
export * from "react-reconciler/ReactFiberConfigWithNoTestSelectors.ts";
export * from "react-reconciler/ReactFiberConfigWithNoViewTransition.ts";

import { ReactContext } from "shared/ReactContext.ts";
import type { GtkWidget } from "c:Gtk-4.0";

import { getCurrentUpdatePriority, type HostNode, NoEventPriority, type Props, textOf, type WidgetNode } from "./HostNode.ts";
import type { HostRoot } from "./HostRoot.ts";
import { cancelTimer, startTimer } from "./SchedulerHost.ts";

export { getCurrentUpdatePriority, HostNode, setCurrentUpdatePriority, SlotNode, type Props, WidgetNode } from "./HostNode.ts";
export { ApplicationRoot, HostRoot, WindowRoot } from "./HostRoot.ts";

export type Type = string;

// ---- the reconciler's contract ---------------------------------------------------

export type Instance = HostNode;
// GTK has no bare text node: text is a Label's.
export type TextInstance = HostNode;
export type Container = HostRoot;
export type PublicInstance = GtkWidget;
export type HostContext = number;

export type ActivityInstance = unknown;
export type SuspenseInstance = unknown;
export type HydratableInstance = unknown;
export type ChildSet = unknown;
export type UpdatePayload = null;
export type TimeoutHandle = number;
export type NoTimeout = number;
export type RendererInspectionConfig = null;
export type TransitionStatus = unknown;
export type FormInstance = unknown;
export type SuspendedState = unknown;
export type FragmentInstanceType = unknown;

export const rendererVersion = "19.3.0";
export const rendererPackageName = "react-gtk";
export const extraDevToolsConfig = null;
export const isPrimaryRenderer = true;
export const warnsIfNotActing = false;
export const supportsMutation = true;
export const noTimeout: NoTimeout = -1;
export const NotPendingTransition: TransitionStatus = null;
// Made directly rather than by `createContext`: a host config sits below the
// `react` package, and importing it would carry its top level into every host.
export const HostTransitionContext = new ReactContext<TransitionStatus>(NotPendingTransition);

const DefaultEventPriority = 32;

export function resolveUpdatePriority(): number {
  const priority = getCurrentUpdatePriority();
  return priority !== NoEventPriority ? priority : DefaultEventPriority;
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

export function getRootHostContext(_rootContainer: HostRoot): HostContext {
  return 0;
}
export function getChildHostContext(parentHostContext: HostContext, _type: string): HostContext {
  return parentHostContext;
}
export function getPublicInstance(instance: HostNode): PublicInstance {
  return instance.publicInstance();
}
export function prepareForCommit(_containerInfo: HostRoot): object | null {
  return null;
}
export function resetAfterCommit(_containerInfo: HostRoot): void {}

// Text children are a widget's label: no text instance is made for them, and
// a widget with no label refuses them (HostNode.applyProps).
// Text children, however JSX split them, are one text content: a widget's
// label (HostNode.ts, `textOf`), never text instances.
export function shouldSetTextContent(_type: string, props: Props): boolean {
  return textOf(props["children"]) !== null;
}

export function createInstance(type: string, props: Props, root: HostRoot, _hostContext: HostContext, _handle: object): HostNode {
  const node = root.createNode(type);
  if (node === null) {
    throw new Error(
      type.startsWith("Gtk")
        ? `react-gtk has no <${type.slice(3)}>.`
        : `No widget set of this root has <${type}>: pass its set (\`widgets: [adw]\`) to createRoot.`,
    );
  }
  node.applyProps(null, props);
  return node;
}

export function createTextInstance(text: string, _root: HostRoot, _hostContext: HostContext, _handle: object): HostNode {
  throw new Error(`Text "${text}" must be inside a <Label>: GTK has no bare text.`);
}

export function appendInitialChild(parentInstance: HostNode, child: HostNode): void {
  parentInstance.appendChild(child);
}
// A window is presented once its tree is committed (WidgetNode.commitMount).
export function finalizeInitialChildren(instance: HostNode, _type: string, _props: Props, _hostContext: HostContext): boolean {
  return instance.needsCommitMount();
}
export function cloneMutableInstance(instance: HostNode, _keepChildren: boolean): HostNode {
  return instance;
}
export function cloneMutableTextInstance(textInstance: HostNode): HostNode {
  return textInstance;
}

export function appendChild(parentInstance: HostNode, child: HostNode): void {
  parentInstance.appendChild(child);
}
export function appendChildToContainer(container: HostRoot, child: HostNode): void {
  container.appendChild(child);
}
export function insertBefore(parentInstance: HostNode, child: HostNode, beforeChild: HostNode): void {
  parentInstance.insertBefore(child, beforeChild);
}
export function insertInContainerBefore(container: HostRoot, child: HostNode, beforeChild: HostNode): void {
  container.insertBefore(child, beforeChild);
}
export function removeChild(parentInstance: HostNode, child: HostNode): void {
  parentInstance.removeChild(child);
}
export function removeChildFromContainer(container: HostRoot, child: HostNode): void {
  container.removeChild(child);
}
export function clearContainer(container: HostRoot): void {
  container.clear();
}

export function commitTextUpdate(_textInstance: HostNode, _oldText: string, _newText: string): void {}
export function commitMount(instance: HostNode, _type: string, _newProps: Props, _handle: object): void {
  instance.commitMount();
}
export function commitUpdate(instance: HostNode, _type: string, oldProps: Props, newProps: Props, _handle: object): void {
  instance.applyProps(oldProps, newProps);
}
export function resetTextContent(instance: HostNode): void {
  const widget = instance.widgetNode();
  if (widget !== null) {
    widget.setProp("label", undefined);
  }
}

// Suspense and Activity hide what they do not show.
export function hideInstance(instance: HostNode): void {
  instance.setVisible(false);
}
export function hideTextInstance(_textInstance: HostNode): void {}
// Shown again, a widget is as visible as its own props say, which its node
// holds (WidgetNode.setVisible); a `visible` React set while it was hidden
// waited for this.
export function unhideInstance(instance: HostNode, _props: Props): void {
  instance.setVisible(true);
}
export function unhideTextInstance(_textInstance: HostNode, _text: string): void {}

export function detachDeletedInstance(node: HostNode): void {
  node.detachDeleted();
}
export function getInstanceFromNode(_node: unknown): HostNode | null {
  return null;
}
export function beforeActiveInstanceBlur(_handle: object): void {}
export function afterActiveInstanceBlur(): void {}
export function preparePortalMount(_portalInstance: HostRoot): void {}
export function requestPostPaintCallback(_callback: (time: number) => void): void {}

// Commits never wait on host resources here.
export function maySuspendCommit(_type: string, _props: Props): boolean {
  return false;
}
export function maySuspendCommitOnUpdate(_type: string, _oldProps: Props, _newProps: Props): boolean {
  return false;
}
export function maySuspendCommitInSyncRender(_type: string, _props: Props): boolean {
  return false;
}
export function preloadInstance(_instance: HostNode, _type: string, _props: Props): boolean {
  return true;
}
export function startSuspendingCommit(): SuspendedState {
  return null;
}
export function suspendInstance(_state: SuspendedState, _instance: HostNode, _type: string, _props: Props): void {}
export function suspendOnActiveViewTransition(_state: SuspendedState, _container: HostRoot): void {}
export function waitForCommitToBeReady(
  _state: SuspendedState,
  _timeoutOffset: number,
): ((initiateCommit: () => void) => () => void) | null {
  return null;
}
export function getSuspendedCommitReason(_state: SuspendedState, _rootContainer: HostRoot): string | null {
  return null;
}
export function resetFormInstance(_form: FormInstance): void {}
export function bindToConsole(_methodName: string, _args: unknown[], _badgeName: string): () => void {
  return () => {};
}

// Timeouts (suspended commits, retries) are GLib timeout sources.
export function scheduleTimeout(fn: () => void, delay?: number): TimeoutHandle {
  return startTimer(fn, delay ?? 0);
}
export function cancelTimeout(id: TimeoutHandle): void {
  cancelTimer(id);
}

export function createFragmentInstance(_fragmentFiber: unknown): FragmentInstanceType {
  return null;
}
export function updateFragmentInstanceFiber(_fragmentFiber: unknown, _instance: FragmentInstanceType): void {}
export function commitNewChildToFragmentInstance(_child: HostNode, _fragmentInstance: FragmentInstanceType): void {}
export function deleteChildFromFragmentInstance(_child: HostNode, _fragmentInstance: FragmentInstanceType): void {}
