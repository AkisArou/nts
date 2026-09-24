declare const __DEV__: false;
declare const __EXPERIMENTAL__: true;
declare const __PROFILE__: false;
declare const __TEST__: false;

// Development act warnings probe these host/test globals with typeof before
// reading them. The declarations add no runtime binding.
declare const IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
declare const jest: unknown;

// Scheduler probes this optional host capability before selecting its task
// transport. Native providers may omit it and use MessageChannel or timers.
declare const setImmediate: ((callback: () => void) => void) | undefined;
declare const process:
  | {
      emit(event: 'uncaughtException', error: unknown): boolean;
    }
  | undefined;

// enqueueTask deliberately probes CommonJS through a computed property so
// bundlers do not include a Node polyfill. Referencing this declaration still
// throws at runtime when `module` is absent, and that probe is caught upstream.
interface ReactNodeRequire {
  (specifier: 'timers'): {
    setImmediate(callback: () => void): void;
  };
}
declare const module:
  | {
      readonly [property: string]: ReactNodeRequire | undefined;
    }
  | undefined;

// React's Flow environment supplies this interface outside package sources.
interface ConsoleTask {
  run<Value>(function_: () => Value): Value;
}

interface Console {
  createTask?: (name: string) => ConsoleTask;
}

interface ErrorConstructor {
  stackTraceLimit?: number;
}

// The first profile uses browser-style numeric scheduler timeout handles.
type TimeoutID = number;

// DefaultPrepareStackTrace only carries these opaquely in this profile.
interface CallSite {}

// Chromium DevTools accepts timing metadata beyond the one-argument DOM
// signature. React emits this form only from its performance-track module.
interface Console {
  timeStamp(
    label: string,
    startTime: number,
    endTime: number,
    trackName: string,
    trackGroup: string | undefined,
    color: string,
  ): void;
}

type ReactNamedFunction = Function & {displayName?: string};
interface ReactErrorConstructor extends ErrorConstructor {
  prepareStackTrace?: (error: Error, callSites: CallSite[]) => string;
}

interface ReactTrackedThenableObject {
  readonly status?: string;
  readonly value?: ReactValue;
  readonly reason?: ReactValue;
}

type ReactDebugThenable<Value> = Promise<Value> & {
  status?: string;
  value?: Value;
  reason?: unknown;
};

interface ReactThenableObject {
  then(
    onFulfill: (value: ReactValue) => unknown,
    onReject: (error: unknown) => unknown,
  ): unknown;
}

// TypeScript's checked spelling for a value carried across a genuinely
// heterogeneous React boundary. NTS must lower this name to its checked erased
// representation; consumers must narrow or project it before inspection.
type ReactValue = unknown;

interface ReactLegacyContext {
  readonly [key: string]: ReactValue;
}
declare const NTSReactOptimisticKey: unique symbol;
type ReactComponentCallback = (() => void) | null | undefined;
type ReactDevToolsRendererID = number | null;

type ReactJSXKeyInput =
  | string
  | number
  | bigint
  | boolean
  | typeof NTSReactOptimisticKey
  | null
  | undefined;
type ReactJSXStoredKey = string | typeof NTSReactOptimisticKey | null;

interface ReactJSXProps {
  key?: ReactJSXKeyInput;
  ref?: ReactValue;
  children?: ReactValue;
  [name: string]: ReactValue;
}

type ReactJSXCallableType =
  | ((props: ReactJSXProps) => React$Node)
  | (new (props: ReactJSXProps) => ReactBaseComponentInstance);

type ReactJSXType = (
  | string
  | symbol
  | ReactJSXCallableType
  | {readonly $$typeof?: symbol}
) & {
  readonly $$typeof?: symbol;
  readonly defaultProps?: ReactJSXProps;
  displayName?: string;
  readonly name?: string;
};

interface ReactJSXElementRecord extends React$Element<ReactJSXType> {
  readonly $$typeof: symbol;
  readonly type: ReactJSXType;
  readonly key: ReactJSXStoredKey;
  readonly ref?: ReactValue;
  readonly props: ReactJSXProps;
  readonly _owner?: ReactValue;
  _store?: {validated?: 0 | 1 | 2};
  _debugInfo?: ReactValue;
  readonly _debugStack?: Error | null;
  readonly _debugTask?: ConsoleTask | null;
}

interface ReactLazyInspectable<
  Payload = ReactTrackedThenableObject,
  Result = ReactValue,
> {
  readonly $$typeof?: symbol | number;
  readonly _payload: Payload;
  readonly _init: (payload: Payload) => Result;
  _store?: {validated?: 0 | 1 | 2};
}

interface ReactChildInspectable {
  readonly $$typeof?: symbol | number;
  readonly type?: ReactJSXType;
  readonly key?: ReactJSXStoredKey;
  readonly props?: ReactJSXProps;
  readonly _debugInfo?: ReactValue;
  readonly then?: ReactValue;
  readonly [Symbol.asyncIterator]?: () => AsyncIterator<ReactValue>;
}

interface ReactPortalStateNodeLike {
  readonly containerInfo: ReactValue;
  readonly implementation: ReactValue;
}

type ReactJSXInspectable =
  | (object & {readonly $$typeof?: symbol})
  | ((...arguments_: never[]) => unknown)
  | string
  | number
  | bigint
  | boolean
  | symbol
  | null
  | undefined;

interface ReactDevToolsHook {
  isDisabled?: boolean;
  supportsFiber?: boolean;
  checkDCE?: boolean;
  inject(internals: ReactValue): number;
  onScheduleFiberRoot?(
    rendererID: ReactDevToolsRendererID,
    root: ReactValue,
    children: ReactValue,
  ): void;
  onCommitFiberRoot?(
    rendererID: ReactDevToolsRendererID,
    root: ReactValue,
    schedulerPriority: number | undefined,
    didError: boolean,
  ): void;
  onPostCommitFiberRoot?(
    rendererID: ReactDevToolsRendererID,
    root: ReactValue,
  ): void;
  onCommitFiberUnmount?(
    rendererID: ReactDevToolsRendererID,
    fiber: ReactValue,
  ): void;
  setStrictMode?(
    rendererID: ReactDevToolsRendererID,
    isStrictMode: boolean,
  ): void;
}

interface ReactComponentUpdater {
  enqueueSetState(
    publicInstance: ReactBaseComponentInstance,
    partialState: ReactValue,
    callback: ReactComponentCallback,
    callerName?: string,
  ): void;
  enqueueForceUpdate(
    publicInstance: ReactBaseComponentInstance,
    callback: ReactComponentCallback,
    callerName?: string,
  ): void;
}

interface ReactNoopUpdateQueueContract extends ReactComponentUpdater {
  isMounted(publicInstance: ReactBaseComponentInstance): boolean;
  enqueueReplaceState(
    publicInstance: ReactBaseComponentInstance,
    completeState: ReactValue,
    callback: ReactComponentCallback,
    callerName?: string,
  ): void;
}

interface ReactClassComponentUpdaterContract extends ReactComponentUpdater {
  enqueueReplaceState(
    publicInstance: ReactBaseComponentInstance,
    completeState: ReactValue,
    callback: ReactComponentCallback,
    callerName?: string,
  ): void;
}

interface ReactBaseComponentInstance {
  constructor: {
    displayName?: string;
    readonly name: string;
  };
  props: ReactValue;
  context: ReactValue;
  refs: object;
  updater: ReactComponentUpdater;
}

interface ReactClassProps {
  ref?: ReactValue;
  [name: string]: ReactValue;
}

interface ReactClassContext<Value> {
  $$typeof: symbol | number;
  Consumer: {
    $$typeof: symbol | number;
    _context: ReactClassContext<Value>;
  };
  Provider: ReactClassContext<Value>;
  _currentValue: Value;
  _currentValue2: Value;
  _threadCount: number;
  _currentRenderer?: ReactValue | null;
  _currentRenderer2?: ReactValue | null;
  displayName?: string;
}

type ReactLegacyApprovedMethod = (() => ReactValue) & {
  isReactClassApproved?: boolean;
};

interface ReactClassInstance<Internal = ReactValue>
  extends ReactBaseComponentInstance {
  _reactInternals: Internal;
  _reactInternalInstance?: ReactValue;
  __reactInternalMemoizedUnmaskedChildContext?: ReactLegacyContext;
  __reactInternalMemoizedMaskedChildContext?: ReactLegacyContext;
  __reactInternalMemoizedMergedChildContext?: ReactLegacyContext;
  state: ReactValue;
  render(): ReactValue;
  shouldComponentUpdate?(
    nextProps: ReactClassProps,
    nextState: ReactValue,
    nextContext: ReactValue,
  ): boolean;
  componentWillMount?: (() => void) & {
    __suppressDeprecationWarning?: boolean;
  };
  UNSAFE_componentWillMount?(): void;
  componentWillReceiveProps?: ((
    nextProps: ReactClassProps,
    nextContext: ReactValue,
  ) => void) & {
    __suppressDeprecationWarning?: boolean;
  };
  componentWillRecieveProps?(
    nextProps: ReactClassProps,
    nextContext: ReactValue,
  ): void;
  UNSAFE_componentWillReceiveProps?(
    nextProps: ReactClassProps,
    nextContext: ReactValue,
  ): void;
  UNSAFE_componentWillRecieveProps?(
    nextProps: ReactClassProps,
    nextContext: ReactValue,
  ): void;
  componentWillUpdate?: ((
    nextProps: ReactClassProps,
    nextState: ReactValue,
    nextContext: ReactValue,
  ) => void) & {
    __suppressDeprecationWarning?: boolean;
  };
  UNSAFE_componentWillUpdate?(
    nextProps: ReactClassProps,
    nextState: ReactValue,
    nextContext: ReactValue,
  ): void;
  componentDidMount?(): void;
  componentWillUnmount?(): void;
  componentDidUpdate?(
    previousProps: ReactClassProps,
    previousState: ReactValue,
    snapshot?: ReactValue,
  ): void;
  getSnapshotBeforeUpdate?(
    previousProps: ReactClassProps,
    previousState: ReactValue,
  ): ReactValue;
  getChildContext?(): ReactLegacyContext;
  getInitialState?: ReactLegacyApprovedMethod;
  getDefaultProps?: ReactLegacyApprovedMethod;
  contextType?: ReactValue;
  contextTypes?: ReactValue;
  defaultProps?: ReactClassProps;
  getDerivedStateFromProps?: ReactValue;
  getDerivedStateFromError?: ReactValue;
  componentDidCatch?(
    error: unknown,
    errorInfo: {componentStack: string},
  ): void;
  componentDidReceiveProps?: ReactValue;
  componentDidUnmount?: ReactValue;
  componentShouldUpdate?: ReactValue;
}

interface ReactClassConstructor<
  Instance extends ReactClassInstance = ReactClassInstance,
> extends Function {
  displayName?: string;
  new (props: ReactClassProps, context: ReactValue): Instance;
  readonly prototype: Instance & {isPureReactComponent?: boolean};
  readonly contextType?: ReactClassContext<ReactValue> | null;
  readonly contextTypes?: ReactValue;
  readonly childContextTypes?: ReactValue;
  readonly defaultProps?: ReactClassProps;
  readonly getDerivedStateFromProps?: (
    props: ReactClassProps,
    state: ReactValue,
  ) => ReactValue;
  readonly getSnapshotBeforeUpdate?: ReactValue;
  readonly getDerivedStateFromError?: (error: unknown) => ReactValue;
}

interface ReactPureComponentPrototype {
  constructor: ReactValue;
  isPureReactComponent: boolean;
}

type React$Key = ReactJSXKeyInput;
type React$ElementType = ReactJSXType;
type React$RefSetter<Instance> =
  | ((instance: Instance | null) => void)
  | {current: Instance | null};
type React$ElementRef<ElementType> = ElementType extends (
  props: unknown,
) => infer Result
  ? Result
  : unknown;
type React$ElementConfig<ElementType> = ElementType extends (
  props: infer Props,
) => unknown
  ? Props
  : unknown;

interface React$Element<ElementType = React$ElementType> {
  $$typeof: symbol;
  type: ElementType;
  key: ReactJSXStoredKey;
  props: ReactJSXProps;
}

interface React$Portal {
  $$typeof: symbol;
  key: React$Key | null;
  children: React$Node;
  containerInfo: unknown;
}

type React$Node =
  | ReactJSXElementRecord
  | React$Element
  | React$Portal
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | Iterable<React$Node>;

declare namespace React {
  interface Context<Value> {
    Provider: unknown;
    Consumer: unknown;
    _currentValue: Value;
  }
  type RefSetter<Instance> = React$RefSetter<Instance>;
  type ElementRef<ElementType> = React$ElementRef<ElementType>;
}
