import { isDevelopment } from "shared/Build.ts";
import {
  disableLegacyMode,
  enableProfilerCommitHooks,
  enableProfilerTimer,
  enableSuspenseCallback,
  enableTransitionTracing,
  enableUpdaterTracking,
} from "shared/ReactFeatureFlags.ts";
import type { Transition, TransitionTypes, Wakeable } from "shared/ReactTypes.ts";
import type { ErrorInfo, Fiber, FiberRoot } from "./ReactInternalTypes.ts";
import type { RootTag } from "./ReactRootTags.ts";
import type { Cache } from "./ReactFiberCacheComponent.ts";
import type { ConcurrentUpdate } from "./ReactFiberConcurrentUpdates.ts";
import type { Container, Instance, NoTimeout, TimeoutHandle } from "react-reconciler/ReactFiberConfig.ts";
import type { Lane, LaneMap, Lanes } from "./ReactFiberLane.ts";
import { noTimeout } from "react-reconciler/ReactFiberConfig.ts";
import { createHostRootFiber } from "./ReactFiber.ts";
import { createLaneMap, NoLane, NoLanes, NoTimestamp, TotalLanes } from "./ReactFiberLane.ts";
import { initializeUpdateQueue } from "./ReactFiberClassUpdateQueue.ts";
import { ConcurrentRoot, LegacyRoot } from "./ReactRootTags.ts";
import { createCache, retainCache } from "./ReactFiberCacheComponent.ts";

// The host root fiber's `memoizedState`.
export interface RootState {
  element: unknown;
  isDehydrated: boolean;
  cache: Cache;
}

type ErrorCallback = (error: unknown, errorInfo: ErrorInfo) => void;

export class FiberRootNode {
  tag: RootTag;
  containerInfo: Container;
  pendingChildren: unknown = null;
  // Set by createFiberRoot right after construction: the root and its host
  // root fiber point at each other.
  current!: Fiber;
  // A Map rather than upstream's WeakMap-when-available: a union of the two
  // has no fixed layout, and entries are deleted when the wakeable pings.
  pingCache: Map<Wakeable, Set<unknown>> | null = null;
  timeoutHandle: TimeoutHandle | NoTimeout = noTimeout;
  cancelPendingCommit: (() => void) | null = null;
  context: object | null = null;
  pendingContext: object | null = null;
  next: FiberRoot | null = null;
  callbackNode: unknown = null;
  callbackPriority: Lane = NoLane;
  expirationTimes: LaneMap<number> = createLaneMap(NoTimestamp);

  pendingLanes: Lanes = NoLanes;
  suspendedLanes: Lanes = NoLanes;
  pingedLanes: Lanes = NoLanes;
  warmLanes: Lanes = NoLanes;
  expiredLanes: Lanes = NoLanes;
  // enableDefaultTransitionIndicator only.
  indicatorLanes: Lanes = NoLanes;
  errorRecoveryDisabledLanes: Lanes = NoLanes;
  shellSuspendCounter = 0;

  entangledLanes: Lanes = NoLanes;
  entanglements: LaneMap<Lanes> = createLaneMap(NoLanes);

  hiddenUpdates: LaneMap<ConcurrentUpdate[] | null> = createLaneMap<ConcurrentUpdate[] | null>(null);

  identifierPrefix: string;
  onUncaughtError: ErrorCallback;
  onCaughtError: ErrorCallback;
  onRecoverableError: ErrorCallback;

  // enableDefaultTransitionIndicator only.
  onDefaultTransitionIndicator: () => void | (() => void);
  pendingIndicator: (() => void) | null = null;

  pooledCache: Cache | null = null;
  pooledCacheLanes: Lanes = NoLanes;

  // enableSuspenseCallback only.
  hydrationCallbacks: null = null;

  formState: unknown;

  // enableViewTransition only.
  transitionTypes: TransitionTypes | null = null;

  // enableGestureTransition only.
  pendingGestures: null = null;
  gestureClone: Instance | null = null;

  incompleteTransitions: Map<Transition, unknown> = new Map();
  // enableTransitionTracing only.
  transitionCallbacks: null = null;
  transitionLanes: LaneMap<Set<Transition> | null> = [];

  // enableProfilerTimer && enableProfilerCommitHooks only.
  effectDuration = -0;
  passiveEffectDuration = -0;

  // enableUpdaterTracking only.
  memoizedUpdaters: Set<Fiber> = new Set();
  pendingUpdatersLaneMap: LaneMap<Set<Fiber>> = [];

  // Development only.
  _debugRootType: string | undefined;

  constructor(
    containerInfo: Container,
    tag: RootTag,
    hydrate: boolean,
    identifierPrefix: string,
    onUncaughtError: ErrorCallback,
    onCaughtError: ErrorCallback,
    onRecoverableError: ErrorCallback,
    onDefaultTransitionIndicator: () => void | (() => void),
    formState: unknown,
  ) {
    this.tag = disableLegacyMode ? ConcurrentRoot : tag;
    this.containerInfo = containerInfo;
    this.identifierPrefix = identifierPrefix;
    this.onUncaughtError = onUncaughtError;
    this.onCaughtError = onCaughtError;
    this.onRecoverableError = onRecoverableError;
    this.onDefaultTransitionIndicator = onDefaultTransitionIndicator;
    this.formState = formState;

    if (enableTransitionTracing) {
      this.transitionLanes = createLaneMap<Set<Transition> | null>(null);
    }

    if (!(enableProfilerTimer && enableProfilerCommitHooks)) {
      this.effectDuration = 0;
      this.passiveEffectDuration = 0;
    }

    if (enableUpdaterTracking) {
      const pendingUpdatersLaneMap: Set<Fiber>[] = (this.pendingUpdatersLaneMap = []);
      for (let i = 0; i < TotalLanes; i++) {
        pendingUpdatersLaneMap.push(new Set());
      }
    }

    if (isDevelopment) {
      if (disableLegacyMode) {
        // TODO: This varies by each renderer.
        this._debugRootType = hydrate ? "hydrateRoot()" : "createRoot()";
      } else {
        switch (tag) {
          case ConcurrentRoot:
            this._debugRootType = hydrate ? "hydrateRoot()" : "createRoot()";
            break;
          case LegacyRoot:
            this._debugRootType = hydrate ? "hydrate()" : "render()";
            break;
        }
      }
    }
  }
}

export function createFiberRoot(
  containerInfo: Container,
  tag: RootTag,
  hydrate: boolean,
  initialChildren: unknown,
  hydrationCallbacks: null,
  isStrictMode: boolean,
  // TODO: We have several of these arguments that are conceptually part of the
  // host config, but because they are passed in at runtime, we have to thread
  // them through the root constructor. Perhaps we should put them all into a
  // single type, like a DynamicHostConfig that is defined by the renderer.
  identifierPrefix: string,
  formState: unknown,
  onUncaughtError: ErrorCallback,
  onCaughtError: ErrorCallback,
  onRecoverableError: ErrorCallback,
  onDefaultTransitionIndicator: () => void | (() => void),
  transitionCallbacks: null,
): FiberRoot {
  const root: FiberRoot = new FiberRootNode(
    containerInfo,
    tag,
    hydrate,
    identifierPrefix,
    onUncaughtError,
    onCaughtError,
    onRecoverableError,
    onDefaultTransitionIndicator,
    formState,
  );
  if (enableSuspenseCallback) {
    root.hydrationCallbacks = hydrationCallbacks;
  }

  if (enableTransitionTracing) {
    root.transitionCallbacks = transitionCallbacks;
  }

  // Cyclic construction: the root and its host root fiber refer to each
  // other.
  const uninitializedFiber = createHostRootFiber(tag, isStrictMode);
  root.current = uninitializedFiber;
  uninitializedFiber.stateNode = root;

  const initialCache = createCache();
  retainCache(initialCache);

  // The pooledCache is a fresh cache instance that is used temporarily
  // for newly mounted boundaries during a render. In general, the
  // pooledCache is always cleared from the root at the end of a render:
  // it is either released when render commits, or moved to an Offscreen
  // component if rendering suspends. Because the lifetime of the pooled
  // cache is distinct from the main memoizedState.cache, it must be
  // retained separately.
  root.pooledCache = initialCache;
  retainCache(initialCache);
  const initialState: RootState = {
    element: initialChildren,
    isDehydrated: hydrate,
    cache: initialCache,
  };
  uninitializedFiber.memoizedState = initialState;

  initializeUpdateQueue(uninitializedFiber);

  return root;
}
