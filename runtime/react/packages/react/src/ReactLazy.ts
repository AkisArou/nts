import { REACT_LAZY_TYPE } from "shared/ReactSymbols.ts";
import type { LazyComponent, Thenable } from "shared/ReactTypes.ts";
import { isDevelopment } from "shared/Build.ts";

const Uninitialized = -1;
const Pending = 0;
const Resolved = 1;
const Rejected = 2;

export interface ModuleObject<T> {
  default: T;
}

// A lazy component's loading state, advanced by its thenable.
export type LazyPayload<T> =
  | { _status: typeof Uninitialized; _result: () => Thenable<ModuleObject<T>> }
  | { _status: typeof Pending; _result: Thenable<ModuleObject<T>> }
  | { _status: typeof Resolved; _result: ModuleObject<T> }
  | { _status: typeof Rejected; _result: unknown };

// Returns the loaded component, or throws: the pending thenable while it
// loads (Suspense catches it), or the error it rejected with.
function lazyInitializer<T>(payload: LazyPayload<T>): T {
  if (payload._status === Uninitialized) {
    const thenable = payload._result();
    // A constructor that throws leaves the payload uninitialized, so the next
    // render tries again.
    thenable.then(
      (moduleObject) => {
        const current = payload as LazyPayload<T>;
        if (current._status === Pending || current._status === Uninitialized) {
          Object.assign(payload, { _status: Resolved, _result: moduleObject });
          // Make the thenable introspectable.
          if (thenable.status === undefined) {
            thenable.status = "fulfilled";
            thenable.value = moduleObject;
          }
        }
      },
      (error: unknown) => {
        const current = payload as LazyPayload<T>;
        if (current._status === Pending || current._status === Uninitialized) {
          Object.assign(payload, { _status: Rejected, _result: error });
          if (thenable.status === undefined) {
            thenable.status = "rejected";
            thenable.reason = error;
          }
        }
      },
    );
    // A synchronous thenable may already have settled the payload.
    if ((payload as LazyPayload<T>)._status === Uninitialized) {
      Object.assign(payload, { _status: Pending, _result: thenable });
    }
  }
  const settled = payload as LazyPayload<T>;
  if (settled._status === Resolved) {
    const moduleObject = settled._result;
    if (isDevelopment) {
      // Imports are split so that bundlers do not parse them as dependencies.
      if (moduleObject === undefined) {
        console.error(
          "lazy: Expected the result of a dynamic imp" +
            "ort() call. " +
            "Instead received: %s\n\nYour code should look like: \n  " +
            "const MyComponent = lazy(() => imp" +
            "ort('./MyComponent'))\n\n" +
            "Did you accidentally put curly braces around the import?",
          moduleObject,
        );
      }
      if (!("default" in moduleObject)) {
        console.error(
          "lazy: Expected the result of a dynamic imp" +
            "ort() call. " +
            "Instead received: %s\n\nYour code should look like: \n  " +
            "const MyComponent = lazy(() => imp" +
            "ort('./MyComponent'))",
          moduleObject,
        );
      }
    }
    return moduleObject.default;
  }
  throw settled._result;
}

export function lazy<T>(ctor: () => Thenable<ModuleObject<T>>): LazyComponent<T, LazyPayload<T>> {
  return {
    $$typeof: REACT_LAZY_TYPE,
    _payload: { _status: Uninitialized, _result: ctor },
    _init: lazyInitializer,
  };
}
