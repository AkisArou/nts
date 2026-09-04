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
    // A rest array belongs to this invocation, so retaining it records the
    // call without another copy. `getCalls` copies it before exposing it.
    this.#calls.push({ thisArg, arguments: args });
  }

  get delta(): number {
    return this.#calls.length - this.#expected;
  }

  reset(): void {
    this.#calls = [];
  }

  getCalls(): readonly TrackedCall[] {
    const copy = new Array<TrackedCall>(this.#calls.length);
    for (let i = 0; i < this.#calls.length; i++) {
      const call = this.#calls[i];
      if (call === undefined) continue;
      copy[i] = { thisArg: call.thisArg, arguments: call.arguments.slice() };
    }
    return copy;
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
  #trackedFunctions = new WeakMap<CallableFunction, CallTrackerContext>();

  #getTrackedFunction(tracked: unknown): CallTrackerContext {
    if (typeof tracked !== "function") {
      throw new ERR_INVALID_ARG_VALUE("tracked", tracked, "is not a tracked function");
    }
    const context = this.#trackedFunctions.get(tracked);
    if (context === undefined) {
      throw new ERR_INVALID_ARG_VALUE("tracked", tracked, "is not a tracked function");
    }
    return context;
  }

  /** Forget the calls recorded so far, for one function or for all of them. */
  reset(): void;
  reset(tracked: CallableFunction): void;
  reset(tracked?: unknown): void {
    if (tracked === undefined) {
      for (const check of this.#callChecks) check.reset();
      return;
    }
    this.#getTrackedFunction(tracked).reset();
  }

  getCalls(tracked: CallableFunction): readonly TrackedCall[];
  getCalls(tracked: unknown): readonly TrackedCall[] {
    return this.#getTrackedFunction(tracked).getCalls();
  }

  /**
   * A wrapper around `fn` that records its calls and expects `expected` of
   * them.
   *
   * Function metadata and transparent proxy identity belong to JavaScript's
   * metaobject protocol. The compiled API instead returns an ordinary,
   * precisely typed forwarding closure.
   */
  calls(expected?: number): (...args: unknown[]) => void;
  calls<This, Args extends unknown[], Result>(
    fn: (this: This, ...args: Args) => Result,
    expected?: number,
  ): (this: This, ...args: Args) => Result;
  calls<This, Args extends unknown[], Result>(
    fn?: ((this: This, ...args: Args) => Result) | number,
    expected = 1,
  ): CallableFunction {
    if (nts_process_is_exiting()) {
      throw new ERR_UNAVAILABLE_DURING_EXIT();
    }
    let target: ((this: This, ...args: Args) => Result) | undefined;
    if (typeof fn === "number") {
      expected = fn;
    } else if (fn === undefined) {
    } else {
      target = fn;
    }

    validateUint32(expected, "expected", true);

    const context = new CallTrackerContext({
      expected,
      stackTrace: new Error(),
      // Observable function names are a section-13 non-goal. The operation's
      // stable public name remains useful in diagnostics.
      name: "calls",
    });
    const tracked = function (this: This, ...args: Args): Result | void {
      context.track(this, args);
      if (target !== undefined) return target.call(this, ...args);
    };
    this.#callChecks.add(context);
    this.#trackedFunctions.set(tracked, context);
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
    const first = errors[0];
    const message = errors.length === 1 && first !== undefined
      ? first.message
      : "Functions were not called the expected number of times";
    throw new AssertionError({ message, details: errors });
  }
}
