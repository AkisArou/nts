// The contract between the reconciler and a renderer: every host operation
// the reconciler calls. This module only declares them. Each renderer's
// bundle forks it to that renderer's config module (see tools/build-js.ts),
// as upstream's build forks `ReactFiberConfig` per renderer, so every host
// call is a direct call into the renderer: no config object, no dispatch.
//
// The types are opaque to the reconciler: it only stores and passes them.
// A renderer's config module exports the same names with its own types.
//
// Mirrors upstream's forks/ReactFiberConfig.custom.js.

import type { ReactContext } from "shared/ReactTypes.ts";

export type Type = string;
export type Props = { [key: string]: unknown };
export type Container = unknown;
export type Instance = unknown;
export type TextInstance = unknown;
export type ActivityInstance = unknown;
export type SuspenseInstance = unknown;
export type HydratableInstance = unknown;
export type PublicInstance = unknown;
export type HostContext = unknown;
export type UpdatePayload = unknown;
export type ChildSet = unknown;
export type TimeoutHandle = unknown;
export type NoTimeout = unknown;
export type RendererInspectionConfig = unknown;
export type TransitionStatus = unknown;
export type FormInstance = unknown;
export type SuspendedState = unknown;
export type RunningViewTransition = unknown;
export type ViewTransitionInstance = null | { name: string };
export type InstanceMeasurement = unknown;
export type EventResponder = unknown;
export type GestureTimeline = unknown;
export type FragmentInstanceType = unknown;
export type HoistableRoot = unknown;
export type Resource = unknown;

// An internal handle the host keeps on its instances to find the fiber.
type InternalInstanceHandle = object;

export declare const rendererVersion: string;
export declare const rendererPackageName: string;
export declare const extraDevToolsConfig: unknown;

export declare function getPublicInstance(instance: Instance | TextInstance): PublicInstance;
export declare function getRootHostContext(rootContainerInstance: Container): HostContext;
export declare function getChildHostContext(parentHostContext: HostContext, type: Type): HostContext;
export declare function prepareForCommit(containerInfo: Container): object | null;
export declare function resetAfterCommit(containerInfo: Container): void;
export declare function createInstance(
  type: Type,
  props: Props,
  rootContainerInstance: Container,
  hostContext: HostContext,
  internalInstanceHandle: InternalInstanceHandle,
): Instance;
export declare function cloneMutableInstance(instance: Instance, keepChildren: boolean): Instance;
export declare function appendInitialChild(parentInstance: Instance, child: Instance | TextInstance): void;
export declare function finalizeInitialChildren(
  instance: Instance,
  type: Type,
  props: Props,
  hostContext: HostContext,
): boolean;
export declare function shouldSetTextContent(type: Type, props: Props): boolean;
export declare function createTextInstance(
  text: string,
  rootContainerInstance: Container,
  hostContext: HostContext,
  internalInstanceHandle: InternalInstanceHandle,
): TextInstance;
export declare function cloneMutableTextInstance(textInstance: TextInstance): TextInstance;
export declare function scheduleTimeout(fn: () => void, delay?: number): TimeoutHandle;
export declare function cancelTimeout(id: TimeoutHandle): void;
export declare const noTimeout: NoTimeout;
export declare const isPrimaryRenderer: boolean;
export declare const warnsIfNotActing: boolean;
export declare const supportsMutation: boolean;
export declare const supportsPersistence: boolean;
export declare const supportsHydration: boolean;
export declare function getInstanceFromNode(node: unknown): unknown;
export declare function beforeActiveInstanceBlur(internalInstanceHandle: InternalInstanceHandle): void;
export declare function afterActiveInstanceBlur(): void;
export declare function preparePortalMount(portalInstance: Container): void;
export declare function prepareScopeUpdate(scopeInstance: unknown, instance: unknown): void;
export declare function getInstanceFromScope(scopeInstance: unknown): unknown;
export declare function setCurrentUpdatePriority(newPriority: number): void;
export declare function getCurrentUpdatePriority(): number;
export declare function resolveUpdatePriority(): number;
export declare function trackSchedulerEvent(): void;
export declare function resolveEventType(): string | null;
export declare function resolveEventTimeStamp(): number;
export declare function shouldAttemptEagerTransition(): boolean;
export declare function detachDeletedInstance(node: Instance): void;
export declare function requestPostPaintCallback(callback: (time: number) => void): void;
export declare function maySuspendCommit(type: Type, props: Props): boolean;
export declare function maySuspendCommitOnUpdate(type: Type, oldProps: Props, newProps: Props): boolean;
export declare function maySuspendCommitInSyncRender(type: Type, props: Props): boolean;
export declare function preloadInstance(instance: Instance, type: Type, props: Props): boolean;
export declare function startSuspendingCommit(): SuspendedState;
export declare function suspendInstance(state: SuspendedState, instance: Instance, type: Type, props: Props): void;
export declare function suspendOnActiveViewTransition(state: SuspendedState, container: Container): void;
export declare function waitForCommitToBeReady(
  state: SuspendedState,
  timeoutOffset: number,
): ((initiateCommit: () => void) => () => void) | null;
export declare function getSuspendedCommitReason(state: SuspendedState, rootContainer: Container): string | null;
export declare const NotPendingTransition: TransitionStatus;
export declare const HostTransitionContext: ReactContext<TransitionStatus>;
export declare function resetFormInstance(form: FormInstance): void;
export declare function bindToConsole(methodName: string, args: unknown[], badgeName: string): () => unknown;

export declare const supportsMicrotasks: boolean;
export declare function scheduleMicrotask(callback: () => void): void;

export declare const supportsTestSelectors: boolean;
export declare function findFiberRoot(node: Instance): unknown;
export declare function getBoundingRect(node: Instance): unknown;
export declare function getTextContent(fiber: unknown): string | null;
export declare function isHiddenSubtree(fiber: unknown): boolean;
export declare function matchAccessibilityRole(node: Instance, role: string): boolean;
export declare function setFocusIfFocusable(node: Instance, focusOptions?: unknown): boolean;
export declare function setupIntersectionObserver(
  targets: Instance[],
  callback: unknown,
  options?: unknown,
): { disconnect: () => void; observe: (instance: Instance) => void; unobserve: (instance: Instance) => void };

// Mutation.
export declare function appendChild(parentInstance: Instance, child: Instance | TextInstance): void;
export declare function appendChildToContainer(container: Container, child: Instance | TextInstance): void;
export declare function commitTextUpdate(textInstance: TextInstance, oldText: string, newText: string): void;
export declare function commitMount(
  instance: Instance,
  type: Type,
  newProps: Props,
  internalInstanceHandle: InternalInstanceHandle,
): void;
export declare function commitUpdate(
  instance: Instance,
  type: Type,
  oldProps: Props,
  newProps: Props,
  internalInstanceHandle: InternalInstanceHandle,
): void;
export declare function insertBefore(
  parentInstance: Instance,
  child: Instance | TextInstance,
  beforeChild: Instance | TextInstance | SuspenseInstance | ActivityInstance,
): void;
export declare function insertInContainerBefore(
  container: Container,
  child: Instance | TextInstance,
  beforeChild: Instance | TextInstance | SuspenseInstance | ActivityInstance,
): void;
export declare function removeChild(
  parentInstance: Instance,
  child: Instance | TextInstance | SuspenseInstance | ActivityInstance,
): void;
export declare function removeChildFromContainer(
  container: Container,
  child: Instance | TextInstance | SuspenseInstance | ActivityInstance,
): void;
export declare function resetTextContent(instance: Instance): void;
export declare function hideInstance(instance: Instance): void;
export declare function hideTextInstance(textInstance: TextInstance): void;
export declare function unhideInstance(instance: Instance, props: Props): void;
export declare function unhideTextInstance(textInstance: TextInstance, text: string): void;
export declare function clearContainer(container: Container): void;

// View transitions.
export declare function applyViewTransitionName(instance: Instance, name: string, className: string | null): void;
export declare function restoreViewTransitionName(instance: Instance, props: Props): void;
export declare function cancelViewTransitionName(instance: Instance, name: string, props: Props): void;
export declare function cancelRootViewTransitionName(rootContainer: Container): void;
export declare function restoreRootViewTransitionName(rootContainer: Container): void;
export declare function cloneRootViewTransitionContainer(rootContainer: Container): Instance;
export declare function removeRootViewTransitionClone(rootContainer: Container, clone: Instance): void;
export declare function measureInstance(instance: Instance): InstanceMeasurement;
export declare function measureClonedInstance(instance: Instance): InstanceMeasurement;
export declare function wasInstanceInViewport(measurement: InstanceMeasurement): boolean;
export declare function hasInstanceChanged(oldMeasurement: InstanceMeasurement, newMeasurement: InstanceMeasurement): boolean;
export declare function hasInstanceAffectedParent(
  oldMeasurement: InstanceMeasurement,
  newMeasurement: InstanceMeasurement,
): boolean;
export declare function startViewTransition(
  rootContainer: Container,
  transitionTypes: string[] | null,
  mutationCallback: () => void,
  layoutCallback: () => void,
  afterMutationCallback: () => void,
  spawnedWorkCallback: () => void,
  passiveCallback: () => unknown,
  errorCallback: (error: unknown) => void,
  blockedCallback: (name: string) => void,
  finishedAnimation: () => void,
): RunningViewTransition | null;
export declare function startGestureTransition(...args: unknown[]): RunningViewTransition | null;
export declare function stopViewTransition(transition: RunningViewTransition): void;
export declare function addViewTransitionFinishedListener(transition: RunningViewTransition, callback: () => void): void;
export declare function getCurrentGestureOffset(provider: GestureTimeline): number;
export declare function createViewTransitionInstance(name: string): ViewTransitionInstance;

// Fragment refs.
export declare function createFragmentInstance(fragmentFiber: unknown): FragmentInstanceType;
export declare function updateFragmentInstanceFiber(fragmentFiber: unknown, instance: FragmentInstanceType): void;
export declare function commitNewChildToFragmentInstance(child: Instance | TextInstance, fragmentInstance: FragmentInstanceType): void;
export declare function deleteChildFromFragmentInstance(child: Instance | TextInstance, fragmentInstance: FragmentInstanceType): void;

// Persistence.
export declare function cloneInstance(
  instance: Instance,
  type: Type,
  oldProps: Props,
  newProps: Props,
  keepChildren: boolean,
  newChildSet: ChildSet | null | undefined,
): Instance;
export declare function createContainerChildSet(): ChildSet;
export declare function appendChildToContainerChildSet(childSet: ChildSet, child: Instance | TextInstance): void;
export declare function finalizeContainerChildren(container: Container, newChildren: ChildSet): void;
export declare function replaceContainerChildren(container: Container, newChildren: ChildSet): void;
export declare function cloneHiddenInstance(instance: Instance, type: Type, props: Props): Instance;
export declare function cloneHiddenTextInstance(instance: TextInstance, text: string): TextInstance;

// Hydration.
export declare function isSuspenseInstancePending(instance: SuspenseInstance): boolean;
export declare function isSuspenseInstanceFallback(instance: SuspenseInstance): boolean;
export declare function getSuspenseInstanceFallbackErrorDetails(instance: SuspenseInstance): {
  digest?: string;
  message?: string;
  stack?: string;
  componentStack?: string;
};
export declare function registerSuspenseInstanceRetry(instance: SuspenseInstance, callback: () => void): void;
export declare function canHydrateFormStateMarker(instance: HydratableInstance, inRootOrSingleton: boolean): unknown;
export declare function isFormStateMarkerMatching(markerInstance: unknown): boolean;
export declare function getNextHydratableSibling(instance: HydratableInstance): HydratableInstance | null;
export declare function getNextHydratableSiblingAfterSingleton(type: Type, fallbackInstance: HydratableInstance): HydratableInstance | null;
export declare function getFirstHydratableChild(parentInstance: Instance): HydratableInstance | null;
export declare function getFirstHydratableChildWithinContainer(parentContainer: Container): HydratableInstance | null;
export declare function getFirstHydratableChildWithinActivityInstance(parentInstance: ActivityInstance): HydratableInstance | null;
export declare function getFirstHydratableChildWithinSuspenseInstance(parentInstance: SuspenseInstance): HydratableInstance | null;
export declare function getFirstHydratableChildWithinSingleton(
  type: Type,
  singletonInstance: Instance,
  currentHydratableInstance: HydratableInstance | null,
): HydratableInstance | null;
export declare function canHydrateInstance(
  instance: HydratableInstance,
  type: Type,
  props: Props,
  inRootOrSingleton: boolean,
): Instance | null;
export declare function canHydrateTextInstance(
  instance: HydratableInstance,
  text: string,
  inRootOrSingleton: boolean,
): TextInstance | null;
export declare function canHydrateActivityInstance(instance: HydratableInstance, inRootOrSingleton: boolean): ActivityInstance | null;
export declare function canHydrateSuspenseInstance(instance: HydratableInstance, inRootOrSingleton: boolean): SuspenseInstance | null;
export declare function hydrateInstance(
  instance: Instance,
  type: Type,
  props: Props,
  hostContext: HostContext,
  internalInstanceHandle: InternalInstanceHandle,
): boolean;
export declare function hydrateTextInstance(
  textInstance: TextInstance,
  text: string,
  internalInstanceHandle: InternalInstanceHandle,
  parentInstanceProps: Props | null,
): boolean;
export declare function hydrateActivityInstance(activityInstance: ActivityInstance, internalInstanceHandle: InternalInstanceHandle): void;
export declare function hydrateSuspenseInstance(suspenseInstance: SuspenseInstance, internalInstanceHandle: InternalInstanceHandle): void;
export declare function getNextHydratableInstanceAfterActivityInstance(activityInstance: ActivityInstance): HydratableInstance | null;
export declare function getNextHydratableInstanceAfterSuspenseInstance(suspenseInstance: SuspenseInstance): HydratableInstance | null;
export declare function commitHydratedInstance(instance: Instance, type: Type, props: Props, internalInstanceHandle: InternalInstanceHandle): void;
export declare function commitHydratedContainer(container: Container): void;
export declare function commitHydratedActivityInstance(activityInstance: ActivityInstance): void;
export declare function commitHydratedSuspenseInstance(suspenseInstance: SuspenseInstance): void;
export declare function finalizeHydratedChildren(instance: Instance, type: Type, props: Props, hostContext: HostContext): boolean;
export declare function flushHydrationEvents(): void;
export declare function clearActivityBoundary(parentInstance: Instance, activityInstance: ActivityInstance): void;
export declare function clearSuspenseBoundary(parentInstance: Instance, suspenseInstance: SuspenseInstance): void;
export declare function clearActivityBoundaryFromContainer(container: Container, activityInstance: ActivityInstance): void;
export declare function clearSuspenseBoundaryFromContainer(container: Container, suspenseInstance: SuspenseInstance): void;
export declare function hideDehydratedBoundary(instance: SuspenseInstance | ActivityInstance): void;
export declare function unhideDehydratedBoundary(instance: SuspenseInstance | ActivityInstance): void;
export declare function shouldDeleteUnhydratedTailInstances(parentType: Type): boolean;
export declare function diffHydratedPropsForDevWarnings(instance: Instance, type: Type, props: Props, hostContext: HostContext): unknown;
export declare function diffHydratedTextForDevWarnings(textInstance: TextInstance, text: string, parentProps: Props | null): unknown;
export declare function describeHydratableInstanceForDevWarnings(instance: HydratableInstance): unknown;
export declare function validateHydratableInstance(type: Type, props: Props, hostContext: HostContext): boolean;
export declare function validateHydratableTextInstance(text: string, hostContext: HostContext): boolean;

// Resources (hoistables).
export declare const supportsResources: boolean;
export declare function isHostHoistableType(type: Type, props: Props, hostContext: HostContext): boolean;
export declare function getHoistableRoot(container: Container): HoistableRoot;
export declare function getResource(type: Type, currentProps: Props | null, pendingProps: Props, currentResource: Resource | null): Resource | null;
export declare function acquireResource(hoistableRoot: HoistableRoot, resource: Resource, props: Props): Instance;
export declare function releaseResource(resource: Resource): void;
export declare function hydrateHoistable(
  hoistableRoot: HoistableRoot,
  type: Type,
  props: Props,
  internalInstanceHandle: InternalInstanceHandle,
): Instance;
export declare function mountHoistable(hoistableRoot: HoistableRoot, type: Type, instance: Instance): void;
export declare function unmountHoistable(instance: Instance): void;
export declare function createHoistableInstance(
  type: Type,
  props: Props,
  rootContainerInstance: Container,
  internalInstanceHandle: InternalInstanceHandle,
): Instance;
export declare function prepareToCommitHoistables(): void;
export declare function mayResourceSuspendCommit(resource: Resource): boolean;
export declare function preloadResource(resource: Resource): boolean;
export declare function suspendResource(state: SuspendedState, hoistableRoot: HoistableRoot, resource: Resource, props: Props): void;

// Singletons.
export declare const supportsSingletons: boolean;
export declare function resolveSingletonInstance(type: Type, props: Props, rootContainerInstance: Container, hostContext: HostContext, validateDOMNestingDev: boolean): Instance;
export declare function acquireSingletonInstance(type: Type, props: Props, instance: Instance, internalInstanceHandle: InternalInstanceHandle): void;
export declare function releaseSingletonInstance(instance: Instance): void;
export declare function isHostSingletonType(type: Type): boolean;
export declare function isSingletonScope(type: Type): boolean;
