// The reconciler's central types. The fiber and the root are classes
// (FiberNode, FiberRootNode); the rest are the records they point at.
//
// A fiber's `stateNode`, props, `updateQueue` and `memoizedState` hold
// something different for each work tag. Those fields are `unknown` for now
// and projected where the tag is known (ReactFiberStateNode.ts for
// stateNode); they become base-class hierarchies once NTS can downcast (see
// runtime/react/spikes/fiber-state).

import type { ReactContextBase, RefObject } from "shared/ReactTypes.ts";
import type { FiberNode } from "./ReactFiber.ts";
import type { Lanes } from "./ReactFiberLane.ts";
import type { FiberRootNode } from "./ReactFiberRoot.ts";
import type { ThenableState } from "./ReactFiberThenable.ts";

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

// A context a fiber read, and the value it read: a list of contexts of every
// value type, so the value is erased (see shared/ReactContext.ts).
export interface ContextDependency {
  context: ReactContextBase;
  next: ContextDependency | null;
  memoizedValue: unknown;
}

export interface Dependencies {
  lanes: Lanes;
  firstContext: ContextDependency | null;
  // Development only.
  _debugThenableState?: ThenableState | null;
}

// React Compiler's per-fiber caches, one per compiled component or hook in
// call order: upstream's arrays of slots (`useMemoCache`), or a typed record
// (`useMemoCacheOf`). `cloners` copies each typed one on write; an array has
// none and is copied with `slice`, as upstream copies it.
export interface MemoCache {
  data: unknown[];
  cloners: (((cache: unknown) => unknown) | null)[];
  index: number;
}

// A callback ref, or an object ref, as passed in the `ref` prop.
export type RefCallback = (handle: unknown) => (() => void) | void;
export type Ref = RefCallback | RefObject<unknown> | null;

// A Fiber is work on a component that needs to be done or was done. There
// can be more than one per component: the current one and its alternate,
// the work-in-progress.
// The fiber is a class (FiberNode in ReactFiber.ts), not an interface over
// one: its fields are laid out once, as fixed native fields, and every
// reference to a fiber is a reference to that class.
export type Fiber = FiberNode;

export interface ErrorInfo {
  readonly componentStack?: string | null | undefined;
  readonly errorBoundary?: unknown;
}

// Pending work on a root. One per `createRoot`/`createContainer`.
// The root is a class (FiberRootNode in ReactFiberRoot.ts) for the same
// reason as the fiber.
export type FiberRoot = FiberRootNode;

// Re-exported for modules that import the dispatcher types from here, as
// upstream's do.
export type { AsyncDispatcher, Dispatcher } from "shared/ReactTypes.ts";

// Callbacks for dehydrated Suspense boundaries (enableSuspenseCallback, off
// in stable).
export interface SuspenseHydrationCallbacks {
  onHydrated?: (hydrationBoundary: unknown) => void;
  onDeleted?: (hydrationBoundary: unknown) => void;
}

// Transition tracing callbacks (enableTransitionTracing, off in stable).
export interface TransitionTracingCallbacks {
  onTransitionStart?: (transitionName: string, startTime: number) => void;
  onTransitionComplete?: (transitionName: string, startTime: number, endTime: number) => void;
}
