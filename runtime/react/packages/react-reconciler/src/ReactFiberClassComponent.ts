import type { Props } from "shared/ReactTypes.ts";
import { shallowEqual } from "shared/shallowEqual.ts";
import type { Fiber } from "./ReactInternalTypes.ts";
import type { Lanes } from "./ReactFiberLane.ts";
import type { UpdateQueue } from "./ReactFiberClassUpdateQueue.ts";

import { isDevelopment } from "shared/Build.ts";
import { LayoutStatic, Update, Snapshot, MountLayoutDev } from "./ReactFiberFlags.ts";
import { disableLegacyContext, enableSchedulingProfiler } from "shared/ReactFeatureFlags.ts";
import { ReactStrictModeWarnings } from "./ReactStrictModeWarnings.ts";
import { getComponentNameFromFiber } from "./getComponentNameFromFiber.ts";
import { getComponentNameFromType } from "shared/getComponentNameFromType.ts";
import { REACT_CONTEXT_TYPE, REACT_CONSUMER_TYPE } from "shared/ReactSymbols.ts";
import type { ReactContext } from "shared/ReactTypes.ts";

import { NoMode, StrictLegacyMode, StrictEffectsMode } from "./ReactTypeOfMode.ts";

import {
  enqueueUpdate,
  entangleTransitions,
  processUpdateQueue,
  checkHasForceUpdateAfterProcessing,
  resetHasForceUpdateBeforeProcessing,
  createUpdate,
  ReplaceState,
  ForceUpdate,
  initializeUpdateQueue,
  cloneUpdateQueue,
  suspendIfUpdateReadFromEntangledAsyncAction,
} from "./ReactFiberClassUpdateQueue.ts";
import { NoLanes } from "./ReactFiberLane.ts";
import { cacheContext, hasContextChanged, emptyContextObject } from "./ReactFiberLegacyContext.ts";
import { readContext, checkIfContextChanged } from "./ReactFiberNewContext.ts";
import { requestUpdateLane, scheduleUpdateOnFiber } from "./ReactFiberWorkLoop.ts";
import { markForceUpdateScheduled, markStateUpdateScheduled, setIsStrictModeForDevtools } from "./ReactFiberDevToolsHook.ts";
import { startUpdateTimerByLane } from "./ReactProfilerTimer.ts";

// A class component instance, as the reconciler uses it. User classes extend
// `Component` from `react`; the lifecycles are optional methods, checked with
// `typeof` before each call, as upstream does.
export interface ClassInstance {
  props: unknown;
  state: unknown;
  context: unknown;
  refs: unknown;
  updater: unknown;
  render(): unknown;
  shouldComponentUpdate?(nextProps: unknown, nextState: unknown, nextContext: unknown): unknown;
  componentWillMount?(): void;
  UNSAFE_componentWillMount?(): void;
  componentWillReceiveProps?(nextProps: unknown, nextContext: unknown): void;
  UNSAFE_componentWillReceiveProps?(nextProps: unknown, nextContext: unknown): void;
  componentWillUpdate?(nextProps: unknown, nextState: unknown, nextContext: unknown): void;
  UNSAFE_componentWillUpdate?(nextProps: unknown, nextState: unknown, nextContext: unknown): void;
  componentDidMount?(): void;
  componentDidUpdate?(prevProps: unknown, prevState: unknown, snapshot: unknown): void;
  componentWillUnmount?(): void;
  getSnapshotBeforeUpdate?(prevProps: unknown, prevState: unknown): unknown;
  componentDidCatch?(error: unknown, errorInfo: { componentStack?: string | null }): void;
  // Set by the reconciler: the fiber (see getInstance/setInstance), and in
  // development a frozen placeholder upstream keeps for old tooling.
  _reactInternals?: Fiber;
  _reactInternalInstance?: unknown;
}

// A class component's constructor and its static members.
export interface ClassComponentConstructor {
  new (props: unknown, context: unknown): ClassInstance;
  readonly prototype: { isReactComponent?: unknown; isPureReactComponent?: unknown; render?: unknown } | undefined;
  readonly contextType?: unknown;
  readonly contextTypes?: unknown;
  readonly childContextTypes?: unknown;
  readonly getDerivedStateFromProps?: unknown;
  readonly getDerivedStateFromError?: unknown;
  readonly getSnapshotBeforeUpdate?: unknown;
  readonly defaultProps?: unknown;
}

type DerivedStateFromProps = (props: unknown, state: unknown) => unknown;

// Upstream's shared/ReactInstanceMap: a class instance points at its fiber
// through `_reactInternals`, so that `setState` can find what to update.
// JS object model: the field lives on the user's instance.
export function getInstance(instance: object): Fiber {
  return (instance as ClassInstance)._reactInternals as Fiber;
}

export function hasInstance(instance: object): boolean {
  return (instance as ClassInstance)._reactInternals !== undefined;
}

export function setInstance(instance: object, value: Fiber): void {
  (instance as ClassInstance)._reactInternals = value;
}


// The members a development check reads by name, whatever the class defines.
function membersOf(value: object): { readonly [name: string]: unknown } {
  return value as { readonly [name: string]: unknown };
}

const fakeInternalInstance = {};

const didWarnAboutStateAssignmentForComponent = new Set<string>();
const didWarnAboutUninitializedState = new Set<string>();
const didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate = new Set<unknown>();
const didWarnAboutLegacyLifecyclesAndDerivedState = new Set<string>();
const didWarnAboutDirectlyAssigningPropsToState = new Set<string>();
const didWarnAboutUndefinedDerivedState = new Set<string>();
const didWarnAboutContextTypes = new Set<unknown>();
const didWarnAboutChildContextTypes = new Set<unknown>();
const didWarnAboutInvalidateContextType = new Set<unknown>();
const didWarnOnInvalidCallback = new Set<string>();

if (isDevelopment) {
  Object.freeze(fakeInternalInstance);
}

function warnOnInvalidCallback(callback: unknown): void {
  if (isDevelopment) {
    if (callback === null || typeof callback === "function") {
      return;
    }
    const key = String(callback);
    if (!didWarnOnInvalidCallback.has(key)) {
      didWarnOnInvalidCallback.add(key);
      console.error("Expected the last optional `callback` argument to be a " + "function. Instead received: %s.", callback);
    }
  }
}

function warnOnUndefinedDerivedState(type: unknown, partialState: unknown): void {
  if (isDevelopment) {
    if (partialState === undefined) {
      const componentName = getComponentNameFromType(type) || "Component";
      if (!didWarnAboutUndefinedDerivedState.has(componentName)) {
        didWarnAboutUndefinedDerivedState.add(componentName);
        console.error(
          "%s.getDerivedStateFromProps(): A valid state object (or null) must be returned. " + "You have returned undefined.",
          componentName,
        );
      }
    }
  }
}

function applyDerivedStateFromProps(
  workInProgress: Fiber,
  ctor: ClassComponentConstructor,
  getDerivedStateFromProps: DerivedStateFromProps,
  nextProps: unknown,
): void {
  const prevState = workInProgress.memoizedState;
  let partialState = getDerivedStateFromProps(nextProps, prevState);
  if (isDevelopment) {
    if (workInProgress.mode & StrictLegacyMode) {
      setIsStrictModeForDevtools(true);
      try {
        // Invoke the function an extra time to help detect side-effects.
        partialState = getDerivedStateFromProps(nextProps, prevState);
      } finally {
        setIsStrictModeForDevtools(false);
      }
    }
    warnOnUndefinedDerivedState(ctor, partialState);
  }
  // Merge the partial state and the previous state.
  const memoizedState =
    partialState === null || partialState === undefined ? prevState : Object.assign({}, prevState, partialState);
  workInProgress.memoizedState = memoizedState;

  // Once the update queue is empty, persist the derived state onto the
  // base state.
  if (workInProgress.lanes === NoLanes) {
    // Queue is always non-null for classes
    const updateQueue = workInProgress.updateQueue as UpdateQueue;
    updateQueue.baseState = memoizedState;
  }
}

// The updater every mounted class instance gets: `this.setState` and
// friends schedule updates on the instance's fiber.
const classComponentUpdater = {
  enqueueSetState(inst: object, payload: unknown, callback: unknown, _callerName?: string): void {
    const fiber = getInstance(inst);
    const lane = requestUpdateLane(fiber);

    const update = createUpdate(lane);
    update.payload = payload;
    if (callback !== undefined && callback !== null) {
      if (isDevelopment) {
        warnOnInvalidCallback(callback);
      }
      update.callback = callback as () => unknown;
    }

    const root = enqueueUpdate(fiber, update, lane);
    if (root !== null) {
      startUpdateTimerByLane(lane, "this.setState()", fiber);
      scheduleUpdateOnFiber(root, fiber, lane);
      entangleTransitions(root, fiber, lane);
    }

    if (enableSchedulingProfiler) {
      markStateUpdateScheduled(fiber, lane);
    }
  },
  enqueueReplaceState(inst: object, payload: unknown, callback: unknown, _callerName?: string): void {
    const fiber = getInstance(inst);
    const lane = requestUpdateLane(fiber);

    const update = createUpdate(lane);
    update.tag = ReplaceState;
    update.payload = payload;

    if (callback !== undefined && callback !== null) {
      if (isDevelopment) {
        warnOnInvalidCallback(callback);
      }
      update.callback = callback as () => unknown;
    }

    const root = enqueueUpdate(fiber, update, lane);
    if (root !== null) {
      startUpdateTimerByLane(lane, "this.replaceState()", fiber);
      scheduleUpdateOnFiber(root, fiber, lane);
      entangleTransitions(root, fiber, lane);
    }

    if (enableSchedulingProfiler) {
      markStateUpdateScheduled(fiber, lane);
    }
  },
  enqueueForceUpdate(inst: object, callback: unknown, _callerName?: string): void {
    const fiber = getInstance(inst);
    const lane = requestUpdateLane(fiber);

    const update = createUpdate(lane);
    update.tag = ForceUpdate;

    if (callback !== undefined && callback !== null) {
      if (isDevelopment) {
        warnOnInvalidCallback(callback);
      }
      update.callback = callback as () => unknown;
    }

    const root = enqueueUpdate(fiber, update, lane);
    if (root !== null) {
      startUpdateTimerByLane(lane, "this.forceUpdate()", fiber);
      scheduleUpdateOnFiber(root, fiber, lane);
      entangleTransitions(root, fiber, lane);
    }

    if (enableSchedulingProfiler) {
      markForceUpdateScheduled(fiber, lane);
    }
  },
};

function checkShouldComponentUpdate(
  workInProgress: Fiber,
  ctor: ClassComponentConstructor,
  oldProps: unknown,
  newProps: unknown,
  oldState: unknown,
  newState: unknown,
  nextContext: unknown,
): boolean {
  const instance = workInProgress.stateNode as ClassInstance;
  if (typeof instance.shouldComponentUpdate === "function") {
    let shouldUpdate = instance.shouldComponentUpdate(newProps, newState, nextContext);
    if (isDevelopment) {
      if (workInProgress.mode & StrictLegacyMode) {
        setIsStrictModeForDevtools(true);
        try {
          // Invoke the function an extra time to help detect side-effects.
          shouldUpdate = instance.shouldComponentUpdate(newProps, newState, nextContext);
        } finally {
          setIsStrictModeForDevtools(false);
        }
      }
      if (shouldUpdate === undefined) {
        console.error(
          "%s.shouldComponentUpdate(): Returned undefined instead of a " + "boolean value. Make sure to return true or false.",
          getComponentNameFromType(ctor) || "Component",
        );
      }
    }

    // Upstream returns the method's value as is; callers only test it.
    return shouldUpdate as boolean;
  }

  // JS object model: PureComponent is recognised by a prototype marker.
  if (ctor.prototype && ctor.prototype.isPureReactComponent) {
    return !shallowEqual(oldProps, newProps) || !shallowEqual(oldState, newState);
  }

  return true;
}

function checkClassInstance(workInProgress: Fiber, ctor: ClassComponentConstructor, newProps: unknown): void {
  const instance = workInProgress.stateNode as ClassInstance;
  if (isDevelopment) {
    const members = membersOf(instance);
    const statics = membersOf(ctor);
    const name = getComponentNameFromType(ctor) || "Component";
    const renderPresent = members["render"];

    if (!renderPresent) {
      if (ctor.prototype && typeof ctor.prototype.render === "function") {
        console.error(
          "No `render` method found on the %s " + "instance: did you accidentally return an object from the constructor?",
          name,
        );
      } else {
        console.error("No `render` method found on the %s " + "instance: you may have forgotten to define `render`.", name);
      }
    }

    const getInitialState = members["getInitialState"] as { isReactClassApproved?: unknown } | undefined;
    if (getInitialState && !getInitialState.isReactClassApproved && !instance.state) {
      console.error(
        "getInitialState was defined on %s, a plain JavaScript class. " +
          "This is only supported for classes created using React.createClass. " +
          "Did you mean to define a state property instead?",
        name,
      );
    }
    const getDefaultProps = members["getDefaultProps"] as { isReactClassApproved?: unknown } | undefined;
    if (getDefaultProps && !getDefaultProps.isReactClassApproved) {
      console.error(
        "getDefaultProps was defined on %s, a plain JavaScript class. " +
          "This is only supported for classes created using React.createClass. " +
          "Use a static property to define defaultProps instead.",
        name,
      );
    }
    if (members["contextType"]) {
      console.error(
        "contextType was defined as an instance property on %s. Use a static " + "property to define contextType instead.",
        name,
      );
    }

    // disableLegacyContext is on in the stable channel.
    if (disableLegacyContext) {
      if (ctor.childContextTypes && !didWarnAboutChildContextTypes.has(ctor)) {
        didWarnAboutChildContextTypes.add(ctor);
        console.error(
          "%s uses the legacy childContextTypes API which was removed in React 19. " +
            "Use React.createContext() instead. (https://react.dev/link/legacy-context)",
          name,
        );
      }
      if (ctor.contextTypes && !didWarnAboutContextTypes.has(ctor)) {
        didWarnAboutContextTypes.add(ctor);
        console.error(
          "%s uses the legacy contextTypes API which was removed in React 19. " +
            "Use React.createContext() with static contextType instead. " +
            "(https://react.dev/link/legacy-context)",
          name,
        );
      }
    }

    if (typeof members["componentShouldUpdate"] === "function") {
      console.error(
        "%s has a method called " +
          "componentShouldUpdate(). Did you mean shouldComponentUpdate()? " +
          "The name is phrased as a question because the function is " +
          "expected to return a value.",
        name,
      );
    }
    if (ctor.prototype && ctor.prototype.isPureReactComponent && typeof instance.shouldComponentUpdate !== "undefined") {
      console.error(
        "%s has a method called shouldComponentUpdate(). " +
          "shouldComponentUpdate should not be used when extending React.PureComponent. " +
          "Please extend React.Component if shouldComponentUpdate is used.",
        getComponentNameFromType(ctor) || "A pure component",
      );
    }
    if (typeof members["componentDidUnmount"] === "function") {
      console.error(
        "%s has a method called " +
          "componentDidUnmount(). But there is no such lifecycle method. " +
          "Did you mean componentWillUnmount()?",
        name,
      );
    }
    if (typeof members["componentDidReceiveProps"] === "function") {
      console.error(
        "%s has a method called " +
          "componentDidReceiveProps(). But there is no such lifecycle method. " +
          "If you meant to update the state in response to changing props, " +
          "use componentWillReceiveProps(). If you meant to fetch data or " +
          "run side-effects or mutations after React has updated the UI, use componentDidUpdate().",
        name,
      );
    }
    if (typeof members["componentWillRecieveProps"] === "function") {
      console.error(
        "%s has a method called " + "componentWillRecieveProps(). Did you mean componentWillReceiveProps()?",
        name,
      );
    }
    if (typeof members["UNSAFE_componentWillRecieveProps"] === "function") {
      console.error(
        "%s has a method called " + "UNSAFE_componentWillRecieveProps(). Did you mean UNSAFE_componentWillReceiveProps()?",
        name,
      );
    }
    const hasMutatedProps = instance.props !== newProps;
    if (instance.props !== undefined && hasMutatedProps) {
      console.error(
        "When calling super() in `%s`, make sure to pass " + "up the same props that your component's constructor was passed.",
        name,
      );
    }
    if (members["defaultProps"]) {
      console.error(
        "Setting defaultProps as an instance property on %s is not supported and will be ignored." +
          " Instead, define defaultProps as a static property on %s.",
        name,
        name,
      );
    }

    if (
      typeof instance.getSnapshotBeforeUpdate === "function" &&
      typeof instance.componentDidUpdate !== "function" &&
      !didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate.has(ctor)
    ) {
      didWarnAboutGetSnapshotBeforeUpdateWithoutDidUpdate.add(ctor);
      console.error(
        "%s: getSnapshotBeforeUpdate() should be used with componentDidUpdate(). " +
          "This component defines getSnapshotBeforeUpdate() only.",
        getComponentNameFromType(ctor),
      );
    }

    if (typeof members["getDerivedStateFromProps"] === "function") {
      console.error(
        "%s: getDerivedStateFromProps() is defined as an instance method " +
          "and will be ignored. Instead, declare it as a static method.",
        name,
      );
    }
    if (typeof members["getDerivedStateFromError"] === "function") {
      console.error(
        "%s: getDerivedStateFromError() is defined as an instance method " +
          "and will be ignored. Instead, declare it as a static method.",
        name,
      );
    }
    if (typeof statics["getSnapshotBeforeUpdate"] === "function") {
      console.error(
        "%s: getSnapshotBeforeUpdate() is defined as a static method " +
          "and will be ignored. Instead, declare it as an instance method.",
        name,
      );
    }
    const state = instance.state;
    if (state && (typeof state !== "object" || Array.isArray(state))) {
      console.error("%s.state: must be set to an object or null", name);
    }
    if (typeof members["getChildContext"] === "function" && typeof ctor.childContextTypes !== "object") {
      console.error("%s.getChildContext(): childContextTypes must be defined in order to " + "use getChildContext().", name);
    }
  }
}

function constructClassInstance(workInProgress: Fiber, ctor: ClassComponentConstructor, props: unknown): ClassInstance {
  const isLegacyContextConsumer = false;
  const unmaskedContext = emptyContextObject;
  let context: unknown = emptyContextObject;
  const contextType = ctor.contextType;

  if (isDevelopment) {
    if ("contextType" in ctor) {
      const isValid =
        // Allow null for conditional declaration
        contextType === null ||
        (contextType !== undefined && (contextType as { $$typeof?: unknown }).$$typeof === REACT_CONTEXT_TYPE);

      if (!isValid && !didWarnAboutInvalidateContextType.has(ctor)) {
        didWarnAboutInvalidateContextType.add(ctor);

        let addendum = "";
        if (contextType === undefined) {
          addendum =
            " However, it is set to undefined. " +
            "This can be caused by a typo or by mixing up named and default imports. " +
            "This can also happen due to a circular dependency, so " +
            "try moving the createContext() call to a separate file.";
        } else if (typeof contextType !== "object") {
          addendum = " However, it is set to a " + typeof contextType + ".";
        } else if ((contextType as { $$typeof?: unknown }).$$typeof === REACT_CONSUMER_TYPE) {
          addendum = " Did you accidentally pass the Context.Consumer instead?";
        } else {
          addendum = " However, it is set to an object with keys {" + Object.keys(contextType as object).join(", ") + "}.";
        }
        console.error(
          "%s defines an invalid contextType. " +
            "contextType should point to the Context object returned by React.createContext().%s",
          getComponentNameFromType(ctor) || "Component",
          addendum,
        );
      }
    }
  }

  if (typeof contextType === "object" && contextType !== null) {
    context = readContext(contextType as ReactContext<unknown>);
  }
  // disableLegacyContext: no masked legacy context to read otherwise.

  let instance = new ctor(props, context);
  // Instantiate twice to help detect side-effects.
  if (isDevelopment) {
    if (workInProgress.mode & StrictLegacyMode) {
      setIsStrictModeForDevtools(true);
      try {
        instance = new ctor(props, context);
      } finally {
        setIsStrictModeForDevtools(false);
      }
    }
  }

  const state = (workInProgress.memoizedState = instance.state !== null && instance.state !== undefined ? instance.state : null);
  instance.updater = classComponentUpdater;
  workInProgress.stateNode = instance;
  // The instance needs access to the fiber so that it can schedule updates
  setInstance(instance, workInProgress);
  if (isDevelopment) {
    instance._reactInternalInstance = fakeInternalInstance;
  }

  if (isDevelopment) {
    if (typeof ctor.getDerivedStateFromProps === "function" && state === null) {
      const componentName = getComponentNameFromType(ctor) || "Component";
      if (!didWarnAboutUninitializedState.has(componentName)) {
        didWarnAboutUninitializedState.add(componentName);
        console.error(
          "`%s` uses `getDerivedStateFromProps` but its initial state is " +
            "%s. This is not recommended. Instead, define the initial state by " +
            "assigning an object to `this.state` in the constructor of `%s`. " +
            "This ensures that `getDerivedStateFromProps` arguments have a consistent shape.",
          componentName,
          instance.state === null ? "null" : "undefined",
          componentName,
        );
      }
    }

    // If new component APIs are defined, "unsafe" lifecycles won't be called.
    // Warn about these lifecycles if they are present.
    // Don't warn about react-lifecycles-compat polyfilled methods though.
    if (typeof ctor.getDerivedStateFromProps === "function" || typeof instance.getSnapshotBeforeUpdate === "function") {
      let foundWillMountName: string | null = null;
      let foundWillReceivePropsName: string | null = null;
      let foundWillUpdateName: string | null = null;
      if (typeof instance.componentWillMount === "function" && !isSuppressed(instance.componentWillMount)) {
        foundWillMountName = "componentWillMount";
      } else if (typeof instance.UNSAFE_componentWillMount === "function") {
        foundWillMountName = "UNSAFE_componentWillMount";
      }
      if (typeof instance.componentWillReceiveProps === "function" && !isSuppressed(instance.componentWillReceiveProps)) {
        foundWillReceivePropsName = "componentWillReceiveProps";
      } else if (typeof instance.UNSAFE_componentWillReceiveProps === "function") {
        foundWillReceivePropsName = "UNSAFE_componentWillReceiveProps";
      }
      if (typeof instance.componentWillUpdate === "function" && !isSuppressed(instance.componentWillUpdate)) {
        foundWillUpdateName = "componentWillUpdate";
      } else if (typeof instance.UNSAFE_componentWillUpdate === "function") {
        foundWillUpdateName = "UNSAFE_componentWillUpdate";
      }
      if (foundWillMountName !== null || foundWillReceivePropsName !== null || foundWillUpdateName !== null) {
        const componentName = getComponentNameFromType(ctor) || "Component";
        const newApiName =
          typeof ctor.getDerivedStateFromProps === "function" ? "getDerivedStateFromProps()" : "getSnapshotBeforeUpdate()";
        if (!didWarnAboutLegacyLifecyclesAndDerivedState.has(componentName)) {
          didWarnAboutLegacyLifecyclesAndDerivedState.add(componentName);
          console.error(
            "Unsafe legacy lifecycles will not be called for components using new component APIs.\n\n" +
              "%s uses %s but also contains the following legacy lifecycles:%s%s%s\n\n" +
              "The above lifecycles should be removed. Learn more about this warning here:\n" +
              "https://react.dev/link/unsafe-component-lifecycles",
            componentName,
            newApiName,
            foundWillMountName !== null ? `\n  ${foundWillMountName}` : "",
            foundWillReceivePropsName !== null ? `\n  ${foundWillReceivePropsName}` : "",
            foundWillUpdateName !== null ? `\n  ${foundWillUpdateName}` : "",
          );
        }
      }
    }
  }

  // Cache unmasked context so we can avoid recreating masked context unless necessary.
  // ReactFiberLegacyContext usually updates this cache but can't for newly-created instances.
  if (isLegacyContextConsumer) {
    cacheContext(workInProgress, unmaskedContext, context as { [key: string]: unknown });
  }

  return instance;
}

// react-lifecycles-compat marks its polyfilled lifecycles.
// JS object model: a property on the method.
function isSuppressed(method: object): boolean {
  return (method as { __suppressDeprecationWarning?: unknown }).__suppressDeprecationWarning === true;
}

function callComponentWillMount(workInProgress: Fiber, instance: ClassInstance): void {
  const oldState = instance.state;

  if (typeof instance.componentWillMount === "function") {
    instance.componentWillMount();
  }
  if (typeof instance.UNSAFE_componentWillMount === "function") {
    instance.UNSAFE_componentWillMount();
  }

  if (oldState !== instance.state) {
    if (isDevelopment) {
      console.error(
        "%s.componentWillMount(): Assigning directly to this.state is " +
          "deprecated (except inside a component's " +
          "constructor). Use setState instead.",
        getComponentNameFromFiber(workInProgress) || "Component",
      );
    }
    classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
  }
}

function callComponentWillReceiveProps(
  workInProgress: Fiber,
  instance: ClassInstance,
  newProps: unknown,
  nextContext: unknown,
): void {
  const oldState = instance.state;
  if (typeof instance.componentWillReceiveProps === "function") {
    instance.componentWillReceiveProps(newProps, nextContext);
  }
  if (typeof instance.UNSAFE_componentWillReceiveProps === "function") {
    instance.UNSAFE_componentWillReceiveProps(newProps, nextContext);
  }

  if (instance.state !== oldState) {
    if (isDevelopment) {
      const componentName = getComponentNameFromFiber(workInProgress) || "Component";
      if (!didWarnAboutStateAssignmentForComponent.has(componentName)) {
        didWarnAboutStateAssignmentForComponent.add(componentName);
        console.error(
          "%s.componentWillReceiveProps(): Assigning directly to " +
            "this.state is deprecated (except inside a component's " +
            "constructor). Use setState instead.",
          componentName,
        );
      }
    }
    classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
  }
}

function readClassContext(ctor: ClassComponentConstructor): unknown {
  const contextType = ctor.contextType;
  if (typeof contextType === "object" && contextType !== null) {
    return readContext(contextType as ReactContext<unknown>);
  }
  // disableLegacyContext is on in the stable channel.
  return emptyContextObject;
}

// Invokes the mount life-cycles on a previously never rendered instance.
function mountClassInstance(workInProgress: Fiber, ctor: ClassComponentConstructor, newProps: unknown, renderLanes: Lanes): void {
  if (isDevelopment) {
    checkClassInstance(workInProgress, ctor, newProps);
  }

  const instance = workInProgress.stateNode as ClassInstance;
  instance.props = newProps;
  instance.state = workInProgress.memoizedState;
  instance.refs = {};

  initializeUpdateQueue(workInProgress);

  instance.context = readClassContext(ctor);

  if (isDevelopment) {
    if (instance.state === newProps) {
      const componentName = getComponentNameFromType(ctor) || "Component";
      if (!didWarnAboutDirectlyAssigningPropsToState.has(componentName)) {
        didWarnAboutDirectlyAssigningPropsToState.add(componentName);
        console.error(
          "%s: It is not recommended to assign props directly to state " +
            "because updates to props won't be reflected in state. " +
            "In most cases, it is better to use props directly.",
          componentName,
        );
      }
    }

    if (workInProgress.mode & StrictLegacyMode) {
      ReactStrictModeWarnings.recordLegacyContextWarning(workInProgress, instance);
    }

    ReactStrictModeWarnings.recordUnsafeLifecycleWarnings(workInProgress, instance);
  }

  instance.state = workInProgress.memoizedState;

  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  if (typeof getDerivedStateFromProps === "function") {
    applyDerivedStateFromProps(workInProgress, ctor, getDerivedStateFromProps as DerivedStateFromProps, newProps);
    instance.state = workInProgress.memoizedState;
  }

  // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.
  if (
    typeof ctor.getDerivedStateFromProps !== "function" &&
    typeof instance.getSnapshotBeforeUpdate !== "function" &&
    (typeof instance.UNSAFE_componentWillMount === "function" || typeof instance.componentWillMount === "function")
  ) {
    callComponentWillMount(workInProgress, instance);
    // If we had additional state updates during this life-cycle, let's
    // process them now.
    processUpdateQueue(workInProgress, newProps, instance, renderLanes);
    suspendIfUpdateReadFromEntangledAsyncAction();
    instance.state = workInProgress.memoizedState;
  }

  if (typeof instance.componentDidMount === "function") {
    workInProgress.flags |= Update | LayoutStatic;
  }
  if (isDevelopment && (workInProgress.mode & StrictEffectsMode) !== NoMode) {
    workInProgress.flags |= MountLayoutDev;
  }
}

function resumeMountClassInstance(
  workInProgress: Fiber,
  ctor: ClassComponentConstructor,
  newProps: unknown,
  renderLanes: Lanes,
): boolean {
  const instance = workInProgress.stateNode as ClassInstance;

  const unresolvedOldProps = workInProgress.memoizedProps as Props;
  const oldProps = resolveClassComponentProps(ctor, unresolvedOldProps);
  instance.props = oldProps;

  const oldContext = instance.context;
  const nextContext = readClassContext(ctor);

  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  const hasNewLifecycles =
    typeof getDerivedStateFromProps === "function" || typeof instance.getSnapshotBeforeUpdate === "function";

  // When comparing whether props changed, we should compare using the
  // unresolved props object that is stored on the fiber, rather than the
  // one that gets assigned to the instance, because that object may have been
  // cloned to resolve default props and/or remove `ref`.
  const unresolvedNewProps = workInProgress.pendingProps;
  const didReceiveNewProps = unresolvedNewProps !== unresolvedOldProps;

  // Note: During these life-cycles, instance.props/instance.state are what
  // ever the previously attempted to render - not the "current". However,
  // during componentDidUpdate we pass the "current" props.

  // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.
  if (
    !hasNewLifecycles &&
    (typeof instance.UNSAFE_componentWillReceiveProps === "function" ||
      typeof instance.componentWillReceiveProps === "function")
  ) {
    if (didReceiveNewProps || oldContext !== nextContext) {
      callComponentWillReceiveProps(workInProgress, instance, newProps, nextContext);
    }
  }

  resetHasForceUpdateBeforeProcessing();

  const oldState = workInProgress.memoizedState;
  let newState = (instance.state = oldState);
  processUpdateQueue(workInProgress, newProps, instance, renderLanes);
  suspendIfUpdateReadFromEntangledAsyncAction();
  newState = workInProgress.memoizedState;
  if (!didReceiveNewProps && oldState === newState && !hasContextChanged() && !checkHasForceUpdateAfterProcessing()) {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    if (typeof instance.componentDidMount === "function") {
      workInProgress.flags |= Update | LayoutStatic;
    }
    if (isDevelopment && (workInProgress.mode & StrictEffectsMode) !== NoMode) {
      workInProgress.flags |= MountLayoutDev;
    }
    return false;
  }

  if (typeof getDerivedStateFromProps === "function") {
    applyDerivedStateFromProps(workInProgress, ctor, getDerivedStateFromProps as DerivedStateFromProps, newProps);
    newState = workInProgress.memoizedState;
  }

  const shouldUpdate =
    checkHasForceUpdateAfterProcessing() ||
    checkShouldComponentUpdate(workInProgress, ctor, oldProps, newProps, oldState, newState, nextContext);

  if (shouldUpdate) {
    // In order to support react-lifecycles-compat polyfilled components,
    // Unsafe lifecycles should not be invoked for components using the new APIs.
    if (
      !hasNewLifecycles &&
      (typeof instance.UNSAFE_componentWillMount === "function" || typeof instance.componentWillMount === "function")
    ) {
      if (typeof instance.componentWillMount === "function") {
        instance.componentWillMount();
      }
      if (typeof instance.UNSAFE_componentWillMount === "function") {
        instance.UNSAFE_componentWillMount();
      }
    }
    if (typeof instance.componentDidMount === "function") {
      workInProgress.flags |= Update | LayoutStatic;
    }
    if (isDevelopment && (workInProgress.mode & StrictEffectsMode) !== NoMode) {
      workInProgress.flags |= MountLayoutDev;
    }
  } else {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    if (typeof instance.componentDidMount === "function") {
      workInProgress.flags |= Update | LayoutStatic;
    }
    if (isDevelopment && (workInProgress.mode & StrictEffectsMode) !== NoMode) {
      workInProgress.flags |= MountLayoutDev;
    }

    // If shouldComponentUpdate returned false, we should still update the
    // memoized state to indicate that this work can be reused.
    workInProgress.memoizedProps = newProps;
    workInProgress.memoizedState = newState;
  }

  // Update the existing instance's state, props, and context pointers even
  // if shouldComponentUpdate returns false.
  instance.props = newProps;
  instance.state = newState;
  instance.context = nextContext;

  return shouldUpdate;
}

// Invokes the update life-cycles and returns false if it shouldn't rerender.
function updateClassInstance(
  current: Fiber,
  workInProgress: Fiber,
  ctor: ClassComponentConstructor,
  newProps: unknown,
  renderLanes: Lanes,
): boolean {
  const instance = workInProgress.stateNode as ClassInstance;

  cloneUpdateQueue(current, workInProgress);

  const unresolvedOldProps = workInProgress.memoizedProps as Props;
  const oldProps = resolveClassComponentProps(ctor, unresolvedOldProps);
  instance.props = oldProps;
  const unresolvedNewProps = workInProgress.pendingProps;

  const oldContext = instance.context;
  const nextContext = readClassContext(ctor);

  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;
  const hasNewLifecycles =
    typeof getDerivedStateFromProps === "function" || typeof instance.getSnapshotBeforeUpdate === "function";

  // Note: During these life-cycles, instance.props/instance.state are what
  // ever the previously attempted to render - not the "current". However,
  // during componentDidUpdate we pass the "current" props.

  // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.
  if (
    !hasNewLifecycles &&
    (typeof instance.UNSAFE_componentWillReceiveProps === "function" ||
      typeof instance.componentWillReceiveProps === "function")
  ) {
    if (unresolvedOldProps !== unresolvedNewProps || oldContext !== nextContext) {
      callComponentWillReceiveProps(workInProgress, instance, newProps, nextContext);
    }
  }

  resetHasForceUpdateBeforeProcessing();

  const oldState = workInProgress.memoizedState;
  let newState = (instance.state = oldState);
  processUpdateQueue(workInProgress, newProps, instance, renderLanes);
  suspendIfUpdateReadFromEntangledAsyncAction();
  newState = workInProgress.memoizedState;

  if (
    unresolvedOldProps === unresolvedNewProps &&
    oldState === newState &&
    !hasContextChanged() &&
    !checkHasForceUpdateAfterProcessing() &&
    !(current !== null && current.dependencies !== null && checkIfContextChanged(current.dependencies))
  ) {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    if (typeof instance.componentDidUpdate === "function") {
      if (unresolvedOldProps !== current.memoizedProps || oldState !== current.memoizedState) {
        workInProgress.flags |= Update;
      }
    }
    if (typeof instance.getSnapshotBeforeUpdate === "function") {
      if (unresolvedOldProps !== current.memoizedProps || oldState !== current.memoizedState) {
        workInProgress.flags |= Snapshot;
      }
    }
    return false;
  }

  if (typeof getDerivedStateFromProps === "function") {
    applyDerivedStateFromProps(workInProgress, ctor, getDerivedStateFromProps as DerivedStateFromProps, newProps);
    newState = workInProgress.memoizedState;
  }

  const shouldUpdate =
    checkHasForceUpdateAfterProcessing() ||
    checkShouldComponentUpdate(workInProgress, ctor, oldProps, newProps, oldState, newState, nextContext) ||
    // TODO: In some cases, we'll end up checking if context has changed twice,
    // both before and after `shouldComponentUpdate` has been called. Not ideal,
    // but I'm loath to refactor this function. This only happens for memoized
    // components so it's not that common.
    (current !== null && current.dependencies !== null && checkIfContextChanged(current.dependencies));

  if (shouldUpdate) {
    // In order to support react-lifecycles-compat polyfilled components,
    // Unsafe lifecycles should not be invoked for components using the new APIs.
    if (
      !hasNewLifecycles &&
      (typeof instance.UNSAFE_componentWillUpdate === "function" || typeof instance.componentWillUpdate === "function")
    ) {
      if (typeof instance.componentWillUpdate === "function") {
        instance.componentWillUpdate(newProps, newState, nextContext);
      }
      if (typeof instance.UNSAFE_componentWillUpdate === "function") {
        instance.UNSAFE_componentWillUpdate(newProps, newState, nextContext);
      }
    }
    if (typeof instance.componentDidUpdate === "function") {
      workInProgress.flags |= Update;
    }
    if (typeof instance.getSnapshotBeforeUpdate === "function") {
      workInProgress.flags |= Snapshot;
    }
  } else {
    // If an update was already in progress, we should schedule an Update
    // effect even though we're bailing out, so that cWU/cDU are called.
    if (typeof instance.componentDidUpdate === "function") {
      if (unresolvedOldProps !== current.memoizedProps || oldState !== current.memoizedState) {
        workInProgress.flags |= Update;
      }
    }
    if (typeof instance.getSnapshotBeforeUpdate === "function") {
      if (unresolvedOldProps !== current.memoizedProps || oldState !== current.memoizedState) {
        workInProgress.flags |= Snapshot;
      }
    }

    // If shouldComponentUpdate returned false, we should still update the
    // memoized props/state to indicate that this work can be reused.
    workInProgress.memoizedProps = newProps;
    workInProgress.memoizedState = newState;
  }

  // Update the existing instance's state, props, and context pointers even
  // if shouldComponentUpdate returns false.
  instance.props = newProps;
  instance.state = newState;
  instance.context = nextContext;

  return shouldUpdate;
}

export function resolveClassComponentProps(Component: unknown, baseProps: Props): Props {
  let newProps = baseProps;

  // Remove ref from the props object, if it exists.
  if ("ref" in baseProps) {
    newProps = {};
    for (const propName in baseProps) {
      if (propName !== "ref") {
        newProps[propName] = baseProps[propName];
      }
    }
  }

  // Resolve default props.
  const defaultProps = (Component as { defaultProps?: unknown }).defaultProps as Props | null | undefined;
  if (defaultProps) {
    // We may have already copied the props object above to remove ref. If so,
    // we can modify that. Otherwise, copy the props object with Object.assign.
    if (newProps === baseProps) {
      newProps = Object.assign({}, newProps);
    }
    // Taken from old JSX runtime, where this used to live.
    for (const propName in defaultProps) {
      if (newProps[propName] === undefined) {
        newProps[propName] = defaultProps[propName];
      }
    }
  }

  return newProps;
}

export { constructClassInstance, mountClassInstance, resumeMountClassInstance, updateClassInstance, classComponentUpdater };
