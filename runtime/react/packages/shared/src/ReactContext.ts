// A context, and what the reconciler holds when it does not know the value
// type: a fiber's `type`, a dependency list, the provider stack. Those hold
// contexts of every value type side by side, so they hold `ReactContextBase`
// -- identity is all they compare -- and reach the value through its erased
// accessors. Only `useContext` and a context's own provider know `T`.
//
// Classes rather than upstream's object literals because the value is the
// one field whose type varies: a list of `ReactContext<unknown>` would read a
// `ReactContext<number>` through the wrong layout.

import { isDevelopment } from "shared/Build.ts";
import { REACT_CONSUMER_TYPE, REACT_CONTEXT_TYPE } from "shared/ReactSymbols.ts";

export abstract class ReactContextBase {
  readonly $$typeof: symbol = REACT_CONTEXT_TYPE;
  // How many concurrent server renders use this context.
  _threadCount: number = 0;
  // Development only: which renderer is rendering it, per renderer slot.
  _currentRenderer?: unknown;
  _currentRenderer2?: unknown;
  // Set by applications for tooling.
  displayName?: string;

  /** The current value in the primary renderer's slot or the secondary's. */
  abstract currentValue(primary: boolean): unknown;

  /** Sets it: `value` is a value of the context's own type. */
  abstract setCurrentValue(primary: boolean, value: unknown): void;
}

export class ReactContext<T> extends ReactContextBase {
  // Two slots so that two renderers (a primary and a secondary, such as a
  // canvas inside the DOM) can each hold their own current value.
  _currentValue: T;
  _currentValue2: T;
  // A context is its own provider; its consumer points back at it.
  Provider: ReactContext<T>;
  Consumer: ReactContextConsumer;

  constructor(defaultValue: T) {
    super();
    this._currentValue = defaultValue;
    this._currentValue2 = defaultValue;
    this.Provider = this;
    this.Consumer = new ReactContextConsumer(this);
    if (isDevelopment) {
      this._currentRenderer = null;
      this._currentRenderer2 = null;
    }
  }

  currentValue(primary: boolean): unknown {
    return primary ? this._currentValue : this._currentValue2;
  }

  setCurrentValue(primary: boolean, value: unknown): void {
    if (primary) {
      this._currentValue = value as T;
    } else {
      this._currentValue2 = value as T;
    }
  }
}

// `<Context.Consumer>`: the element type that reads its context and calls its
// child with the value.
export class ReactContextConsumer {
  readonly $$typeof: symbol = REACT_CONSUMER_TYPE;
  readonly _context: ReactContextBase;

  constructor(context: ReactContextBase) {
    this._context = context;
  }
}
