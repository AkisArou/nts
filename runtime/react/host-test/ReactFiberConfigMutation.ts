import {
  RecordingMutationHost,
} from './recording-host.ts';
import type {
  HostContainer,
  HostInstance,
  HostNode,
  HostProp,
  HostText,
} from './recording-host.ts';

export type {HostProp} from './recording-host.ts';

export type Type = string;
// A renderer receives the ordinary props object stored on a host Fiber. This
// recording renderer deliberately exposes a small, finite native surface; the
// adapter below lowers that object to the compact property vector stored by its
// native host nodes.
export interface Props {
  readonly children?: React$Node;
  readonly className?: string;
  readonly hidden?: boolean;
  readonly id?: string;
  readonly label?: string;
  readonly value?: string | number | boolean | null;
}
export type Container = HostContainer;
export type Instance = HostInstance;
export type TextInstance = HostText;
export type PublicInstance = Instance | TextInstance;
export type HostContext = null;
export type TimeoutHandle = number;
export type NoTimeout = number;
export type RendererInspectionConfig = null;
export type TransitionStatus = null;
export type FormInstance = HostInstance;
export type SuspendedState = null;

export const rendererVersion = 'nts-recording-0';
export const rendererPackageName = '@nts/react-recording-host';
export const extraDevToolsConfig: RendererInspectionConfig = null;
export const isPrimaryRenderer = true;
export const warnsIfNotActing = false;
export const supportsMutation = true;
export const supportsPersistence = false;
export const supportsHydration = false;
export const supportsResources = false;
export const supportsSingletons = false;
export const supportsMicrotasks = false;
export const supportsTestSelectors = false;
export const noTimeout: NoTimeout = -1;
export const NotPendingTransition: TransitionStatus = null;
export const HostTransitionContext = {
  $$typeof: Symbol.for('react.context'),
  // React's host transition context is an internal sentinel. Like the upstream
  // DOM and test hosts, these public context fields are deliberately absent.
  Provider: null!,
  Consumer: null!,
  _currentValue: NotPendingTransition,
  _currentValue2: NotPendingTransition,
  _threadCount: 0,
};

// React's DefaultEventPriority currently aliases DefaultLane (bit 5). Keep the
// host-side event priority as an integer so this module does not introduce a
// HostConfig -> reconciler import cycle.
const defaultEventPriority = 32;
let currentUpdatePriority = 0;

const host = new RecordingMutationHost();

function adaptProps(props: Props): HostProp[] {
  const result: HostProp[] = [];
  if (props.className !== undefined) {
    result.push({name: 'className', value: props.className});
  }
  if (props.hidden !== undefined) {
    result.push({name: 'hidden', value: props.hidden});
  }
  if (props.id !== undefined) result.push({name: 'id', value: props.id});
  if (props.label !== undefined) result.push({name: 'label', value: props.label});
  if (props.value !== undefined) result.push({name: 'value', value: props.value});
  return result;
}

export function getRecordingHost(): RecordingMutationHost {
  return host;
}

export function getPublicInstance(
  instance: Instance | TextInstance,
): PublicInstance {
  return instance;
}

export function getRootHostContext(_container: Container): HostContext {
  return null;
}

export function getChildHostContext(
  _parent: HostContext,
  _type: Type,
): HostContext {
  return null;
}

export function prepareForCommit(_container: Container): null {
  return null;
}

export function resetAfterCommit(_container: Container): void {}

export function getCurrentUpdatePriority(): number {
  return currentUpdatePriority;
}

export function setCurrentUpdatePriority(priority: number): void {
  currentUpdatePriority = priority;
}

export function resolveUpdatePriority(): number {
  return currentUpdatePriority === 0 ? defaultEventPriority : currentUpdatePriority;
}

export function startSuspendingCommit(): SuspendedState {
  return null;
}

export function suspendOnActiveViewTransition(
  _state: SuspendedState,
  _container: Container,
): void {}

export function waitForCommitToBeReady(
  _state: SuspendedState,
  _timeoutOffset: number,
): null | ((commit: () => void) => () => void) {
  return null;
}

export function getSuspendedCommitReason(
  _state: SuspendedState,
  _container: Container,
): null {
  return null;
}

export function createInstance(
  type: Type,
  props: Props,
  _container: Container,
  _context: HostContext,
  _internalHandle: unknown,
): Instance {
  return host.createInstance(type, adaptProps(props));
}

export function appendInitialChild(parent: Instance, child: HostNode): void {
  host.appendInitialChild(parent, child);
}

export function finalizeInitialChildren(
  _instance: Instance,
  _type: Type,
  _props: Props,
  _context: HostContext,
): boolean {
  return false;
}

export function shouldSetTextContent(_type: Type, _props: Props): boolean {
  return false;
}

export function createTextInstance(
  text: string,
  _container: Container,
  _context: HostContext,
  _internalHandle: unknown,
): TextInstance {
  return host.createTextInstance(text);
}

export function appendChild(parent: Instance, child: HostNode): void {
  host.appendChild(parent, child);
}

export function appendChildToContainer(
  container: Container,
  child: HostNode,
): void {
  host.appendChild(container, child);
}

export function insertBefore(
  parent: Instance,
  child: HostNode,
  before: HostNode,
): void {
  host.insertBefore(parent, child, before);
}

export function insertInContainerBefore(
  container: Container,
  child: HostNode,
  before: HostNode,
): void {
  host.insertBefore(container, child, before);
}

export function removeChild(parent: Instance, child: HostNode): void {
  host.removeChild(parent, child);
}

export function removeChildFromContainer(
  container: Container,
  child: HostNode,
): void {
  host.removeChild(container, child);
}

export function clearContainer(container: Container): void {
  host.clearContainer(container);
}

export function commitUpdate(
  instance: Instance,
  _type: Type,
  _oldProps: Props,
  newProps: Props,
  _internalHandle: unknown,
): void {
  host.commitUpdate(instance, adaptProps(newProps));
}

export function commitTextUpdate(
  text: TextInstance,
  _oldText: string,
  newText: string,
): void {
  host.commitTextUpdate(text, newText);
}

export function resetTextContent(instance: Instance): void {
  host.resetTextContent(instance);
}

export function hideInstance(instance: Instance): void {
  host.hideInstance(instance);
}

export function unhideInstance(instance: Instance, _props: Props): void {
  host.unhideInstance(instance);
}

export function hideTextInstance(text: TextInstance): void {
  host.hideTextInstance(text);
}

export function unhideTextInstance(text: TextInstance, _value: string): void {
  host.unhideTextInstance(text);
}

export function detachDeletedInstance(_instance: Instance): void {}
