// react-gtk: React's host config for GTK 4 (see ../DESIGN.md). A native GTK
// program binds this module for `react-reconciler/ReactFiberConfig.ts`.
//
// A host node is a class per kind of widget. The base holds the widget as a
// GtkWidget, which is all a parent or the window needs; each kind also holds
// it typed as what it is -- so its own protocol is the widget's own methods,
// with no cast -- and what React needs beside it: the handlers its signal
// props hold. GTK sees the widget; React sees the node.

export * from "react-reconciler/ReactFiberConfigWithNoHydration.ts";
export * from "react-reconciler/ReactFiberConfigWithNoMicrotasks.ts";
export * from "react-reconciler/ReactFiberConfigWithNoPersistence.ts";
export * from "react-reconciler/ReactFiberConfigWithNoResources.ts";
export * from "react-reconciler/ReactFiberConfigWithNoScopes.ts";
export * from "react-reconciler/ReactFiberConfigWithNoSingletons.ts";
export * from "react-reconciler/ReactFiberConfigWithNoTestSelectors.ts";
export * from "react-reconciler/ReactFiberConfigWithNoViewTransition.ts";

import { ReactContext } from "shared/ReactContext.ts";
import { GtkBox, GtkButton, GtkLabel, type GtkWidget, type GtkWindow, type Orientation } from "c:Gtk-4.0";

import { cancelTimer, startTimer } from "./SchedulerHost.ts";

export type Type = string;
export type Props = { [key: string]: unknown };

// ---- host nodes --------------------------------------------------------------

export abstract class HostNode {
  readonly widget: GtkWidget;
  abstract readonly type: string;

  constructor(widget: GtkWidget) {
    this.widget = widget;
  }

  /** Applies `next`, the props after `previous` (null on creation). */
  abstract applyProps(previous: Props | null, next: Props): void;

  appendChild(_child: HostNode): void {
    throw new Error(`<${this.type}> takes no children.`);
  }
  insertBefore(_child: HostNode, _before: HostNode): void {
    throw new Error(`<${this.type}> takes no children.`);
  }
  removeChild(_child: HostNode): void {
    throw new Error(`<${this.type}> takes no children.`);
  }
}

// A handler a signal prop holds. The widget's signal is connected once, to a
// trampoline that calls whatever handler the props hold now, so a re-render
// with a new closure -- the common case -- changes this field and never
// reconnects.
class SignalSlot {
  handler: (() => void) | null = null;
  connected = false;
}

/** `<Box>`: children in a row or column. */
export class BoxNode extends HostNode {
  readonly type = "GtkBox";
  readonly box: GtkBox;

  constructor() {
    const box = new GtkBox();
    super(box);
    this.box = box;
  }

  applyProps(previous: Props | null, next: Props): void {
    const spacing = next["spacing"];
    if (typeof spacing === "number" && spacing !== previous?.["spacing"]) {
      this.box.set_spacing(spacing);
    }
    const orientation = next["orientation"];
    if (typeof orientation === "number" && orientation !== previous?.["orientation"]) {
      this.box.set_orientation(orientation as Orientation);
    }
  }

  appendChild(child: HostNode): void {
    this.box.append(child.widget);
  }
  insertBefore(child: HostNode, before: HostNode): void {
    // GtkBox places a child after a sibling; React places it before one. A
    // child already in the box is a move -- a keyed list reordered -- which
    // GTK spells `reorder_child_after`; a new one is inserted.
    const after = before.widget.get_prev_sibling();
    if (child.widget.get_parent() === this.box) {
      if (after !== child.widget) {
        this.box.reorder_child_after(child.widget, after);
      }
    } else {
      this.box.insert_child_after(child.widget, after);
    }
  }
  removeChild(child: HostNode): void {
    this.box.remove(child.widget);
  }
}

/** `<Label>`: its `label` prop, or its text children. */
export class LabelNode extends HostNode {
  readonly type = "GtkLabel";
  readonly label: GtkLabel;

  constructor() {
    const label = new GtkLabel();
    super(label);
    this.label = label;
  }

  applyProps(previous: Props | null, next: Props): void {
    const text = labelText(next);
    if (previous === null || text !== labelText(previous)) {
      this.label.set_label(text);
    }
  }
}

function labelText(props: Props): string {
  const label = props["label"];
  if (typeof label === "string") {
    return label;
  }
  const children = props["children"];
  return typeof children === "string" || typeof children === "number" ? String(children) : "";
}

/** `<Button>`: its `label`, and `onClicked`. */
export class ButtonNode extends HostNode {
  readonly type = "GtkButton";
  readonly button: GtkButton;

  constructor() {
    const button = new GtkButton();
    super(button);
    this.button = button;
  }
  private readonly clicked = new SignalSlot();

  applyProps(previous: Props | null, next: Props): void {
    const label = next["label"];
    if (typeof label === "string" && label !== previous?.["label"]) {
      this.button.set_label(label);
    }
    const onClicked = next["onClicked"];
    this.clicked.handler = typeof onClicked === "function" ? (onClicked as () => void) : null;
    if (this.clicked.handler !== null && !this.clicked.connected) {
      this.clicked.connected = true;
      const slot = this.clicked;
      this.button.connect("clicked", () => {
        const handler = slot.handler;
        if (handler !== null) {
          discreteEvent(handler);
        }
      });
    }
  }
}

/** The root: a window, which holds one child. */
export class GtkContainer {
  readonly window: GtkWindow;
  child: HostNode | null = null;

  constructor(window: GtkWindow) {
    this.window = window;
  }
}

// ---- the reconciler's contract ---------------------------------------------------

export type Instance = HostNode;
// GTK has no bare text node: text is a Label's.
export type TextInstance = HostNode;
export type Container = GtkContainer;
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

// Update priorities: a signal handler runs at DiscreteEventPriority, as React
// DOM's dispatchDiscreteEvent runs a click, so a click is a discrete update.
const NoEventPriority = 0;
const DiscreteEventPriority = 2;
const DefaultEventPriority = 32;
let currentUpdatePriority = NoEventPriority;

function discreteEvent(handler: () => void): void {
  const previous = currentUpdatePriority;
  currentUpdatePriority = DiscreteEventPriority;
  try {
    handler();
  } finally {
    currentUpdatePriority = previous;
  }
}

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

export function getRootHostContext(_rootContainer: GtkContainer): HostContext {
  return 0;
}
export function getChildHostContext(parentHostContext: HostContext, _type: string): HostContext {
  return parentHostContext;
}
export function getPublicInstance(instance: HostNode): PublicInstance {
  return instance.widget;
}
export function prepareForCommit(_containerInfo: GtkContainer): object | null {
  return null;
}
export function resetAfterCommit(_containerInfo: GtkContainer): void {}

// A Label's text children are its text: no text instance is made for them.
export function shouldSetTextContent(type: string, props: Props): boolean {
  const children = props["children"];
  return type === "GtkLabel" && (typeof children === "string" || typeof children === "number");
}

export function createInstance(type: string, props: Props, _root: GtkContainer, _hostContext: HostContext, _handle: object): HostNode {
  let node: HostNode;
  switch (type) {
    case "GtkBox":
      node = new BoxNode();
      break;
    case "GtkLabel":
      node = new LabelNode();
      break;
    case "GtkButton":
      node = new ButtonNode();
      break;
    default:
      throw new Error(`react-gtk has no <${type}>.`);
  }
  node.applyProps(null, props);
  return node;
}

export function createTextInstance(text: string, _root: GtkContainer, _hostContext: HostContext, _handle: object): HostNode {
  throw new Error(`Text "${text}" must be inside a <Label>: GTK has no bare text.`);
}

export function appendInitialChild(parentInstance: HostNode, child: HostNode): void {
  parentInstance.appendChild(child);
}
export function finalizeInitialChildren(_instance: HostNode, _type: string, _props: Props, _hostContext: HostContext): boolean {
  return false;
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
export function appendChildToContainer(container: GtkContainer, child: HostNode): void {
  if (container.child !== null && container.child !== child) {
    throw new Error("A GTK window holds one child: wrap its children in a <Box>.");
  }
  container.child = child;
  container.window.set_child(child.widget);
}
export function insertBefore(parentInstance: HostNode, child: HostNode, beforeChild: HostNode): void {
  parentInstance.insertBefore(child, beforeChild);
}
export function insertInContainerBefore(_container: GtkContainer, _child: HostNode, _beforeChild: HostNode): void {
  throw new Error("A GTK window holds one child: wrap its children in a <Box>.");
}
export function removeChild(parentInstance: HostNode, child: HostNode): void {
  parentInstance.removeChild(child);
}
export function removeChildFromContainer(container: GtkContainer, child: HostNode): void {
  if (container.child === child) {
    container.child = null;
    container.window.set_child(null);
  }
}
export function clearContainer(container: GtkContainer): void {
  container.child = null;
  container.window.set_child(null);
}

export function commitTextUpdate(_textInstance: HostNode, _oldText: string, _newText: string): void {}
export function commitMount(_instance: HostNode, _type: string, _newProps: Props, _handle: object): void {}
export function commitUpdate(instance: HostNode, _type: string, oldProps: Props, newProps: Props, _handle: object): void {
  instance.applyProps(oldProps, newProps);
}
export function resetTextContent(instance: HostNode): void {
  if (instance instanceof LabelNode) {
    instance.label.set_label("");
  }
}

// Suspense and Activity hide what they do not show.
export function hideInstance(instance: HostNode): void {
  instance.widget.set_visible(false);
}
export function hideTextInstance(_textInstance: HostNode): void {}
export function unhideInstance(instance: HostNode, _props: Props): void {
  instance.widget.set_visible(true);
}
export function unhideTextInstance(_textInstance: HostNode, _text: string): void {}

export function detachDeletedInstance(_node: HostNode): void {}
export function getInstanceFromNode(_node: unknown): HostNode | null {
  return null;
}
export function beforeActiveInstanceBlur(_handle: object): void {}
export function afterActiveInstanceBlur(): void {}
export function preparePortalMount(_portalInstance: GtkContainer): void {}
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
export function suspendOnActiveViewTransition(_state: SuspendedState, _container: GtkContainer): void {}
export function waitForCommitToBeReady(
  _state: SuspendedState,
  _timeoutOffset: number,
): ((initiateCommit: () => void) => () => void) | null {
  return null;
}
export function getSuspendedCommitReason(_state: SuspendedState, _rootContainer: GtkContainer): string | null {
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
