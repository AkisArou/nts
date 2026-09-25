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
  // Written by the reconciler: the instance's fiber, and the snapshot
  // getSnapshotBeforeUpdate returned, held until componentDidUpdate
  // receives it. Upstream adds both to the user's object.
  _reactInternals: unknown = undefined;
  __reactInternalSnapshotBeforeUpdate: unknown = undefined;

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

  // Every lifecycle, with a body, so that a call always has a target: the
  // reconciler calls one only when the class's descriptor lists it (see
  // CLASS-COMPONENTS.md), and a class that does not define it dispatches
  // here. Each body is what upstream does when the method is absent.
  render(): unknown {
    return null;
  }
  componentDidMount(): void {}
  componentDidUpdate(_prevProps: P, _prevState: S, _snapshot?: unknown): void {}
  componentWillUnmount(): void {}
  shouldComponentUpdate(_nextProps: P, _nextState: S, _nextContext: unknown): boolean {
    return true;
  }
  getSnapshotBeforeUpdate(_prevProps: P, _prevState: S): unknown {
    return null;
  }
  componentDidCatch(_error: unknown, _errorInfo: { componentStack?: string | null }): void {}
  componentWillMount(): void {}
  UNSAFE_componentWillMount(): void {}
  componentWillReceiveProps(_nextProps: P, _nextContext: unknown): void {}
  UNSAFE_componentWillReceiveProps(_nextProps: P, _nextContext: unknown): void {}
  componentWillUpdate(_nextProps: P, _nextState: S, _nextContext: unknown): void {}
  UNSAFE_componentWillUpdate(_nextProps: P, _nextState: S, _nextContext: unknown): void {}
}

export class PureComponent<P = Props, S = unknown> extends Component<P, S> {
  get isPureReactComponent(): boolean {
    return true;
  }
}
