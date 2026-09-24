// `act`: runs a callback, then flushes the work it scheduled before
// returning, so that a test sees the result. Development only.
//
// While an `act` scope is open, the reconciler queues its tasks on
// `ReactSharedInternals.actQueue` instead of the scheduler, and this module
// flushes them. Errors thrown by those tasks are collected and rethrown.

import { isDevelopment } from "shared/Build.ts";
import { enqueueTask } from "shared/enqueueTask.ts";
import type { RendererTask, Thenable } from "shared/ReactTypes.ts";
import { ReactSharedInternals } from "./ReactSharedInternals.ts";

let actScopeDepth = 0;
let didWarnNoAwaitAct = false;

function aggregateErrors(errors: unknown[]): unknown {
  if (errors.length > 1 && typeof AggregateError === "function") {
    return new AggregateError(errors);
  }
  return errors[0];
}

function takeThrownError(): unknown {
  const thrownError = aggregateErrors(ReactSharedInternals.thrownErrors);
  ReactSharedInternals.thrownErrors.length = 0;
  return thrownError;
}

type Resolve<T> = (value: T) => unknown;
type Reject = (error: unknown) => unknown;

export function act<T>(callback: () => T | Thenable<T>): Thenable<T> {
  if (!isDevelopment) {
    throw new Error("act(...) is not supported in production builds of React.");
  }
  const prevActQueue = ReactSharedInternals.actQueue;
  const prevActScopeDepth = actScopeDepth;
  actScopeDepth++;
  const queue = (ReactSharedInternals.actQueue = prevActQueue !== null ? prevActQueue : []);

  let result: T | Thenable<T> | undefined;
  let didAwaitActCall = false;
  try {
    result = callback();
  } catch (error) {
    ReactSharedInternals.thrownErrors.push(error);
  }
  if (ReactSharedInternals.thrownErrors.length > 0) {
    popActScope(prevActQueue, prevActScopeDepth);
    throw takeThrownError();
  }

  if (result !== null && typeof result === "object" && typeof (result as { then?: unknown }).then === "function") {
    // An async scope: flush after it resolves, and keep flushing until
    // nothing more is queued.
    const thenable = result as Thenable<T>;
    queueSeveralMicrotasks(() => {
      if (!didAwaitActCall && !didWarnNoAwaitAct) {
        didWarnNoAwaitAct = true;
        console.error(
          "You called act(async () => ...) without await. " +
            "This could lead to unexpected testing behaviour, " +
            "interleaving multiple act calls and mixing their " +
            "scopes. " +
            "You should - await act(async () => ...);",
        );
      }
    });
    return {
      then(resolve: Resolve<T>, reject: Reject) {
        didAwaitActCall = true;
        thenable.then(
          (returnValue) => {
            popActScope(prevActQueue, prevActScopeDepth);
            if (prevActScopeDepth === 0) {
              // The outermost scope flushes what the others queued.
              try {
                flushActQueue(queue);
                enqueueTask(() => recursivelyFlushAsyncActWork(returnValue, resolve, reject));
              } catch (error) {
                ReactSharedInternals.thrownErrors.push(error);
              }
              if (ReactSharedInternals.thrownErrors.length > 0) {
                reject(takeThrownError());
              }
            } else {
              resolve(returnValue);
            }
          },
          (error) => {
            popActScope(prevActQueue, prevActScopeDepth);
            if (ReactSharedInternals.thrownErrors.length > 0) {
              reject(takeThrownError());
            } else {
              reject(error);
            }
          },
        );
      },
    };
  }

  const returnValue = result as T;
  // A sync scope: flush now. Suspended work that is still queued needs an
  // awaited `act` to finish.
  popActScope(prevActQueue, prevActScopeDepth);
  if (prevActScopeDepth === 0) {
    flushActQueue(queue);
    if (queue.length !== 0) {
      queueSeveralMicrotasks(() => {
        if (!didAwaitActCall && !didWarnNoAwaitAct) {
          didWarnNoAwaitAct = true;
          console.error(
            "A component suspended inside an `act` scope, but the " +
              "`act` call was not awaited. When testing React " +
              "components that depend on asynchronous data, you must " +
              "await the result:\n\n" +
              "await act(() => ...)",
          );
        }
      });
    }
    // Leave the queue to the awaiting thenable, if any.
    ReactSharedInternals.actQueue = null;
  }
  if (ReactSharedInternals.thrownErrors.length > 0) {
    throw takeThrownError();
  }
  return {
    then(resolve: Resolve<T>, _reject: Reject) {
      didAwaitActCall = true;
      if (prevActScopeDepth === 0) {
        // The scope was awaited: keep flushing, including suspended work
        // that resolves later.
        ReactSharedInternals.actQueue = queue;
        enqueueTask(() => recursivelyFlushAsyncActWork(returnValue, resolve, _reject));
      } else {
        resolve(returnValue);
      }
    },
  };
}

function popActScope(_prevActQueue: RendererTask[] | null, prevActScopeDepth: number): void {
  if (prevActScopeDepth !== actScopeDepth - 1) {
    console.error(
      "You seem to have overlapping act() calls, this is not supported. " +
        "Be sure to await previous act() calls before making a new one. ",
    );
  }
  actScopeDepth = prevActScopeDepth;
}

function recursivelyFlushAsyncActWork<T>(returnValue: T, resolve: Resolve<T>, reject: Reject): void {
  const queue = ReactSharedInternals.actQueue;
  if (queue !== null) {
    if (queue.length !== 0) {
      // Async work was queued since the last flush: flush it and check
      // again on a later turn.
      try {
        flushActQueue(queue);
        enqueueTask(() => recursivelyFlushAsyncActWork(returnValue, resolve, reject));
        return;
      } catch (error) {
        ReactSharedInternals.thrownErrors.push(error);
      }
    } else {
      // Nothing left: exit the scope.
      ReactSharedInternals.actQueue = null;
    }
  }
  if (ReactSharedInternals.thrownErrors.length > 0) {
    reject(takeThrownError());
  } else {
    resolve(returnValue);
  }
}

let isFlushing = false;

function flushActQueue(queue: RendererTask[]): void {
  if (isFlushing) {
    return;
  }
  // Prevent re-entrance.
  isFlushing = true;
  let i = 0;
  try {
    for (; i < queue.length; i++) {
      let callback = queue[i]!;
      for (;;) {
        ReactSharedInternals.didUsePromise = false;
        const continuation = callback(false);
        if (continuation == null) {
          break;
        }
        if (ReactSharedInternals.didUsePromise) {
          // The task suspended on a promise: keep it at the head and stop,
          // it is resumed when the promise settles.
          queue[i] = callback;
          queue.splice(0, i);
          return;
        }
        callback = continuation;
      }
    }
    queue.length = 0;
  } catch (error) {
    // Drop the task that threw, keep the rest.
    queue.splice(0, i + 1);
    ReactSharedInternals.thrownErrors.push(error);
  } finally {
    isFlushing = false;
  }
}

// A few microtasks from now: late enough that an `await act(...)` would have
// called `then`, which is what the warnings check.
function queueSeveralMicrotasks(callback: () => void): void {
  queueMicrotask(() => queueMicrotask(callback));
}
