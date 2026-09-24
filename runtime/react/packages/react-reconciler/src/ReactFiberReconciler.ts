// The reconciler's public API: what a renderer calls to create roots,
// render into them and flush work.

import { isDevelopment } from "shared/Build.ts";
import { disableLegacyMode, enableSchedulingProfiler } from "shared/ReactFeatureFlags.ts";
import type { ErrorInfo, Fiber, FiberRoot } from "./ReactInternalTypes.ts";
import type { RootTag } from "./ReactRootTags.ts";
import type { Container, PublicInstance } from "./ReactFiberConfig.ts";
import type { Lane } from "./ReactFiberLane.ts";
import type { ActivityState } from "./ReactFiberActivityComponent.ts";
import type { SuspenseState } from "./ReactFiberSuspenseComponent.ts";
import { LegacyRoot } from "./ReactRootTags.ts";
import { findCurrentHostFiber, findCurrentHostFiberWithNoPortals } from "./ReactFiberTreeReflection.ts";
import { ActivityComponent, ClassComponent, HostComponent, HostRoot, HostSingleton, SuspenseComponent } from "./ReactWorkTags.ts";
import { getComponentNameFromFiber } from "./getComponentNameFromFiber.ts";
import { ReactSharedInternals } from "./ReactSharedInternals.ts";
import { extraDevToolsConfig, getPublicInstance, rendererPackageName, rendererVersion } from "./ReactFiberConfig.ts";
import {
  emptyContextObject,
  findCurrentUnmaskedContext,
  isContextProvider as isLegacyContextProvider,
  processChildContext,
} from "./ReactFiberLegacyContext.ts";
import { createFiberRoot } from "./ReactFiberRoot.ts";
import { isRootDehydrated } from "./ReactFiberShellHydration.ts";
import { injectInternals, injectProfilingHooks, markRenderScheduled, onScheduleRoot } from "./ReactFiberDevToolsHook.ts";
import { startUpdateTimerByLane } from "./ReactProfilerTimer.ts";
import {
  batchedUpdates,
  deferredUpdates,
  discreteUpdates,
  flushPendingEffects,
  flushRoot,
  flushSyncFromReconciler,
  flushSyncWork,
  isAlreadyRendering,
  requestUpdateLane,
  scheduleInitialHydrationOnRoot,
  scheduleUpdateOnFiber,
} from "./ReactFiberWorkLoop.ts";
import { enqueueConcurrentRenderForLane } from "./ReactFiberConcurrentUpdates.ts";
import { createUpdate, enqueueUpdate, entangleTransitions } from "./ReactFiberClassUpdateQueue.ts";
import {
  current as ReactCurrentFiberCurrent,
  isRendering as ReactCurrentFiberIsRendering,
  runWithFiberInDEV,
} from "./ReactCurrentFiber.ts";
import { StrictLegacyMode } from "./ReactTypeOfMode.ts";
import {
  claimNextRetryLane,
  getBumpedLaneForHydrationByLane,
  getHighestPriorityPendingLanes,
  getLabelForLane,
  higherPriorityLane,
  SelectiveHydrationLane,
  SyncLane,
  TotalLanes,
} from "./ReactFiberLane.ts";
import { scheduleRefresh, scheduleRoot, setRefreshHandler } from "./ReactFiberHotReloading.ts";
import { registerDefaultIndicator } from "./ReactFiberAsyncAction.ts";

export { createPortal } from "./ReactPortal.ts";
export {
  createComponentSelector,
  createHasPseudoClassSelector,
  createRoleSelector,
  createTestNameSelector,
  createTextSelector,
  findAllNodes,
  findBoundingRects,
  focusWithin,
  getFindAllNodesFailureDescription,
  observeVisibleRects,
} from "./ReactTestSelectors.ts";
export { startHostTransition } from "./ReactFiberHooks.ts";
export { defaultOnCaughtError, defaultOnRecoverableError, defaultOnUncaughtError } from "./ReactFiberErrorLogger.ts";

// The version of the reconciler, as upstream's `shared/ReactVersion`.
const ReactVersion = "19.3.0";

type OpaqueRoot = FiberRoot;
type ErrorCallback = (error: unknown, errorInfo: ErrorInfo) => void;

let didWarnAboutNestedUpdates = false;
const didWarnAboutFindNodeInStrictMode: { [componentName: string]: boolean } = {};

// A class instance's fiber. JS object model: upstream's `ReactInstanceMap`
// stores it on the instance itself, as `_reactInternals`.
function getInstance(component: object): Fiber | undefined {
  return (component as { _reactInternals?: Fiber })._reactInternals;
}

function getContextForSubtree(parentComponent: object | null | undefined): object {
  if (!parentComponent) {
    return emptyContextObject;
  }

  const fiber = getInstance(parentComponent)!;
  const parentContext = findCurrentUnmaskedContext(fiber);

  if (fiber.tag === ClassComponent) {
    const Component = fiber.type;
    if (isLegacyContextProvider(Component)) {
      return processChildContext(fiber, Component, parentContext);
    }
  }

  return parentContext;
}

function throwNotAComponent(component: object): never {
  if (typeof (component as { render?: unknown }).render === "function") {
    throw new Error("Unable to find node on an unmounted component.");
  }
  const keys = Object.keys(component).join(",");
  throw new Error(`Argument appears to not be a ReactComponent. Keys: ${keys}`);
}

function findHostInstance(component: object): PublicInstance | null {
  const fiber = getInstance(component);
  if (fiber === undefined) {
    throwNotAComponent(component);
  }
  const hostFiber = findCurrentHostFiber(fiber);
  if (hostFiber === null) {
    return null;
  }
  return getPublicInstance(hostFiber.stateNode);
}

function findHostInstanceWithWarning(component: object, methodName: string): PublicInstance | null {
  if (!isDevelopment) {
    return findHostInstance(component);
  }
  const fiber = getInstance(component);
  if (fiber === undefined) {
    throwNotAComponent(component);
  }
  const hostFiber = findCurrentHostFiber(fiber);
  if (hostFiber === null) {
    return null;
  }
  if (hostFiber.mode & StrictLegacyMode) {
    const componentName = getComponentNameFromFiber(fiber) || "Component";
    if (!didWarnAboutFindNodeInStrictMode[componentName]) {
      didWarnAboutFindNodeInStrictMode[componentName] = true;
      runWithFiberInDEV(hostFiber, () => {
        if (fiber.mode & StrictLegacyMode) {
          console.error(
            "%s is deprecated in StrictMode. " +
              "%s was passed an instance of %s which is inside StrictMode. " +
              "Instead, add a ref directly to the element you want to reference. " +
              "Learn more about using refs safely here: " +
              "https://react.dev/link/strict-mode-find-node",
            methodName,
            methodName,
            componentName,
          );
        } else {
          console.error(
            "%s is deprecated in StrictMode. " +
              "%s was passed an instance of %s which renders StrictMode children. " +
              "Instead, add a ref directly to the element you want to reference. " +
              "Learn more about using refs safely here: " +
              "https://react.dev/link/strict-mode-find-node",
            methodName,
            methodName,
            componentName,
          );
        }
      });
    }
  }
  return getPublicInstance(hostFiber.stateNode);
}

export function createContainer(
  containerInfo: Container,
  tag: RootTag,
  hydrationCallbacks: null,
  isStrictMode: boolean,
  // TODO: Remove `concurrentUpdatesByDefaultOverride`. It is now ignored.
  _concurrentUpdatesByDefaultOverride: boolean | null,
  identifierPrefix: string,
  onUncaughtError: ErrorCallback,
  onCaughtError: ErrorCallback,
  onRecoverableError: ErrorCallback,
  onDefaultTransitionIndicator: () => void | (() => void),
  transitionCallbacks: null,
): OpaqueRoot {
  const hydrate = false;
  const initialChildren = null;
  const root = createFiberRoot(
    containerInfo,
    tag,
    hydrate,
    initialChildren,
    hydrationCallbacks,
    isStrictMode,
    identifierPrefix,
    null,
    onUncaughtError,
    onCaughtError,
    onRecoverableError,
    onDefaultTransitionIndicator,
    transitionCallbacks,
  );
  registerDefaultIndicator(onDefaultTransitionIndicator);
  return root;
}

export function createHydrationContainer(
  initialChildren: unknown,
  // TODO: Remove `callback` when we delete legacy mode.
  callback: (() => unknown) | null | undefined,
  containerInfo: Container,
  tag: RootTag,
  hydrationCallbacks: null,
  isStrictMode: boolean,
  // TODO: Remove `concurrentUpdatesByDefaultOverride`. It is now ignored.
  _concurrentUpdatesByDefaultOverride: boolean | null,
  identifierPrefix: string,
  onUncaughtError: ErrorCallback,
  onCaughtError: ErrorCallback,
  onRecoverableError: ErrorCallback,
  onDefaultTransitionIndicator: () => void | (() => void),
  transitionCallbacks: null,
  formState: unknown,
): OpaqueRoot {
  const hydrate = true;
  const root = createFiberRoot(
    containerInfo,
    tag,
    hydrate,
    initialChildren,
    hydrationCallbacks,
    isStrictMode,
    identifierPrefix,
    formState,
    onUncaughtError,
    onCaughtError,
    onRecoverableError,
    onDefaultTransitionIndicator,
    transitionCallbacks,
  );

  registerDefaultIndicator(onDefaultTransitionIndicator);

  // TODO: Move this to FiberRoot constructor
  root.context = getContextForSubtree(null);

  // Schedule the initial render. In a hydration root, this is different from
  // a regular update because the initial render must match was was rendered
  // on the server.
  // NOTE: This update intentionally doesn't have a payload. We're only using
  // the update to schedule work on the root fiber (and, for legacy roots, to
  // enqueue the callback if one is provided).
  const current = root.current;
  let lane = requestUpdateLane(current);
  lane = getBumpedLaneForHydrationByLane(lane);
  const update = createUpdate(lane);
  update.callback = callback !== undefined && callback !== null ? callback : null;
  enqueueUpdate(current, update, lane);
  startUpdateTimerByLane(lane, "hydrateRoot()", null);
  scheduleInitialHydrationOnRoot(root, lane);

  return root;
}

export function updateContainer(
  element: unknown,
  container: OpaqueRoot,
  parentComponent: object | null | undefined,
  callback: unknown,
): Lane {
  const current = container.current;
  const lane = requestUpdateLane(current);
  updateContainerImpl(current, lane, element, container, parentComponent, callback);
  return lane;
}

export function updateContainerSync(
  element: unknown,
  container: OpaqueRoot,
  parentComponent: object | null | undefined,
  callback: unknown,
): Lane {
  if (!disableLegacyMode && container.tag === LegacyRoot) {
    flushPendingEffects();
  }
  const current = container.current;
  updateContainerImpl(current, SyncLane, element, container, parentComponent, callback);
  return SyncLane;
}

function updateContainerImpl(
  rootFiber: Fiber,
  lane: Lane,
  element: unknown,
  container: OpaqueRoot,
  parentComponent: object | null | undefined,
  callback: unknown,
): void {
  if (isDevelopment) {
    onScheduleRoot(container, element);
  }

  if (enableSchedulingProfiler) {
    markRenderScheduled(lane);
  }

  const context = getContextForSubtree(parentComponent);
  if (container.context === null) {
    container.context = context;
  } else {
    container.pendingContext = context;
  }

  if (isDevelopment) {
    if (ReactCurrentFiberIsRendering && ReactCurrentFiberCurrent !== null && !didWarnAboutNestedUpdates) {
      didWarnAboutNestedUpdates = true;
      console.error(
        "Render methods should be a pure function of props and state; " +
          "triggering nested component updates from render is not allowed. " +
          "If necessary, trigger nested updates in componentDidUpdate.\n\n" +
          "Check the render method of %s.",
        getComponentNameFromFiber(ReactCurrentFiberCurrent) || "Unknown",
      );
    }
  }

  const update = createUpdate(lane);
  // Caution: React DevTools currently depends on this property
  // being called "element".
  update.payload = { element };

  const updateCallback = callback === undefined ? null : callback;
  if (updateCallback !== null) {
    if (isDevelopment) {
      if (typeof updateCallback !== "function") {
        console.error(
          "Expected the last optional `callback` argument to be a " + "function. Instead received: %s.",
          updateCallback,
        );
      }
    }
    // A non-function callback is kept, as upstream does: committing it
    // throws the error the tests expect.
    update.callback = updateCallback as () => unknown;
  }

  const root = enqueueUpdate(rootFiber, update, lane);
  if (root !== null) {
    startUpdateTimerByLane(lane, "root.render()", null);
    scheduleUpdateOnFiber(root, rootFiber, lane);
    entangleTransitions(root, rootFiber, lane);
  }
}

export {
  batchedUpdates,
  deferredUpdates,
  discreteUpdates,
  flushSyncFromReconciler,
  flushSyncWork,
  isAlreadyRendering,
  flushPendingEffects as flushPassiveEffects,
};

export function getPublicRootInstance(container: OpaqueRoot): unknown {
  const containerFiber = container.current;
  if (!containerFiber.child) {
    return null;
  }
  switch (containerFiber.child.tag) {
    case HostSingleton:
    case HostComponent:
      return getPublicInstance(containerFiber.child.stateNode);
    default:
      return containerFiber.child.stateNode;
  }
}

export function attemptSynchronousHydration(fiber: Fiber): void {
  switch (fiber.tag) {
    case HostRoot: {
      const root = fiber.stateNode as FiberRoot;
      if (isRootDehydrated(root)) {
        // Flush the first scheduled "update".
        const lanes = getHighestPriorityPendingLanes(root);
        flushRoot(root, lanes);
      }
      break;
    }
    case ActivityComponent:
    case SuspenseComponent: {
      const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
      if (root !== null) {
        scheduleUpdateOnFiber(root, fiber, SyncLane);
      }
      flushSyncWork();
      // If we're still blocked after this, we need to increase
      // the priority of any promises resolving within this
      // boundary so that they next attempt also has higher pri.
      const retryLane = SyncLane;
      markRetryLaneIfNotHydrated(fiber, retryLane);
      break;
    }
  }
}

function markRetryLaneImpl(fiber: Fiber, retryLane: Lane): void {
  const suspenseState = fiber.memoizedState as SuspenseState | ActivityState | null;
  if (suspenseState !== null && suspenseState.dehydrated !== null) {
    suspenseState.retryLane = higherPriorityLane(suspenseState.retryLane, retryLane);
  }
}

// Increases the priority of thenables when they resolve within this boundary.
function markRetryLaneIfNotHydrated(fiber: Fiber, retryLane: Lane): void {
  markRetryLaneImpl(fiber, retryLane);
  const alternate = fiber.alternate;
  if (alternate) {
    markRetryLaneImpl(alternate, retryLane);
  }
}

export function attemptContinuousHydration(fiber: Fiber): void {
  if (fiber.tag !== SuspenseComponent && fiber.tag !== ActivityComponent) {
    // We ignore HostRoots here because we can't increase
    // their priority and they should not suspend on I/O,
    // since you have to wrap anything that might suspend in
    // Suspense.
    return;
  }
  const lane = SelectiveHydrationLane;
  const root = enqueueConcurrentRenderForLane(fiber, lane);
  if (root !== null) {
    scheduleUpdateOnFiber(root, fiber, lane);
  }
  markRetryLaneIfNotHydrated(fiber, lane);
}

export function attemptHydrationAtCurrentPriority(fiber: Fiber): void {
  if (fiber.tag !== SuspenseComponent && fiber.tag !== ActivityComponent) {
    // We ignore HostRoots here because we can't increase
    // their priority other than synchronously flush it.
    return;
  }
  let lane = requestUpdateLane(fiber);
  lane = getBumpedLaneForHydrationByLane(lane);
  const root = enqueueConcurrentRenderForLane(fiber, lane);
  if (root !== null) {
    scheduleUpdateOnFiber(root, fiber, lane);
  }
  markRetryLaneIfNotHydrated(fiber, lane);
}

export { findHostInstance, findHostInstanceWithWarning };

export function findHostInstanceWithNoPortals(fiber: Fiber): PublicInstance | null {
  const hostFiber = findCurrentHostFiberWithNoPortals(fiber);
  if (hostFiber === null) {
    return null;
  }
  return getPublicInstance(hostFiber.stateNode);
}

let shouldErrorImpl: (fiber: Fiber) => boolean | null | undefined = () => null;

export function shouldError(fiber: Fiber): boolean | null | undefined {
  return shouldErrorImpl(fiber);
}

let shouldSuspendImpl: (fiber: Fiber) => boolean = () => false;

export function shouldSuspend(fiber: Fiber): boolean {
  return shouldSuspendImpl(fiber);
}

// DevTools editing support, development only.

type Path = (string | number)[];
type Container_ = { [key: string]: unknown } | unknown[];

// The hook fields DevTools edits. JS object model: the edits copy arbitrary
// state objects by key.
interface EditableHook {
  memoizedState: unknown;
  baseState: unknown;
  next: EditableHook | null;
}

function shallowCopy(obj: unknown): Container_ {
  return Array.isArray(obj) ? obj.slice() : { ...(obj as { [key: string]: unknown }) };
}

function readKey(obj: unknown, key: string | number): unknown {
  return (obj as { [key: string]: unknown })[key];
}

function writeKey(obj: Container_, key: string | number, value: unknown): void {
  (obj as { [key: string]: unknown })[key] = value;
}

function removeKey(obj: Container_, key: string | number): void {
  if (Array.isArray(obj)) {
    obj.splice(key as number, 1);
  } else {
    delete obj[key];
  }
}

function copyWithDeleteImpl(obj: unknown, path: Path, index: number): Container_ {
  const key = path[index]!;
  const updated = shallowCopy(obj);
  if (index + 1 === path.length) {
    removeKey(updated, key);
    return updated;
  }
  writeKey(updated, key, copyWithDeleteImpl(readKey(obj, key), path, index + 1));
  return updated;
}

function copyWithDelete(obj: unknown, path: Path): Container_ {
  return copyWithDeleteImpl(obj, path, 0);
}

function copyWithRenameImpl(obj: unknown, oldPath: Path, newPath: Path, index: number): Container_ {
  const oldKey = oldPath[index]!;
  const updated = shallowCopy(obj);
  if (index + 1 === oldPath.length) {
    const newKey = newPath[index]!;
    writeKey(updated, newKey, readKey(updated, oldKey));
    removeKey(updated, oldKey);
  } else {
    writeKey(updated, oldKey, copyWithRenameImpl(readKey(obj, oldKey), oldPath, newPath, index + 1));
  }
  return updated;
}

function copyWithRename(obj: unknown, oldPath: Path, newPath: Path): Container_ | undefined {
  if (oldPath.length !== newPath.length) {
    console.warn("copyWithRename() expects paths of the same length");
    return undefined;
  }
  for (let i = 0; i < newPath.length - 1; i++) {
    if (oldPath[i] !== newPath[i]) {
      console.warn("copyWithRename() expects paths to be the same except for the deepest key");
      return undefined;
    }
  }
  return copyWithRenameImpl(obj, oldPath, newPath, 0);
}

function copyWithSetImpl(obj: unknown, path: Path, index: number, value: unknown): unknown {
  if (index >= path.length) {
    return value;
  }
  const key = path[index]!;
  const updated = shallowCopy(obj);
  writeKey(updated, key, copyWithSetImpl(readKey(obj, key), path, index + 1, value));
  return updated;
}

function copyWithSet(obj: unknown, path: Path, value: unknown): unknown {
  return copyWithSetImpl(obj, path, 0, value);
}

function findHook(fiber: Fiber, id: number): EditableHook | null {
  // For now, the "id" of stateful hooks is just the stateful hook index.
  // This may change in the future with e.g. nested hooks.
  let currentHook = fiber.memoizedState as EditableHook | null;
  let remaining = id;
  while (currentHook !== null && remaining > 0) {
    currentHook = currentHook.next;
    remaining--;
  }
  return currentHook;
}

function scheduleSyncUpdate(fiber: Fiber): void {
  const root = enqueueConcurrentRenderForLane(fiber, SyncLane);
  if (root !== null) {
    scheduleUpdateOnFiber(root, fiber, SyncLane);
  }
}

function replaceHookState(fiber: Fiber, hook: EditableHook, newState: unknown): void {
  hook.memoizedState = newState;
  hook.baseState = newState;

  // We aren't actually adding an update to the queue,
  // because there is no update we can add for useReducer hooks that won't trigger an error.
  // (There's no appropriate action type for DevTools overrides.)
  // As a result though, React will see the scheduled update as a noop and bailout.
  // Shallow cloning props works as a workaround for now to bypass the bailout check.
  fiber.memoizedProps = { ...(fiber.memoizedProps as object) };

  scheduleSyncUpdate(fiber);
}

// Support DevTools editable values for useState and useReducer.
function overrideHookState(fiber: Fiber, id: number, path: Path, value: unknown): void {
  const hook = findHook(fiber, id);
  if (hook !== null) {
    replaceHookState(fiber, hook, copyWithSet(hook.memoizedState, path, value));
  }
}

function overrideHookStateDeletePath(fiber: Fiber, id: number, path: Path): void {
  const hook = findHook(fiber, id);
  if (hook !== null) {
    replaceHookState(fiber, hook, copyWithDelete(hook.memoizedState, path));
  }
}

function overrideHookStateRenamePath(fiber: Fiber, id: number, oldPath: Path, newPath: Path): void {
  const hook = findHook(fiber, id);
  if (hook !== null) {
    replaceHookState(fiber, hook, copyWithRename(hook.memoizedState, oldPath, newPath));
  }
}

function replacePendingProps(fiber: Fiber, pendingProps: unknown): void {
  fiber.pendingProps = pendingProps;
  if (fiber.alternate) {
    fiber.alternate.pendingProps = fiber.pendingProps;
  }
  scheduleSyncUpdate(fiber);
}

// Support DevTools props for function components, forwardRef, memo, host components, etc.
function overrideProps(fiber: Fiber, path: Path, value: unknown): void {
  replacePendingProps(fiber, copyWithSet(fiber.memoizedProps, path, value));
}

function overridePropsDeletePath(fiber: Fiber, path: Path): void {
  replacePendingProps(fiber, copyWithDelete(fiber.memoizedProps, path));
}

function overridePropsRenamePath(fiber: Fiber, oldPath: Path, newPath: Path): void {
  replacePendingProps(fiber, copyWithRename(fiber.memoizedProps, oldPath, newPath));
}

function scheduleUpdate(fiber: Fiber): void {
  scheduleSyncUpdate(fiber);
}

function scheduleRetry(fiber: Fiber): void {
  const lane = claimNextRetryLane();
  const root = enqueueConcurrentRenderForLane(fiber, lane);
  if (root !== null) {
    scheduleUpdateOnFiber(root, fiber, lane);
  }
}

function setErrorHandler(newShouldErrorImpl: (fiber: Fiber) => boolean | null | undefined): void {
  shouldErrorImpl = newShouldErrorImpl;
}

function setSuspenseHandler(newShouldSuspendImpl: (fiber: Fiber) => boolean): void {
  shouldSuspendImpl = newShouldSuspendImpl;
}

function getCurrentFiberForDevTools(): Fiber | null {
  return ReactCurrentFiberCurrent;
}

function getLaneLabelMap(): Map<Lane, string> | null {
  if (!enableSchedulingProfiler) {
    return null;
  }
  const map: Map<Lane, string> = new Map();
  let lane = 1;
  for (let index = 0; index < TotalLanes; index++) {
    const label = getLabelForLane(lane) as string;
    map.set(lane, label);
    lane *= 2;
  }
  return map;
}

export function injectIntoDevTools(): boolean {
  const internals: { [key: string]: unknown } = {
    bundleType: isDevelopment ? 1 : 0, // Might add PROFILE later.
    version: rendererVersion,
    rendererPackageName: rendererPackageName,
    currentDispatcherRef: ReactSharedInternals,
    // Enables DevTools to detect reconciler version rather than renderer version
    // which may not match for third party renderers.
    reconcilerVersion: ReactVersion,
  };
  if (extraDevToolsConfig !== null) {
    internals["rendererConfig"] = extraDevToolsConfig;
  }
  if (isDevelopment) {
    internals["overrideHookState"] = overrideHookState;
    internals["overrideHookStateDeletePath"] = overrideHookStateDeletePath;
    internals["overrideHookStateRenamePath"] = overrideHookStateRenamePath;
    internals["overrideProps"] = overrideProps;
    internals["overridePropsDeletePath"] = overridePropsDeletePath;
    internals["overridePropsRenamePath"] = overridePropsRenamePath;
    internals["scheduleUpdate"] = scheduleUpdate;
    internals["scheduleRetry"] = scheduleRetry;
    internals["setErrorHandler"] = setErrorHandler;
    internals["setSuspenseHandler"] = setSuspenseHandler;
    // React Refresh
    internals["scheduleRefresh"] = scheduleRefresh;
    internals["scheduleRoot"] = scheduleRoot;
    internals["setRefreshHandler"] = setRefreshHandler;
    // Enables DevTools to append owner stacks to error messages in DEV mode.
    internals["getCurrentFiber"] = getCurrentFiberForDevTools;
  }
  if (enableSchedulingProfiler) {
    // Conditionally inject these hooks only if Timeline profiler is supported by this build.
    // This gives DevTools a way to feature detect that isn't tied to version number
    // (since profiling and timeline are controlled by different feature flags).
    internals["getLaneLabelMap"] = getLaneLabelMap;
    internals["injectProfilingHooks"] = injectProfilingHooks;
  }
  return injectInternals(internals);
}
