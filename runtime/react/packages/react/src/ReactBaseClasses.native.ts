// The native build's twin of ReactBaseClasses.ts: the same public surface as
// ES classes. The JavaScript build keeps upstream's function constructors,
// because ES5-compiled classes call `Component.call(this, ...)` and
// create-react-class copies the prototype; neither happens in a native program.

import type { Props } from "shared/ReactTypes.ts";
import { ReactNoopUpdateQueue, type Updater } from "./ReactNoopUpdateQueue.ts";

const emptyObject: { [name: string]: unknown } = {};

export class Component<P = Props, S = unknown> {
  props: P;
  context: unknown;
  refs: { [name: string]: unknown };
  updater: Updater;
  declare state: S;

  constructor(props: P, context?: unknown, updater?: Updater) {
    this.props = props;
    this.context = context;
    this.refs = emptyObject;
    this.updater = updater || ReactNoopUpdateQueue;
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
