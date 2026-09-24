// The public hooks. Each forwards to the dispatcher the reconciler installs
// for the component rendering now; outside a render there is none.

import { isDevelopment } from "shared/Build.ts";
import { REACT_CONSUMER_TYPE } from "shared/ReactSymbols.ts";
import type {
  BasicStateAction,
  Dependencies,
  Dispatch,
  Dispatcher,
  EffectCreate,
  ReactContext,
  RefObject,
  StartTransitionOptions,
  Usable,
} from "shared/ReactTypes.ts";
import { ReactSharedInternals } from "./ReactSharedInternals.ts";

function resolveDispatcher(): Dispatcher {
  const dispatcher = ReactSharedInternals.H;
  if (isDevelopment && dispatcher === null) {
    console.error(
      "Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for" +
        " one of the following reasons:\n" +
        "1. You might have mismatching versions of React and the renderer (such as React DOM)\n" +
        "2. You might be breaking the Rules of Hooks\n" +
        "3. You might have more than one copy of React in the same app\n" +
        "See https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem.",
    );
  }
  // Outside a render this is null, and the call below throws a TypeError, as
  // upstream's does: that is the documented failure.
  return dispatcher as Dispatcher;
}

export function getCacheForType<T>(resourceType: () => T): T {
  const dispatcher = ReactSharedInternals.A;
  if (!dispatcher) {
    // No cache outside a render: every call creates a new value.
    return resourceType();
  }
  return dispatcher.getCacheForType(resourceType);
}

export function useContext<T>(Context: ReactContext<T>): T {
  const dispatcher = resolveDispatcher();
  if (isDevelopment && Context.$$typeof === REACT_CONSUMER_TYPE) {
    console.error(
      "Calling useContext(Context.Consumer) is not supported and will cause bugs. " +
        "Did you mean to call useContext(Context) instead?",
    );
  }
  return dispatcher.useContext(Context);
}

export function useState<S>(initialState: (() => S) | S): [S, Dispatch<BasicStateAction<S>>] {
  return resolveDispatcher().useState(initialState);
}

export function useReducer<S, I, A>(
  reducer: (state: S, action: A) => S,
  initialArg: I,
  init?: (initialArg: I) => S,
): [S, Dispatch<A>] {
  return resolveDispatcher().useReducer(reducer, initialArg, init);
}

export function useRef<T>(initialValue: T): RefObject<T> {
  return resolveDispatcher().useRef(initialValue);
}

function warnIfMissingCreate(create: unknown, hookName: string): void {
  if (isDevelopment && create == null) {
    console.warn(
      "React Hook %s requires an effect callback. Did you forget to pass a callback to the hook?",
      hookName,
    );
  }
}

export function useEffect(create: EffectCreate, deps?: Dependencies): void {
  warnIfMissingCreate(create, "useEffect");
  resolveDispatcher().useEffect(create, deps);
}

export function useInsertionEffect(create: EffectCreate, deps?: Dependencies): void {
  warnIfMissingCreate(create, "useInsertionEffect");
  resolveDispatcher().useInsertionEffect(create, deps);
}

export function useLayoutEffect(create: EffectCreate, deps?: Dependencies): void {
  warnIfMissingCreate(create, "useLayoutEffect");
  resolveDispatcher().useLayoutEffect(create, deps);
}

export function useCallback<T>(callback: T, deps: Dependencies): T {
  return resolveDispatcher().useCallback(callback, deps);
}

export function useMemo<T>(create: () => T, deps: Dependencies): T {
  return resolveDispatcher().useMemo(create, deps);
}

export function useImperativeHandle<T>(
  ref: RefObject<T | null> | ((instance: T | null) => unknown) | null | undefined,
  create: () => T,
  deps?: Dependencies,
): void {
  resolveDispatcher().useImperativeHandle(ref, create, deps);
}

export function useDebugValue<T>(value: T, formatterFn?: ((value: T) => unknown) | null): void {
  if (isDevelopment) {
    resolveDispatcher().useDebugValue(value, formatterFn);
  }
}

export function useTransition(): [boolean, (callback: () => unknown, options?: StartTransitionOptions) => void] {
  return resolveDispatcher().useTransition();
}

export function useDeferredValue<T>(value: T, initialValue?: T): T {
  return resolveDispatcher().useDeferredValue(value, initialValue);
}

export function useId(): string {
  return resolveDispatcher().useId();
}

export function useSyncExternalStore<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T,
): T {
  return resolveDispatcher().useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useCacheRefresh(): <T>(createSeed?: () => T, seedValue?: T) => void {
  return resolveDispatcher().useCacheRefresh();
}

export function use<T>(usable: Usable<T>): T {
  return resolveDispatcher().use(usable);
}

// React Compiler's `c`: a cache of `size` slots owned by the rendering
// component.
export function useMemoCache(size: number): unknown[] {
  return resolveDispatcher().useMemoCache(size);
}

export function useEffectEvent<F extends (...args: never[]) => unknown>(callback: F): F {
  return resolveDispatcher().useEffectEvent(callback);
}

export function useOptimistic<S, A>(
  passthrough: S,
  reducer?: ((state: S, action: A) => S) | null,
): [S, (action: A) => void] {
  return resolveDispatcher().useOptimistic(passthrough, reducer);
}

export function useActionState<S, P>(
  action: (state: Awaited<S>, payload: P) => S,
  initialState: Awaited<S>,
  permalink?: string,
): [Awaited<S>, (payload: P) => void, boolean] {
  return resolveDispatcher().useActionState(action, initialState, permalink);
}
