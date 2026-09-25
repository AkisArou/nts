// The shapes React's objects have, shared by `react` and the reconciler.
//
// Where upstream uses Flow's `any`/`mixed` for a genuinely heterogeneous
// value (an element's type, a child, a hook's state), this uses `unknown`,
// and each reader narrows it with a check. Nothing here is `any`.

export type ReactKey = string | null;

// An element's props: whatever the caller passed, keyed by name.
export type Props = { [key: string]: unknown };

export interface ReactElement {
  readonly $$typeof: symbol;
  readonly type: unknown;
  readonly key: ReactKey;
  // Since React 19 `ref` is an ordinary prop; this field mirrors it for
  // readers that still look here. In development it is a warning getter.
  readonly ref: unknown;
  readonly props: Props;
  // Development only.
  _owner?: unknown;
  _store?: { validated: number };
  _debugInfo?: ReactDebugInfo | null;
  _debugStack?: unknown;
  _debugTask?: unknown;
}

export interface ReactPortal {
  readonly $$typeof: symbol;
  readonly key: ReactKey;
  readonly containerInfo: unknown;
  readonly children: unknown;
  readonly implementation: unknown;
}

// Contexts are classes: see ReactContext.ts for why.
import type { ReactContext } from "./ReactContext.ts";
export type { ReactContext, ReactContextBase, ReactContextConsumer } from "./ReactContext.ts";

export interface RefObject<T> {
  current: T;
}

// The subset of a thenable that Suspense needs: something to wait on.
export interface Wakeable {
  then(onFulfill: () => unknown, onReject: () => unknown): unknown;
}

export type ThenableStatus = "pending" | "fulfilled" | "rejected";

// A promise-like value. React records the settled state on the thenable
// itself (`status`, `value`, `reason`) so that a later render can read it
// synchronously; that is observable, and other libraries rely on it.
export interface Thenable<T> {
  then(onFulfill: (value: T) => unknown, onReject: (error: unknown) => unknown): unknown;
  status?: ThenableStatus;
  value?: T;
  reason?: unknown;
  displayName?: string;
  _debugInfo?: ReactDebugInfo | null;
}

export interface FulfilledThenable<T> extends Thenable<T> {
  status: "fulfilled";
  value: T;
}

export interface RejectedThenable<T> extends Thenable<T> {
  status: "rejected";
  reason: unknown;
}

export interface StartTransitionOptions {
  name?: string;
}

export type Usable<T> = Thenable<T> | ReactContext<T>;

export type ReactDebugInfo = unknown[];

export type TransitionTypes = string[];

export interface Transition {
  types: TransitionTypes | null;
  gesture: null;
  name: string | null;
  startTime: number;
  // Development only: the fibers this transition updated, for a warning
  // about subscriptions that update too much.
  _updatedFibers?: Set<unknown>;
}

// A reducer action or a function of the previous state.
export type BasicStateAction<S> = ((previous: S) => S) | S;
export type Dispatch<A> = (action: A) => void;

export type EffectCleanup = () => void;
export type EffectCreate = () => EffectCleanup | void;
export type Dependencies = readonly unknown[] | null | undefined;

/**
 * How a typed memo cache is made and copied (`useMemoCacheOf`): `create`
 * makes one with nothing filled, `clone` copies one for a render that may be
 * interrupted.
 */
export interface MemoCacheShape<T> {
  readonly create: () => T;
  readonly clone: (cache: T) => T;
}

// What `ReactSharedInternals.H` points at while a component renders: one
// implementation per phase (mount, update, rerender, invalid).
export interface Dispatcher {
  use<T>(usable: Usable<T>): T;
  readContext<T>(context: ReactContext<T>): T;
  useCallback<T>(callback: T, deps: Dependencies): T;
  useContext<T>(context: ReactContext<T>): T;
  useEffect(create: EffectCreate, deps: Dependencies): void;
  useEffectEvent<F extends (...args: never[]) => unknown>(callback: F): F;
  useImperativeHandle<T>(
    ref: RefObject<T | null> | ((instance: T | null) => unknown) | null | undefined,
    create: () => T,
    deps: Dependencies,
  ): void;
  useInsertionEffect(create: EffectCreate, deps: Dependencies): void;
  useLayoutEffect(create: EffectCreate, deps: Dependencies): void;
  useMemo<T>(create: () => T, deps: Dependencies): T;
  useReducer<S, I, A>(
    reducer: (state: S, action: A) => S,
    initialArg: I,
    init?: (initialArg: I) => S,
  ): [S, Dispatch<A>];
  useRef<T>(initialValue: T): RefObject<T>;
  useState<S>(initialState: (() => S) | S): [S, Dispatch<BasicStateAction<S>>];
  useDebugValue<T>(value: T, formatterFn?: ((value: T) => unknown) | null): void;
  useDeferredValue<T>(value: T, initialValue?: T): T;
  useTransition(): [boolean, (callback: () => unknown, options?: StartTransitionOptions) => void];
  useSyncExternalStore<T>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T;
  useId(): string;
  useCacheRefresh(): <T>(createSeed?: () => T, seedValue?: T) => void;
  useMemoCache(size: number): unknown[];
  useMemoCacheOf<T>(shape: MemoCacheShape<T>): T;
  useHostTransitionStatus(): unknown;
  useOptimistic<S, A>(
    passthrough: S,
    reducer?: ((state: S, action: A) => S) | null,
  ): [S, (action: A) => void];
  useActionState<S, P>(
    action: (state: Awaited<S>, payload: P) => S,
    initialState: Awaited<S>,
    permalink?: string,
  ): [Awaited<S>, (payload: P) => void, boolean];
}

// What `ReactSharedInternals.A` points at: the cache of the current render.
export interface AsyncDispatcher {
  getCacheForType<T>(resourceType: () => T): T;
  cacheSignal(): AbortSignal | null;
  // Development only.
  getOwner?: () => unknown;
}

// A task queued by `act` instead of the scheduler.
export type RendererTask = (didTimeout: boolean) => RendererTask | null | undefined;

// The state `react` shares with every renderer that uses it. The reconciler
// installs the dispatchers while it renders; the public API reads them.
export interface SharedStateClient {
  H: Dispatcher | null;
  A: AsyncDispatcher | null;
  T: Transition | null;
  S: ((transition: Transition, returnValue: unknown) => void) | null;
  // Development only.
  actQueue: RendererTask[] | null;
  asyncTransitions: number;
  isBatchingLegacy: boolean;
  didScheduleLegacyUpdate: boolean;
  didUsePromise: boolean;
  thrownErrors: unknown[];
  getCurrentStack: (() => string) | null;
  recentlyCreatedOwnerStacks: number;
}

// `React.lazy`: the reconciler calls `_init(_payload)` to get the component,
// which throws the pending thenable until it has loaded.
export interface LazyComponent<T, P> {
  readonly $$typeof: symbol;
  _payload: P;
  _init: (payload: P) => T;
  // Development only.
  _debugInfo?: ReactDebugInfo | null;
  _store?: { validated: 0 | 1 | 2 };
}

// `React.memo`.
export interface MemoComponent {
  readonly $$typeof: symbol;
  readonly type: unknown;
  readonly compare: ((oldProps: Props, newProps: Props) => boolean) | null;
  displayName?: string;
}

// `React.forwardRef`: the render function receives the ref as a second
// argument.
export interface ForwardRefComponent {
  readonly $$typeof: symbol;
  readonly render: (props: Props, ref: unknown) => unknown;
  displayName?: string;
}
