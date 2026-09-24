// The reconciler's central data structures: the fiber and the fiber root.
//
// A fiber's `type`, `stateNode`, props, `updateQueue` and `memoizedState`
// hold something different for each work tag: hooks for a function
// component, an instance and its state for a class, a host instance for a
// host component. They are `unknown` here, and the code handling each tag
// projects them to that tag's type. This is the correct, erased baseline;
// per-component typed layouts come later, behind proofs (see README.md).

import type { ReactContext, ReactDebugInfo, ReactKey, RefObject, Transition, TransitionTypes, Wakeable } from "shared/ReactTypes.ts";
import type { Cache } from "./ReactFiberCacheComponent.ts";
import type { ConcurrentUpdate } from "./ReactFiberConcurrentUpdates.ts";
import type { Container, Instance, NoTimeout, TimeoutHandle } from "./ReactFiberConfig.ts";
import type { Flags } from "./ReactFiberFlags.ts";
import type { Lane, LaneMap, Lanes } from "./ReactFiberLane.ts";
import type { ThenableState } from "./ReactFiberThenable.ts";
import type { RootTag } from "./ReactRootTags.ts";
import type { TypeOfMode } from "./ReactTypeOfMode.ts";
import type { WorkTag } from "./ReactWorkTags.ts";

export type HookType =
  | "useState"
  | "useReducer"
  | "useContext"
  | "useRef"
  | "useEffect"
  | "useEffectEvent"
  | "useInsertionEffect"
  | "useLayoutEffect"
  | "useCallback"
  | "useMemo"
  | "useImperativeHandle"
  | "useDebugValue"
  | "useDeferredValue"
  | "useTransition"
  | "useSyncExternalStore"
  | "useId"
  | "useCacheRefresh"
  | "useOptimistic"
  | "useFormState"
  | "useActionState";

export interface ContextDependency<T> {
  context: ReactContext<T>;
  next: ContextDependency<unknown> | null;
  memoizedValue: T;
}

export interface Dependencies {
  lanes: Lanes;
  firstContext: ContextDependency<unknown> | null;
  // Development only.
  _debugThenableState?: ThenableState | null;
}

// React Compiler's per-fiber caches (`useMemoCache`).
export interface MemoCache {
  data: unknown[][];
  index: number;
}

// A callback ref, or an object ref, as passed in the `ref` prop.
export type RefCallback = (handle: unknown) => (() => void) | void;
export type Ref = RefCallback | RefObject<unknown> | null;

// A Fiber is work on a component that needs to be done or was done. There
// can be more than one per component: the current one and its alternate,
// the work-in-progress.
export interface Fiber {
  // Tag identifying the type of fiber.
  tag: WorkTag;
  // Unique identifier of this child among its siblings.
  key: ReactKey;
  // The value of element.type, which preserves identity during
  // reconciliation of this child.
  elementType: unknown;
  // The resolved function, class or string associated with this fiber.
  type: unknown;
  // The local state associated with this fiber: a host instance, a class
  // instance, the fiber root, or tag-specific state.
  stateNode: unknown;

  // The fiber to return to after finishing this one: effectively the parent.
  return: Fiber | null;
  // Singly linked list tree structure.
  child: Fiber | null;
  sibling: Fiber | null;
  index: number;

  // The ref last used to attach this node.
  ref: Ref;
  refCleanup: (() => void) | null;

  // Input: the props this fiber is rendering with.
  pendingProps: unknown;
  // The props used to create the output.
  memoizedProps: unknown;
  // A queue of state updates and callbacks.
  updateQueue: unknown;
  // The state used to create the output.
  memoizedState: unknown;
  // Contexts and events this fiber depends on, if any.
  dependencies: Dependencies | null;

  // Inherited from the parent when the fiber is created; fixed afterwards.
  mode: TypeOfMode;

  // Effects.
  flags: Flags;
  subtreeFlags: Flags;
  deletions: Fiber[] | null;

  lanes: Lanes;
  childLanes: Lanes;

  // The pooled other version of this fiber: current <-> work in progress.
  alternate: Fiber | null;

  // Profiler timings, only kept in profiling builds.
  actualDuration: number;
  actualStartTime: number;
  selfBaseDuration: number;
  treeBaseDuration: number;

  // Development only.
  _debugInfo: ReactDebugInfo | null;
  _debugOwner: Fiber | null;
  _debugStack: unknown;
  _debugTask: unknown;
  _debugNeedsRemount: boolean;
  // Used to verify that the order of hooks does not change between renders.
  _debugHookTypes: HookType[] | null;
}

export interface ErrorInfo {
  readonly componentStack?: string | null | undefined;
  readonly errorBoundary?: unknown;
}

// Pending work on a root. One per `createRoot`/`createContainer`.
export interface FiberRoot {
  // The type of root (legacy or concurrent).
  tag: RootTag;
  // Any additional information from the host associated with this root.
  containerInfo: Container;
  // Used only by persistent updates.
  pendingChildren: unknown;
  // The currently committed root fiber: the mutable root of the tree.
  current: Fiber;

  pingCache: WeakMap<Wakeable, Set<unknown>> | Map<Wakeable, Set<unknown>> | null;

  // Handle of a pending timeout, to cancel it if a new one supersedes it.
  timeoutHandle: TimeoutHandle | NoTimeout;
  // Cancels a commit that is waiting to happen, if there is one.
  cancelPendingCommit: (() => void) | null;
  // Top context object (legacy context), used by renderSubtreeIntoContainer.
  context: object | null;
  pendingContext: object | null;

  // Linked list of all roots with pending work.
  next: FiberRoot | null;

  // The scheduler task working on this root, and its priority.
  callbackNode: unknown;
  callbackPriority: Lane;
  expirationTimes: LaneMap<number>;
  hiddenUpdates: LaneMap<ConcurrentUpdate[] | null>;

  pendingLanes: Lanes;
  suspendedLanes: Lanes;
  pingedLanes: Lanes;
  warmLanes: Lanes;
  expiredLanes: Lanes;
  indicatorLanes: Lanes;
  errorRecoveryDisabledLanes: Lanes;
  shellSuspendCounter: number;

  entangledLanes: Lanes;
  entanglements: LaneMap<Lanes>;

  pooledCache: Cache | null;
  pooledCacheLanes: Lanes;

  // Prefix for the ids `useId` generates.
  identifierPrefix: string;

  onUncaughtError: (error: unknown, errorInfo: ErrorInfo) => void;
  onCaughtError: (error: unknown, errorInfo: ErrorInfo) => void;
  onRecoverableError: (error: unknown, errorInfo: ErrorInfo) => void;

  // enableDefaultTransitionIndicator only.
  onDefaultTransitionIndicator: () => void | (() => void);
  pendingIndicator: (() => void) | null;

  formState: unknown;

  // enableViewTransition only.
  transitionTypes: TransitionTypes | null;
  // enableGestureTransition only.
  pendingGestures: null;
  gestureClone: Instance | null;

  // enableSuspenseCallback only.
  hydrationCallbacks: null;

  // Profiling builds: which fibers scheduled a given commit, for DevTools.
  memoizedUpdaters: Set<Fiber>;
  pendingUpdatersLaneMap: LaneMap<Set<Fiber>>;

  // enableTransitionTracing only.
  transitionCallbacks: null;
  transitionLanes: LaneMap<Set<Transition> | null>;
  incompleteTransitions: Map<Transition, unknown>;

  // Profiling builds: commit hook durations.
  effectDuration: number;
  passiveEffectDuration: number;
}

// Re-exported for modules that import the dispatcher types from here, as
// upstream's do.
export type { AsyncDispatcher, Dispatcher } from "shared/ReactTypes.ts";
