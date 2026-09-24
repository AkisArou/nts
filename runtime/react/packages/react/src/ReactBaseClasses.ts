import type { Props } from "shared/ReactTypes.ts";
import { isDevelopment } from "shared/Build.ts";
import { ReactNoopUpdateQueue, type Updater } from "./ReactNoopUpdateQueue.ts";

const emptyObject: { [name: string]: unknown } = {};
if (isDevelopment) {
  Object.freeze(emptyObject);
}

// The instance side of a class component.
export interface Component<P = Props, S = unknown> {
  props: P;
  context: unknown;
  // String refs are gone; the field stays for code that reads it.
  refs: { [name: string]: unknown };
  updater: Updater;
  state: S;
  // Marks class components on the prototype; the reconciler checks it.
  isReactComponent: object;
  // Schedules a state update, merged shallowly into the current state, or a
  // function of the previous state and props. Updates are batched: `state`
  // is not updated synchronously.
  setState(
    partialState: Partial<S> | ((prevState: S, props: P) => Partial<S> | null) | null,
    callback?: () => void,
  ): void;
  // Re-renders without shouldComponentUpdate asking first.
  forceUpdate(callback?: () => void): void;
}

export interface PureComponent<P = Props, S = unknown> extends Component<P, S> {
  isPureReactComponent: boolean;
}

interface ComponentConstructor {
  new <P = Props, S = unknown>(props: P, context?: unknown, updater?: Updater): Component<P, S>;
  prototype: Component;
}

interface PureComponentConstructor {
  new <P = Props, S = unknown>(props: P, context?: unknown, updater?: Updater): PureComponent<P, S>;
  prototype: PureComponent;
}

// JS object model: the base classes are function constructors, as upstream's
// are, because it is observable. Classes compiled to ES5 (CoffeeScript,
// Babel's loose mode, TypeScript targeting ES5, many published packages)
// call the base as `Component.call(this, props)`, which an ES class forbids,
// and `create-react-class` copies the enumerable prototype methods. A native
// build, where neither can happen, uses an ES class instead.
function ComponentImpl(this: Component, props: Props, context?: unknown, updater?: Updater): void {
  this.props = props;
  this.context = context;
  this.refs = emptyObject;
  // The reconciler replaces this before the instance can update.
  this.updater = updater || ReactNoopUpdateQueue;
}

ComponentImpl.prototype.isReactComponent = {};

ComponentImpl.prototype.setState = function setState(
  this: Component,
  partialState: unknown,
  callback?: () => void,
): void {
  if (typeof partialState !== "object" && typeof partialState !== "function" && partialState != null) {
    throw new Error(
      "takes an object of state variables to update or a " + "function which returns an object of state variables.",
    );
  }
  this.updater.enqueueSetState(this, partialState, callback, "setState");
};

ComponentImpl.prototype.forceUpdate = function forceUpdate(this: Component, callback?: () => void): void {
  this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
};

if (isDevelopment) {
  const deprecatedAPIs: { [name: string]: [string, string] } = {
    isMounted: [
      "isMounted",
      "Instead, make sure to clean up subscriptions and pending requests in " +
        "componentWillUnmount to prevent memory leaks.",
    ],
    replaceState: [
      "replaceState",
      "Refactor your code to use setState instead (see " + "https://github.com/facebook/react/issues/3236).",
    ],
  };
  for (const methodName in deprecatedAPIs) {
    const info = deprecatedAPIs[methodName]!;
    Object.defineProperty(ComponentImpl.prototype, methodName, {
      get() {
        console.warn("%s(...) is deprecated in plain JavaScript React classes. %s", info[0], info[1]);
        return undefined;
      },
    });
  }
}

// A component whose shouldComponentUpdate is a shallow comparison of props
// and state; the reconciler checks `isPureReactComponent`.
function PureComponentImpl(this: PureComponent, props: Props, context?: unknown, updater?: Updater): void {
  this.props = props;
  this.context = context;
  this.refs = emptyObject;
  this.updater = updater || ReactNoopUpdateQueue;
}

// PureComponent's prototype inherits from Component's, and also carries its
// own copy of the methods, to avoid an extra prototype hop.
function ComponentDummy(): void {}
ComponentDummy.prototype = ComponentImpl.prototype;
const pureComponentPrototype = (PureComponentImpl.prototype = new (ComponentDummy as unknown as new () => PureComponent)());
pureComponentPrototype.constructor = PureComponentImpl;
Object.assign(pureComponentPrototype, ComponentImpl.prototype);
pureComponentPrototype.isPureReactComponent = true;

export const Component = ComponentImpl as unknown as ComponentConstructor;
export const PureComponent = PureComponentImpl as unknown as PureComponentConstructor;
