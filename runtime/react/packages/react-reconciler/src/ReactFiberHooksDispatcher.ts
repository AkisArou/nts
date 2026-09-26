// The hook dispatchers of the JavaScript build: the objects React installs
// on `ReactSharedInternals.H` while a component renders, one per phase.
//
// This module is a fork point (imported by package path). The JavaScript
// build keeps upstream's dynamic dispatch, which is observable: tests and
// react-debug-tools install dispatchers of their own. A native build replaces
// it with a twin that records the phase, and `react`'s hooks then call the
// implementations below directly: a virtual call to a generic method such as
// `useState<S>` cannot be monomorphised.

import type {
  BasicStateAction,
  Dependencies as HookDependencies,
  Dispatch,
  Dispatcher,
  EffectCreate,
  ReactContext,
  RefObject,
  Usable,
  MemoCacheShape,
} from "shared/ReactTypes.ts";
import { isDevelopment } from "shared/Build.ts";
import type { HookType } from "./ReactInternalTypes.ts";
import { ReactSharedInternals } from "./ReactSharedInternals.ts";
import { readContext } from "./ReactFiberNewContext.ts";
import {
  checkDepsAreArrayDev,
  mountActionState,
  mountCallback,
  mountDebugValue,
  mountDeferredValue,
  mountEffect,
  mountEvent,
  mountHookTypesDev,
  mountId,
  mountImperativeHandle,
  mountInsertionEffect,
  mountLayoutEffect,
  mountMemo,
  mountOptimistic,
  mountReducer,
  mountRef,
  mountRefresh,
  mountState,
  mountSyncExternalStore,
  mountTransition,
  rerenderActionState,
  rerenderDeferredValue,
  rerenderOptimistic,
  rerenderReducer,
  rerenderState,
  rerenderTransition,
  setCurrentHookNameInDev,
  throwInvalidHookError,
  updateActionState,
  updateCallback,
  updateDebugValue,
  updateDeferredValue,
  updateEffect,
  updateEvent,
  updateHookTypesDev,
  updateId,
  updateImperativeHandle,
  updateInsertionEffect,
  updateLayoutEffect,
  updateMemo,
  updateOptimistic,
  updateReducer,
  updateRef,
  updateRefresh,
  updateState,
  updateSyncExternalStore,
  updateTransition,
  use,
  useHostTransitionStatus,
  useMemoCache,
  useMemoCacheOf,
  warnOnUseFormStateInDev,
  type ImperativeRef,
  type RefreshFunction,
  type StartTransitionFunction,
} from "./ReactFiberHooks.ts";

// The dispatcher as the reconciler builds it: upstream's also has the
// deprecated `useFormState`, which ReactDOM re-exports.
type FiberDispatcher = Dispatcher & {
  useFormState: Dispatcher["useActionState"];
};

// Which dispatcher is installed. Plain numbers, as the work tags are, so
// that a native build records the phase in a field.
export type HookDispatcherKind = number;

export const ContextOnlyKind = 0;
export const MountKind = 1;
export const UpdateKind = 2;
export const RerenderKind = 3;
export const MountInDEVKind = 4;
export const MountWithHookTypesInDEVKind = 5;
export const UpdateInDEVKind = 6;
export const RerenderInDEVKind = 7;
export const InvalidNestedMountInDEVKind = 8;
export const InvalidNestedUpdateInDEVKind = 9;
export const InvalidNestedRerenderInDEVKind = 10;

// What saveDispatcher returns: here, whatever `H` held, which may be a
// dispatcher someone else installed.
export type SavedDispatcher = Dispatcher | null;

// What `ReactSharedInternals.H` holds in this build (shared/ReactTypes.ts
// erases the slot, which a native build leaves null).
function installedDispatcher(): SavedDispatcher {
  return ReactSharedInternals.H as SavedDispatcher;
}

export function installDispatcher(kind: HookDispatcherKind): void {
  ReactSharedInternals.H = dispatcherOf(kind);
}

export function saveDispatcher(): SavedDispatcher {
  return installedDispatcher();
}

export function restoreDispatcher(saved: SavedDispatcher): void {
  ReactSharedInternals.H = saved;
}

// Installs the context-only dispatcher for work outside a component body and
// returns what to restore afterwards. React's isomorphic package has no
// default dispatcher: the first renderer attaches one lazily, so that a hook
// called outside any render gets a useful error.
export function pushContextOnlyDispatcher(): SavedDispatcher {
  const prevDispatcher = installedDispatcher();
  ReactSharedInternals.H = ContextOnlyDispatcher;
  return prevDispatcher === null ? ContextOnlyDispatcher : prevDispatcher;
}

// `useState` through whatever dispatcher is installed: the host transition
// component renders with the update dispatcher, and in development that one
// also records the hook.
export function useStateThroughDispatcher<S>(initialState: (() => S) | S): [S, Dispatch<BasicStateAction<S>>] {
  return (ReactSharedInternals.H as Dispatcher).useState(initialState);
}

function dispatcherOf(kind: HookDispatcherKind): FiberDispatcher | null {
  switch (kind) {
    case ContextOnlyKind:
      return ContextOnlyDispatcher;
    case MountKind:
      return HooksDispatcherOnMount;
    case UpdateKind:
      return HooksDispatcherOnUpdate;
    case RerenderKind:
      return HooksDispatcherOnRerender;
    case MountInDEVKind:
      return HooksDispatcherOnMountInDEV;
    case MountWithHookTypesInDEVKind:
      return HooksDispatcherOnMountWithHookTypesInDEV;
    case UpdateInDEVKind:
      return HooksDispatcherOnUpdateInDEV;
    case RerenderInDEVKind:
      return HooksDispatcherOnRerenderInDEV;
    case InvalidNestedMountInDEVKind:
      return InvalidNestedHooksDispatcherOnMountInDEV;
    case InvalidNestedUpdateInDEVKind:
      return InvalidNestedHooksDispatcherOnUpdateInDEV;
    case InvalidNestedRerenderInDEVKind:
      return InvalidNestedHooksDispatcherOnRerenderInDEV;
    default:
      return null;
  }
}

const ContextOnlyDispatcher: FiberDispatcher = {
  readContext,

  use,
  useCallback: throwInvalidHookError,
  useContext: throwInvalidHookError,
  useEffect: throwInvalidHookError,
  useImperativeHandle: throwInvalidHookError,
  useLayoutEffect: throwInvalidHookError,
  useInsertionEffect: throwInvalidHookError,
  useMemo: throwInvalidHookError,
  useReducer: throwInvalidHookError,
  useRef: throwInvalidHookError,
  useState: throwInvalidHookError,
  useDebugValue: throwInvalidHookError,
  useDeferredValue: throwInvalidHookError,
  useTransition: throwInvalidHookError,
  useSyncExternalStore: throwInvalidHookError,
  useId: throwInvalidHookError,
  useHostTransitionStatus: throwInvalidHookError,
  useFormState: throwInvalidHookError,
  useActionState: throwInvalidHookError,
  useOptimistic: throwInvalidHookError,
  useMemoCache: throwInvalidHookError,
  useMemoCacheOf: throwInvalidHookError,
  useCacheRefresh: throwInvalidHookError,
  useEffectEvent: throwInvalidHookError,
};

const HooksDispatcherOnMount: FiberDispatcher = {
  readContext,

  use,
  useCallback: mountCallback,
  useContext: readContext,
  useEffect: mountEffect,
  useImperativeHandle: mountImperativeHandle,
  useLayoutEffect: mountLayoutEffect,
  useInsertionEffect: mountInsertionEffect,
  useMemo: mountMemo,
  useReducer: mountReducer,
  useRef: mountRef,
  useState: mountState,
  useDebugValue: mountDebugValue,
  useDeferredValue: mountDeferredValue,
  useTransition: mountTransition,
  useSyncExternalStore: mountSyncExternalStore,
  useId: mountId,
  useHostTransitionStatus: useHostTransitionStatus,
  useFormState: mountActionState,
  useActionState: mountActionState,
  useOptimistic: mountOptimistic,
  useMemoCache,
  useMemoCacheOf,
  useCacheRefresh: mountRefresh,
  useEffectEvent: mountEvent,
};

const HooksDispatcherOnUpdate: FiberDispatcher = {
  readContext,

  use,
  useCallback: updateCallback,
  useContext: readContext,
  useEffect: updateEffect,
  useImperativeHandle: updateImperativeHandle,
  useInsertionEffect: updateInsertionEffect,
  useLayoutEffect: updateLayoutEffect,
  useMemo: updateMemo,
  useReducer: updateReducer,
  useRef: updateRef,
  useState: updateState,
  useDebugValue: updateDebugValue,
  useDeferredValue: updateDeferredValue,
  useTransition: updateTransition,
  useSyncExternalStore: updateSyncExternalStore,
  useId: updateId,
  useHostTransitionStatus: useHostTransitionStatus,
  useFormState: updateActionState,
  useActionState: updateActionState,
  useOptimistic: updateOptimistic,
  useMemoCache,
  useMemoCacheOf,
  useCacheRefresh: updateRefresh,
  useEffectEvent: updateEvent,
};

const HooksDispatcherOnRerender: FiberDispatcher = {
  readContext,

  use,
  useCallback: updateCallback,
  useContext: readContext,
  useEffect: updateEffect,
  useImperativeHandle: updateImperativeHandle,
  useInsertionEffect: updateInsertionEffect,
  useLayoutEffect: updateLayoutEffect,
  useMemo: updateMemo,
  useReducer: rerenderReducer,
  useRef: updateRef,
  useState: rerenderState,
  useDebugValue: updateDebugValue,
  useDeferredValue: rerenderDeferredValue,
  useTransition: rerenderTransition,
  useSyncExternalStore: updateSyncExternalStore,
  useId: updateId,
  useHostTransitionStatus: useHostTransitionStatus,
  useFormState: rerenderActionState,
  useActionState: rerenderActionState,
  useOptimistic: rerenderOptimistic,
  useMemoCache,
  useMemoCacheOf,
  useCacheRefresh: updateRefresh,
  useEffectEvent: updateEvent,
};

// Development dispatchers. Upstream spells out seven near-identical tables;
// they differ only along the axes below, so they are built from one
// function. Each hook runs, in upstream's order: record its name, warn if it
// is called inside another hook, record or check the hook order, then
// (mount only) check that deps are an array, and (valid dispatchers only)
// warn about the renamed useFormState.
interface DevDispatcherOptions {
  // The production implementations this dispatcher wraps.
  readonly impls: FiberDispatcher;
  // mountHookTypesDev when mounting, updateHookTypesDev otherwise.
  readonly trackHookType: () => void;
  // Only the plain mount dispatcher checks that deps are arrays.
  readonly checkDeps: boolean;
  // The "invalid nested" dispatchers warn on every hook call (a hook inside
  // useMemo, useReducer or useState's initializer).
  readonly invalid: boolean;
  // The dispatcher installed while running useMemo/useReducer/useState's
  // user functions.
  readonly nested: () => Dispatcher | null;
}

let HooksDispatcherOnMountInDEV: FiberDispatcher | null = null;
let HooksDispatcherOnMountWithHookTypesInDEV: FiberDispatcher | null = null;
let HooksDispatcherOnUpdateInDEV: FiberDispatcher | null = null;
let HooksDispatcherOnRerenderInDEV: FiberDispatcher | null = null;
let InvalidNestedHooksDispatcherOnMountInDEV: FiberDispatcher | null = null;
let InvalidNestedHooksDispatcherOnUpdateInDEV: FiberDispatcher | null = null;
let InvalidNestedHooksDispatcherOnRerenderInDEV: FiberDispatcher | null = null;

function warnInvalidContextAccess(): void {
  console.error(
    "Context can only be read while React is rendering. " +
      "In classes, you can read it in the render method or getDerivedStateFromProps. " +
      "In function components, you can read it directly in the function body, but not " +
      "inside Hooks like useReducer() or useMemo().",
  );
}

function warnInvalidHookAccess(): void {
  console.error(
    "Do not call Hooks inside useEffect(...), useMemo(...), or other built-in Hooks. " +
      "You can only call Hooks at the top level of your React function. " +
      "For more information, see " +
      "https://react.dev/link/rules-of-hooks",
  );
}

function createDevDispatcher(options: DevDispatcherOptions): FiberDispatcher {
  const { impls, trackHookType, checkDeps, invalid, nested } = options;
  // Every hook but useCacheRefresh warns in an invalid dispatcher.
  const enter = (name: HookType): void => {
    setCurrentHookNameInDev(name);
    if (invalid) {
      warnInvalidHookAccess();
    }
    trackHookType();
  };
  const enterWithDeps = (name: HookType, deps: unknown): void => {
    enter(name);
    if (checkDeps) {
      checkDepsAreArrayDev(deps);
    }
  };
  const withNestedDispatcher = <T>(run: () => T): T => {
    const prevDispatcher = ReactSharedInternals.H;
    ReactSharedInternals.H = nested();
    try {
      return run();
    } finally {
      ReactSharedInternals.H = prevDispatcher;
    }
  };
  return {
    readContext<T>(context: ReactContext<T>): T {
      if (invalid) {
        warnInvalidContextAccess();
      }
      return readContext(context);
    },
    use<T>(usable: Usable<T>): T {
      if (invalid) {
        warnInvalidHookAccess();
      }
      return use(usable);
    },
    useCallback<T>(callback: T, deps: HookDependencies): T {
      enterWithDeps("useCallback", deps);
      return impls.useCallback(callback, deps);
    },
    useContext<T>(context: ReactContext<T>): T {
      enter("useContext");
      return readContext(context);
    },
    useEffect(create: EffectCreate, deps: HookDependencies): void {
      enterWithDeps("useEffect", deps);
      return impls.useEffect(create, deps);
    },
    useImperativeHandle<T>(ref: ImperativeRef<T>, create: () => T, deps: HookDependencies): void {
      enterWithDeps("useImperativeHandle", deps);
      return impls.useImperativeHandle(ref, create, deps);
    },
    useInsertionEffect(create: EffectCreate, deps: HookDependencies): void {
      enterWithDeps("useInsertionEffect", deps);
      return impls.useInsertionEffect(create, deps);
    },
    useLayoutEffect(create: EffectCreate, deps: HookDependencies): void {
      enterWithDeps("useLayoutEffect", deps);
      return impls.useLayoutEffect(create, deps);
    },
    useMemo<T>(create: () => T, deps: HookDependencies): T {
      enterWithDeps("useMemo", deps);
      return withNestedDispatcher(() => impls.useMemo(create, deps));
    },
    useReducer<S, I, A>(
      reducer: (state: S, action: A) => S,
      initialArg: I,
      init?: (initialArg: I) => S,
    ): [S, Dispatch<A>] {
      enter("useReducer");
      return withNestedDispatcher(() => impls.useReducer(reducer, initialArg, init));
    },
    useRef<T>(initialValue: T): RefObject<T> {
      enter("useRef");
      return impls.useRef(initialValue);
    },
    useState<S>(initialState: (() => S) | S): [S, Dispatch<BasicStateAction<S>>] {
      enter("useState");
      return withNestedDispatcher(() => impls.useState(initialState));
    },
    useDebugValue<T>(value: T, formatterFn?: ((value: T) => unknown) | null): void {
      enter("useDebugValue");
      return impls.useDebugValue(value, formatterFn);
    },
    useDeferredValue<T>(value: T, initialValue?: T): T {
      enter("useDeferredValue");
      return impls.useDeferredValue(value, initialValue);
    },
    useTransition(): [boolean, StartTransitionFunction] {
      enter("useTransition");
      return impls.useTransition();
    },
    useSyncExternalStore<T>(
      subscribe: (onStoreChange: () => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T,
    ): T {
      enter("useSyncExternalStore");
      return impls.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    },
    useId(): string {
      enter("useId");
      return impls.useId();
    },
    useFormState<S, P>(
      action: (state: Awaited<S>, payload: P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (payload: P) => void, boolean] {
      enter("useFormState");
      if (!invalid) {
        warnOnUseFormStateInDev();
      }
      return impls.useFormState(action, initialState, permalink);
    },
    useActionState<S, P>(
      action: (state: Awaited<S>, payload: P) => S,
      initialState: Awaited<S>,
      permalink?: string,
    ): [Awaited<S>, (payload: P) => void, boolean] {
      enter("useActionState");
      return impls.useActionState(action, initialState, permalink);
    },
    useOptimistic<S, A>(passthrough: S, reducer?: ((state: S, action: A) => S) | null): [S, (action: A) => void] {
      enter("useOptimistic");
      return impls.useOptimistic(passthrough, reducer);
    },
    useHostTransitionStatus,
    useMemoCache(size: number): unknown[] {
      if (invalid) {
        warnInvalidHookAccess();
      }
      return useMemoCache(size);
    },
    useMemoCacheOf<T>(shape: MemoCacheShape<T>): T {
      if (invalid) {
        warnInvalidHookAccess();
      }
      return useMemoCacheOf(shape);
    },
    useCacheRefresh(): RefreshFunction {
      // Upstream records this hook without the invalid-access warning.
      setCurrentHookNameInDev("useCacheRefresh");
      trackHookType();
      return impls.useCacheRefresh();
    },
    useEffectEvent<F extends (...args: never[]) => unknown>(callback: F): F {
      enter("useEffectEvent");
      return impls.useEffectEvent(callback);
    },
  };
}

if (isDevelopment) {
  HooksDispatcherOnMountInDEV = createDevDispatcher({
    impls: HooksDispatcherOnMount,
    trackHookType: mountHookTypesDev,
    checkDeps: true,
    invalid: false,
    nested: () => InvalidNestedHooksDispatcherOnMountInDEV,
  });
  HooksDispatcherOnMountWithHookTypesInDEV = createDevDispatcher({
    impls: HooksDispatcherOnMount,
    trackHookType: updateHookTypesDev,
    checkDeps: false,
    invalid: false,
    nested: () => InvalidNestedHooksDispatcherOnMountInDEV,
  });
  HooksDispatcherOnUpdateInDEV = createDevDispatcher({
    impls: HooksDispatcherOnUpdate,
    trackHookType: updateHookTypesDev,
    checkDeps: false,
    invalid: false,
    nested: () => InvalidNestedHooksDispatcherOnUpdateInDEV,
  });
  HooksDispatcherOnRerenderInDEV = createDevDispatcher({
    impls: HooksDispatcherOnRerender,
    trackHookType: updateHookTypesDev,
    checkDeps: false,
    invalid: false,
    nested: () => InvalidNestedHooksDispatcherOnRerenderInDEV,
  });
  InvalidNestedHooksDispatcherOnMountInDEV = createDevDispatcher({
    impls: HooksDispatcherOnMount,
    trackHookType: mountHookTypesDev,
    checkDeps: false,
    invalid: true,
    nested: () => InvalidNestedHooksDispatcherOnMountInDEV,
  });
  InvalidNestedHooksDispatcherOnUpdateInDEV = createDevDispatcher({
    impls: HooksDispatcherOnUpdate,
    trackHookType: updateHookTypesDev,
    checkDeps: false,
    invalid: true,
    nested: () => InvalidNestedHooksDispatcherOnUpdateInDEV,
  });
  InvalidNestedHooksDispatcherOnRerenderInDEV = createDevDispatcher({
    impls: HooksDispatcherOnRerender,
    trackHookType: updateHookTypesDev,
    checkDeps: false,
    invalid: true,
    // Upstream nests into the update dispatcher here, not the rerender one.
    nested: () => InvalidNestedHooksDispatcherOnUpdateInDEV,
  });
}
