// `assert.CallTracker`, from node v24.20.0
// `lib/internal/assert/calltracker.js`.
//
// Wraps a function and counts how often it was called, so that a test can
// assert "this callback ran exactly twice" without threading a counter through
// the code under test. Deprecated upstream in favour of `node:test`'s mocking,
// and kept because a great deal of code uses it.

import { ERR_INVALID_ARG_VALUE, ERR_UNAVAILABLE_DURING_EXIT } from "../../internal/errors.ts";
import { validateUint32 } from "../../internal/validators.ts";
import { AssertionError, type AssertionErrorDetail } from "./error.ts";

declare function nts_process_is_exiting(): boolean;

function noop(): void {}

/** One recorded call: what it was called on, and with what. */
export interface TrackedCall {
  thisArg: unknown;
  arguments: readonly unknown[];
}

interface ContextOptions {
  expected: number;
  /**
   * An `Error` made where `calls()` was called, kept for its stack. The
   * failure has to point at where the expectation was set up, which is not
   * where `verify()` notices it was not met.
   */
  stackTrace: Error;
  name: string;
}

class CallTrackerContext {
  #expected: number;
  #calls: TrackedCall[] = [];
  #name: string;
  #stackTrace: Error;

  constructor({ expected, stackTrace, name }: ContextOptions) {
    this.#expected = expected;
    this.#stackTrace = stackTrace;
    this.#name = name;
  }

  track(thisArg: unknown, args: readonly unknown[]): void {
    // Frozen, so that a caller mutating its arguments afterwards cannot change
    // what the record says was passed.
    const argsClone = Object.freeze(args.slice());
    this.#calls.push(Object.freeze({ thisArg, arguments: argsClone }));
  }

  get delta(): number {
    return this.#calls.length - this.#expected;
  }

  reset(): void {
    this.#calls = [];
  }

  getCalls(): readonly TrackedCall[] {
    return Object.freeze(this.#calls.slice());
  }

  report(): AssertionErrorDetail | undefined {
    if (this.delta !== 0) {
      return {
        message: `Expected the ${this.#name} function to be ` +
          `executed ${this.#expected} time(s) but was ` +
          `executed ${this.#calls.length} time(s).`,
        actual: this.#calls.length,
        expected: this.#expected,
        operator: this.#name,
        stack: this.#stackTrace.stack,
      };
    }
    return undefined;
  }
}

export class CallTracker {
  #callChecks = new Set<CallTrackerContext>();
  #trackedFunctions = new WeakMap<object, CallTrackerContext>();

  #getTrackedFunction(tracked: object): CallTrackerContext {
    const context = this.#trackedFunctions.get(tracked);
    if (context === undefined) {
      throw new ERR_INVALID_ARG_VALUE("tracked", tracked, "is not a tracked function");
    }
    return context;
  }

  /** Forget the calls recorded so far, for one function or for all of them. */
  reset(tracked?: object): void {
    if (tracked === undefined) {
      this.#callChecks.forEach((check) => check.reset());
      return;
    }
    this.#getTrackedFunction(tracked).reset();
  }

  getCalls(tracked: object): readonly TrackedCall[] {
    return this.#getTrackedFunction(tracked).getCalls();
  }

  /**
   * A wrapper around `fn` that records its calls and expects `expected` of
   * them.
   *
   * A `Proxy` rather than a wrapping function, so the result keeps the
   * original's name, length and identity as far as anything else can see --
   * code that inspects the callback it was handed sees the real one.
   */
  calls<T extends (...args: never[]) => unknown>(fn?: T | number, expected = 1): T {
    if (nts_process_is_exiting()) {
      throw new ERR_UNAVAILABLE_DURING_EXIT();
    }
    let target: (...args: never[]) => unknown;
    if (typeof fn === "number") {
      expected = fn;
      target = noop;
    } else if (fn === undefined) {
      target = noop;
    } else {
      target = fn;
    }

    validateUint32(expected, "expected", true);

    const context = new CallTrackerContext({
      expected,
      stackTrace: new Error(),
      name: target.name || "calls",
    });
    const tracked = new Proxy(target, {
      __proto__: null,
      apply(inner, thisArg, argList): unknown {
        context.track(thisArg, argList);
        return Reflect.apply(inner, thisArg, argList);
      },
    } as ProxyHandler<(...args: never[]) => unknown>) as T;
    this.#callChecks.add(context);
    this.#trackedFunctions.set(tracked as object, context);
    return tracked;
  }

  /** Every expectation not met, as the details an `AssertionError` carries. */
  report(): AssertionErrorDetail[] {
    const errors: AssertionErrorDetail[] = [];
    for (const context of this.#callChecks) {
      const detail = context.report();
      if (detail !== undefined) {
        errors.push(detail);
      }
    }
    return errors;
  }

  /** Throw if any tracked function was called the wrong number of times. */
  verify(): void {
    const errors = this.report();
    if (errors.length === 0) {
      return;
    }
    const message = errors.length === 1
      ? errors[0]!.message
      : "Functions were not called the expected number of times";
    throw new AssertionError({ message, details: errors });
  }
}
