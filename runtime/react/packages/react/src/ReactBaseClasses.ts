import type { Props } from "shared/ReactTypes.ts";
import { isDevelopment } from "shared/Build.ts";
import { ReactNoopUpdateQueue, type Updater } from "./ReactNoopUpdateQueue.ts";

const emptyObject: { [name: string]: unknown } = {};
if (isDevelopment) {
  Object.freeze(emptyObject);
}

// The base class of class components. The reconciler recognises a class
// component by `isReactComponent` on its prototype.
export class Component<P = Props, S = unknown> {
  props: P;
  context: unknown;
  // String refs are gone; the field stays for code that reads it.
  refs: { [name: string]: unknown };
  updater: Updater;
  declare state: S;
  declare isReactComponent: object;

  constructor(props: P, context?: unknown, updater?: Updater) {
    this.props = props;
    this.context = context;
    this.refs = emptyObject;
    // The reconciler replaces this before the instance can update.
    this.updater = updater || ReactNoopUpdateQueue;
  }

  // Schedules a state update, merged shallowly into the current state, or a
  // function of the previous state and props. Updates are batched: `state`
  // is not updated synchronously.
  setState(
    partialState: Partial<S> | ((prevState: S, props: P) => Partial<S> | null) | null,
    callback?: () => void,
  ): void {
    if (typeof partialState !== "object" && typeof partialState !== "function" && partialState != null) {
      throw new Error(
        "takes an object of state variables to update or a " +
          "function which returns an object of state variables.",
      );
    }
    this.updater.enqueueSetState(this, partialState, callback, "setState");
  }

  // Re-renders without shouldComponentUpdate asking first.
  forceUpdate(callback?: () => void): void {
    this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
  }
}

// A component whose shouldComponentUpdate is a shallow comparison of props
// and state; the reconciler checks `isPureReactComponent`.
export class PureComponent<P = Props, S = unknown> extends Component<P, S> {
  declare isPureReactComponent: boolean;
}

// JavaScript compatibility, as upstream's function-constructor classes
// behave: the markers live on the prototypes, and the methods are
// enumerable, because `create-react-class` copies them with Object.assign.
Component.prototype.isReactComponent = {};
PureComponent.prototype.isPureReactComponent = true;
for (const method of ["setState", "forceUpdate"] as const) {
  Object.defineProperty(Component.prototype, method, { enumerable: true });
}

if (isDevelopment) {
  const deprecatedAPIs: { [name: string]: [string, string] } = {
    isMounted: [
      "isMounted",
      "Instead, make sure to clean up subscriptions and pending requests in " +
        "componentWillUnmount to prevent memory leaks.",
    ],
    replaceState: ["replaceState", "Refactor your code to use setState instead (see " + "https://github.com/facebook/react/issues/3236)."],
  };
  for (const [methodName, info] of Object.entries(deprecatedAPIs)) {
    Object.defineProperty(Component.prototype, methodName, {
      get() {
        console.warn("%s(...) is deprecated in plain JavaScript React classes. %s", info[0], info[1]);
        return undefined;
      },
    });
  }
}
