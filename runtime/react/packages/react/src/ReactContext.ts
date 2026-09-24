import { REACT_CONSUMER_TYPE, REACT_CONTEXT_TYPE } from "shared/ReactSymbols.ts";
import type { ReactContext } from "shared/ReactTypes.ts";
import { isDevelopment } from "shared/Build.ts";

export function createContext<T>(defaultValue: T): ReactContext<T> {
  const context = {
    $$typeof: REACT_CONTEXT_TYPE,
    // Two slots so that two renderers (a primary and a secondary, such as a
    // canvas inside the DOM) can each hold their own current value.
    _currentValue: defaultValue,
    _currentValue2: defaultValue,
    // How many concurrent server renders use this context.
    _threadCount: 0,
  } as ReactContext<T>;
  // A context is its own provider; its consumer points back at it.
  context.Provider = context;
  context.Consumer = { $$typeof: REACT_CONSUMER_TYPE, _context: context };
  if (isDevelopment) {
    context._currentRenderer = null;
    context._currentRenderer2 = null;
  }
  return context;
}
