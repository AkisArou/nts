// The native twin of `react`'s ReactHooks.ts: the public hooks with static
// dispatch. Instead of calling a method on the installed dispatcher object,
// each hook switches on the phase the reconciler recorded and calls that
// phase's implementation directly, as upstream's dispatcher tables map them.
// A generic hook such as `useState<S>` is then an ordinary generic call,
// specialised per `S`.

import type {
  BasicStateAction,
  Dependencies,
  Dispatch,
  EffectCreate,
  ReactContext,
  RefObject,
  StartTransitionOptions,
  Usable,
  MemoCacheShape,
} from "shared/ReactTypes.ts";
import { ReactSharedInternals } from "react/ReactSharedInternalsClient.ts";
import { getCacheForType as getCacheForTypeInRender } from "react-reconciler/ReactFiberAsyncDispatcher.ts";
import { readContext } from "react-reconciler/ReactFiberNewContext.ts";
import {
  mountActionState,
  mountCallback,
  mountDeferredValue,
  mountEffect,
  mountEvent,
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
  throwInvalidHookError,
  updateActionState,
  updateCallback,
  updateDeferredValue,
  updateEffect,
  updateEvent,
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
  use as useInRender,
  useMemoCache as useMemoCacheInRender,
  useMemoCacheOf as useMemoCacheOfInRender,
} from "react-reconciler/ReactFiberHooks.ts";
import {
  currentDispatcherKind,
  InvalidNestedMountInDEVKind,
  InvalidNestedRerenderInDEVKind,
  InvalidNestedUpdateInDEVKind,
  MountKind,
  MountInDEVKind,
  MountWithHookTypesInDEVKind,
  RerenderKind,
  RerenderInDEVKind,
  UpdateKind,
  UpdateInDEVKind,
} from "react-reconciler/ReactFiberHooksDispatcher.ts";

// The phase a hook runs in. Outside means no component is rendering: only
// readContext and use are allowed then, as upstream's ContextOnlyKind.
const Outside = 0;
const Mount = 1;
const Update = 2;
const Rerender = 3;

function phase(): number {
  switch (currentDispatcherKind()) {
    case MountKind:
    case MountInDEVKind:
    case MountWithHookTypesInDEVKind:
    case InvalidNestedMountInDEVKind:
      return Mount;
    case UpdateKind:
    case UpdateInDEVKind:
    case InvalidNestedUpdateInDEVKind:
      return Update;
    case RerenderKind:
    case RerenderInDEVKind:
    case InvalidNestedRerenderInDEVKind:
      return Rerender;
    default:
      return Outside;
  }
}

export function getCacheForType<T>(resourceType: () => T): T {
  if (ReactSharedInternals.A === null) {
    // No cache outside a render: every call creates a new value.
    return resourceType();
  }
  return getCacheForTypeInRender(resourceType);
}

export function useContext<T>(context: ReactContext<T>): T {
  if (phase() === Outside) {
    throwInvalidHookError();
  }
  return readContext(context);
}

export function useState<S>(initialState: (() => S) | S): [S, Dispatch<BasicStateAction<S>>] {
  switch (phase()) {
    case Mount:
      return mountState(initialState);
    case Update:
      return updateState(initialState);
    case Rerender:
      return rerenderState(initialState);
    default:
      throwInvalidHookError();
  }
}

export function useReducer<S, I, A>(
  reducer: (state: S, action: A) => S,
  initialArg: I,
  init?: (initialArg: I) => S,
): [S, Dispatch<A>] {
  switch (phase()) {
    case Mount:
      return mountReducer(reducer, initialArg, init);
    case Update:
      return updateReducer(reducer, initialArg, init);
    case Rerender:
      return rerenderReducer(reducer, initialArg, init);
    default:
      throwInvalidHookError();
  }
}

export function useRef<T>(initialValue: T): RefObject<T> {
  switch (phase()) {
    case Mount:
      return mountRef(initialValue);
    case Update:
    case Rerender:
      return updateRef(initialValue);
    default:
      throwInvalidHookError();
  }
}

export function useEffect(create: EffectCreate, deps?: Dependencies): void {
  switch (phase()) {
    case Mount:
      mountEffect(create, deps);
      return;
    case Update:
    case Rerender:
      updateEffect(create, deps);
      return;
    default:
      throwInvalidHookError();
  }
}

export function useInsertionEffect(create: EffectCreate, deps?: Dependencies): void {
  switch (phase()) {
    case Mount:
      mountInsertionEffect(create, deps);
      return;
    case Update:
    case Rerender:
      updateInsertionEffect(create, deps);
      return;
    default:
      throwInvalidHookError();
  }
}

export function useLayoutEffect(create: EffectCreate, deps?: Dependencies): void {
  switch (phase()) {
    case Mount:
      mountLayoutEffect(create, deps);
      return;
    case Update:
    case Rerender:
      updateLayoutEffect(create, deps);
      return;
    default:
      throwInvalidHookError();
  }
}

export function useCallback<T>(callback: T, deps: Dependencies): T {
  switch (phase()) {
    case Mount:
      return mountCallback(callback, deps);
    case Update:
    case Rerender:
      return updateCallback(callback, deps);
    default:
      throwInvalidHookError();
  }
}

export function useMemo<T>(create: () => T, deps: Dependencies): T {
  switch (phase()) {
    case Mount:
      return mountMemo(create, deps);
    case Update:
    case Rerender:
      return updateMemo(create, deps);
    default:
      throwInvalidHookError();
  }
}

export function useImperativeHandle<T>(
  ref: RefObject<T | null> | ((instance: T | null) => unknown) | null | undefined,
  create: () => T,
  deps?: Dependencies,
): void {
  switch (phase()) {
    case Mount:
      mountImperativeHandle(ref, create, deps);
      return;
    case Update:
    case Rerender:
      updateImperativeHandle(ref, create, deps);
      return;
    default:
      throwInvalidHookError();
  }
}

// Development only upstream; a native build is a production build.
export function useDebugValue<T>(_value: T, _formatterFn?: ((value: T) => unknown) | null): void {}

export function useTransition(): [boolean, (callback: () => unknown, options?: StartTransitionOptions) => void] {
  switch (phase()) {
    case Mount:
      return mountTransition();
    case Update:
      return updateTransition();
    case Rerender:
      return rerenderTransition();
    default:
      throwInvalidHookError();
  }
}

export function useDeferredValue<T>(value: T, initialValue?: T): T {
  switch (phase()) {
    case Mount:
      return mountDeferredValue(value, initialValue);
    case Update:
      return updateDeferredValue(value, initialValue);
    case Rerender:
      return rerenderDeferredValue(value, initialValue);
    default:
      throwInvalidHookError();
  }
}

export function useId(): string {
  switch (phase()) {
    case Mount:
      return mountId();
    case Update:
    case Rerender:
      return updateId();
    default:
      throwInvalidHookError();
  }
}

export function useSyncExternalStore<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T,
): T {
  switch (phase()) {
    case Mount:
      return mountSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    case Update:
    case Rerender:
      return updateSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    default:
      throwInvalidHookError();
  }
}

export function useCacheRefresh(): <T>(createSeed?: () => T, seedValue?: T) => void {
  switch (phase()) {
    case Mount:
      return mountRefresh();
    case Update:
    case Rerender:
      return updateRefresh();
    default:
      throwInvalidHookError();
  }
}

export function use<T>(usable: Usable<T>): T {
  return useInRender(usable);
}

export function useMemoCache(size: number): unknown[] {
  if (phase() === Outside) {
    throwInvalidHookError();
  }
  return useMemoCacheInRender(size);
}

export function useMemoCacheOf<T>(shape: MemoCacheShape<T>): T {
  if (phase() === Outside) {
    throwInvalidHookError();
  }
  return useMemoCacheOfInRender(shape);
}

export function useEffectEvent<F extends (...args: never[]) => unknown>(callback: F): F {
  switch (phase()) {
    case Mount:
      return mountEvent(callback);
    case Update:
    case Rerender:
      return updateEvent(callback);
    default:
      throwInvalidHookError();
  }
}

export function useOptimistic<S, A>(
  passthrough: S,
  reducer?: ((state: S, action: A) => S) | null,
): [S, (action: A) => void] {
  switch (phase()) {
    case Mount:
      return mountOptimistic(passthrough, reducer);
    case Update:
      return updateOptimistic(passthrough, reducer);
    case Rerender:
      return rerenderOptimistic(passthrough, reducer);
    default:
      throwInvalidHookError();
  }
}

export function useActionState<S, P>(
  action: (state: Awaited<S>, payload: P) => S,
  initialState: Awaited<S>,
  permalink?: string,
): [Awaited<S>, (payload: P) => void, boolean] {
  switch (phase()) {
    case Mount:
      return mountActionState(action, initialState, permalink);
    case Update:
      return updateActionState(action, initialState, permalink);
    case Rerender:
      return rerenderActionState(action, initialState, permalink);
    default:
      throwInvalidHookError();
  }
}
