// The native build's twin of ReactBaseClasses.ts: the same public surface as
// ES classes. The JavaScript build keeps upstream's function constructors,
// because ES5-compiled classes call `Component.call(this, ...)` and
// create-react-class copies the prototype; neither happens in a native program.

import { ClassComponentInstance } from "shared/ReactClassComponentInstance.ts";
import type { Props } from "shared/ReactTypes.ts";
import { ReactNoopUpdateQueue, type Updater } from "./ReactNoopUpdateQueue.ts";

const emptyObject: { [name: string]: unknown } = {};

// The reconciler holds every instance by `ClassComponentInstance`, which stores
// what it reads at fixed places, erased; this class gives those places their
// types. A class's methods are reached through its descriptor, which the React
// stage writes naming the class (CLASS-COMPONENTS.md), so this base declares
// none of the lifecycles.
export class Component<P = Props, S = unknown> extends ClassComponentInstance {
  declare props: P;
  declare state: S;
  declare refs: { [name: string]: unknown };
  declare updater: Updater;

  constructor(props: P, context?: unknown, updater?: Updater) {
    super(props, context, updater || ReactNoopUpdateQueue);
    this.refs = emptyObject;
  }

  // Marks class components; the reconciler checks it.
  get isReactComponent(): object {
    return emptyObject;
  }

  setState(
    partialState: Partial<S> | ((prevState: S, props: P) => Partial<S> | null) | null,
    callback?: () => void,
  ): void {
    if (typeof partialState !== "object" && typeof partialState !== "function" && partialState != null) {
      throw new Error(
        "takes an object of state variables to update or a " + "function which returns an object of state variables.",
      );
    }
    this.updater.enqueueSetState(this, partialState, callback, "setState");
  }

  forceUpdate(callback?: () => void): void {
    this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
  }
}

export class PureComponent<P = Props, S = unknown> extends Component<P, S> {
  get isPureReactComponent(): boolean {
    return true;
  }
}
