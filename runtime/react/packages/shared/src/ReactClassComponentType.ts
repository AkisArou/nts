// A class component as the native build knows it (see CLASS-COMPONENTS.md):
// a record of what the reconciler reads from the class, under the names it
// reads them by, so `ctor.contextType` and
// `ctor.prototype.isPureReactComponent` read a field whether `ctor` is the
// class (the JavaScript build) or this descriptor. The React stage writes one
// for each class component, as its static `$$type`.

import type { Props, ReactContextBase } from "shared/ReactTypes.ts";

// The lifecycle methods whose presence changes what the reconciler does, one
// bit each. `lifecycleNames[i]` is bit `1 << i`'s method.
export const ShouldComponentUpdate = 1 << 0;
export const ComponentWillMount = 1 << 1;
export const UnsafeComponentWillMount = 1 << 2;
export const ComponentWillReceiveProps = 1 << 3;
export const UnsafeComponentWillReceiveProps = 1 << 4;
export const ComponentWillUpdate = 1 << 5;
export const UnsafeComponentWillUpdate = 1 << 6;
export const ComponentDidMount = 1 << 7;
export const ComponentDidUpdate = 1 << 8;
export const ComponentWillUnmount = 1 << 9;
export const GetSnapshotBeforeUpdate = 1 << 10;
export const ComponentDidCatch = 1 << 11;
export const GetChildContext = 1 << 12;

export const lifecycleNames: readonly string[] = [
  "shouldComponentUpdate",
  "componentWillMount",
  "UNSAFE_componentWillMount",
  "componentWillReceiveProps",
  "UNSAFE_componentWillReceiveProps",
  "componentWillUpdate",
  "UNSAFE_componentWillUpdate",
  "componentDidMount",
  "componentDidUpdate",
  "componentWillUnmount",
  "getSnapshotBeforeUpdate",
  "componentDidCatch",
  "getChildContext",
];

/** What a class's prototype says about it: that it is a component, and whether a pure one. */
export class ClassComponentPrototype {
  readonly isReactComponent: object = {};
  readonly isPureReactComponent: boolean;
  // The methods live on the class, not here: a development check that finds
  // no `render` on an instance reads this to tell why.
  readonly render: undefined = undefined;

  constructor(isPure: boolean) {
    this.isPureReactComponent = isPure;
  }
}

/**
 * The static members the reconciler reads. The reconciler holds props and
 * state erased, so the stage passes a class's typed static through an
 * adapter: `(props, state) => Counter.getDerivedStateFromProps(props as P, state as S)`.
 */
export interface ClassComponentStatics {
  contextType?: ReactContextBase | null;
  getDerivedStateFromProps?: ((props: unknown, state: unknown) => unknown) | null;
  getDerivedStateFromError?: ((error: unknown) => unknown) | null;
  defaultProps?: Props | null;
  displayName?: string | null;
}

export class ClassComponentType {
  readonly name: string;
  readonly displayName: string | undefined;
  /** The class's constructor, as a closure that names the class. */
  readonly create: (props: unknown, context: unknown) => object;
  /**
   * `setState`'s merge, `{ ...prev, ...partial }` over the class's own state
   * type, where upstream copies properties with `Object.assign`; null for a
   * class that declares no state type.
   */
  readonly mergeState: ((prev: unknown, partial: unknown) => unknown) | null;
  /** The lifecycle methods the class defines, inherited ones included. */
  readonly lifecycles: number;
  readonly prototype: ClassComponentPrototype;
  readonly contextType: ReactContextBase | undefined;
  readonly getDerivedStateFromProps: ((props: unknown, state: unknown) => unknown) | undefined;
  readonly getDerivedStateFromError: ((error: unknown) => unknown) | undefined;
  readonly defaultProps: Props | undefined;
  // Legacy context, which React 19 removed: a descriptor never declares it.
  readonly contextTypes: undefined = undefined;
  readonly childContextTypes: undefined = undefined;

  constructor(
    name: string,
    create: (props: unknown, context: unknown) => object,
    mergeState: ((prev: unknown, partial: unknown) => unknown) | null,
    lifecycles: number,
    isPure: boolean,
    statics: ClassComponentStatics,
  ) {
    this.name = name;
    this.displayName = statics.displayName ?? undefined;
    this.create = create;
    this.mergeState = mergeState;
    this.lifecycles = lifecycles;
    this.prototype = new ClassComponentPrototype(isPure);
    this.contextType = statics.contextType ?? undefined;
    this.getDerivedStateFromProps = statics.getDerivedStateFromProps ?? undefined;
    this.getDerivedStateFromError = statics.getDerivedStateFromError ?? undefined;
    this.defaultProps = statics.defaultProps ?? undefined;
  }
}
