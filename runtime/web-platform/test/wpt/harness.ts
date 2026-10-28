// A shared, deliberately bounded testharness.js adapter. Fixtures and explicitly
// supplied dependencies run unchanged in a fresh VM; platform globals are injected.
// Semantics: resources/testharness.js at WPT 6a2f32237615d7ea9c1eb1e30453066b5555c603.
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { createContext, Script } from "node:vm";
import type { Context } from "node:vm";

type Callback = (this: unknown, ...args: unknown[]) => unknown;
type Cleanup = () => unknown;
type TestKind = "sync" | "async" | "promise";

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return ((typeof value === "object" && value !== null) || typeof value === "function") &&
    "then" in value && typeof value.then === "function";
}

const apply = Function.prototype.call.bind(Function.prototype.apply) as (
  callback: Callback, receiver: unknown, args: unknown[],
) => unknown;

// Names and legacy codes accepted by the pinned assert_throws_dom implementation.
// QuotaExceededError uses a separate assertion there and is deliberately unsupported here.
const domExceptionCodes: Readonly<Record<string, number>> = {
  IndexSizeError: 1, HierarchyRequestError: 3, WrongDocumentError: 4,
  InvalidCharacterError: 5, NoModificationAllowedError: 7, NotFoundError: 8,
  NotSupportedError: 9, InUseAttributeError: 10, InvalidStateError: 11, SyntaxError: 12,
  InvalidModificationError: 13, NamespaceError: 14, InvalidAccessError: 15,
  TypeMismatchError: 17, SecurityError: 18, NetworkError: 19, AbortError: 20,
  URLMismatchError: 21, TimeoutError: 23, InvalidNodeTypeError: 24, DataCloneError: 25,
  EncodingError: 0, NotReadableError: 0, UnknownError: 0, ConstraintError: 0,
  DataError: 0, TransactionInactiveError: 0, ReadOnlyError: 0, VersionError: 0,
  OperationError: 0, NotAllowedError: 0, OptOutError: 0,
};
const domExceptionAliases: Readonly<Record<string, string>> = {
  INDEX_SIZE_ERR: "IndexSizeError", HIERARCHY_REQUEST_ERR: "HierarchyRequestError",
  WRONG_DOCUMENT_ERR: "WrongDocumentError", INVALID_CHARACTER_ERR: "InvalidCharacterError",
  NO_MODIFICATION_ALLOWED_ERR: "NoModificationAllowedError", NOT_FOUND_ERR: "NotFoundError",
  NOT_SUPPORTED_ERR: "NotSupportedError", INUSE_ATTRIBUTE_ERR: "InUseAttributeError",
  INVALID_STATE_ERR: "InvalidStateError", SYNTAX_ERR: "SyntaxError",
  INVALID_MODIFICATION_ERR: "InvalidModificationError", NAMESPACE_ERR: "NamespaceError",
  INVALID_ACCESS_ERR: "InvalidAccessError", TYPE_MISMATCH_ERR: "TypeMismatchError",
  SECURITY_ERR: "SecurityError", NETWORK_ERR: "NetworkError", ABORT_ERR: "AbortError",
  URL_MISMATCH_ERR: "URLMismatchError", TIMEOUT_ERR: "TimeoutError",
  INVALID_NODE_TYPE_ERR: "InvalidNodeTypeError", DATA_CLONE_ERR: "DataCloneError",
};

function objectEquals(actual: unknown, expected: unknown, message?: string): void {
  assert.ok(typeof actual === "object" && actual !== null, message);
  // Preserve the pinned legacy assertion's weakness: recursive comparison only
  // enumerates properties, so an empty view can compare equal to undefined.
  function checkEqual(actual: unknown, expected: unknown, stack: unknown[]): void {
    const left = actual as Record<string, unknown>;
    const right = expected as Record<string, unknown>;
    stack.push(actual);
    for (const key in left) {
      assert.ok(right.hasOwnProperty(key), message);
      if (typeof left[key] === "object" && left[key] !== null) {
        if (stack.indexOf(left[key]) === -1) checkEqual(left[key], right[key], stack);
      } else {
        const equal = Object.is(left[key], right[key]);
        // Upstream reads both properties again while building its diagnostic.
        void right[key];
        void left[key];
        assert.ok(equal, message);
      }
    }
    for (const key in right) assert.ok(left.hasOwnProperty(key), message);
    stack.pop();
  }
  checkEqual(actual, expected, []);
}

export interface WptResult {
  name: string;
  status: "pass" | "fail" | "blocked";
  error?: unknown;
  reason?: string;
}

export interface WptBlock {
  category: string;
  reason: string;
}

export interface WptHarnessOptions {
  exposeSelf?: boolean;
}

class WptTest {
  readonly result: WptResult;
  readonly completed: Promise<void>;
  private resolve: () => void;
  private ending = false;
  private finished = false;
  private readonly cleanups: Cleanup[] = [];
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private readonly timeoutMilliseconds: number;
  private readonly kind: TestKind;
  private readonly harness: WptHarness;

  constructor(harness: WptHarness, name: string, timeout: number, kind: TestKind) {
    this.harness = harness;
    this.result = { name, status: "pass" };
    const completion = Promise.withResolvers<void>();
    this.completed = completion.promise;
    this.resolve = completion.resolve;
    this.timeoutMilliseconds = timeout;
    this.kind = kind;
    if (kind !== "promise") this.start();
  }

  get closed(): boolean { return this.ending; }

  start(): void {
    if (this.timeout !== undefined || this.ending) return;
    this.timeout = setTimeout(() => {
      const error = new Error(`WPT timed out: ${this.result.name}`);
      if (this.ending) {
        this.harness.cleanupErrors.push(error);
        this.complete();
      } else this.fail(error);
    }, this.timeoutMilliseconds);
  }

  add_cleanup(cleanup: Cleanup): void {
    assert.equal(this.ending, false, "cleanup registered after test completion");
    this.cleanups.push(cleanup);
  }

  step(callback: Callback, receiver?: unknown, ...args: unknown[]): unknown {
    if (this.ending) return undefined;
    const target = arguments.length < 2 ? this : receiver;
    const previous = this.harness.active;
    this.harness.active = this;
    try {
      return this.harness.inTest(this, () => apply(callback, target, args));
    } catch (error) {
      // EventTarget catches listener exceptions. Recording here, rather than just
      // rethrowing, prevents an assertion swallowed by dispatch from becoming a pass.
      this.fail(error);
      return undefined;
    } finally {
      this.harness.active = previous;
    }
  }

  step_func(callback: Callback, receiver?: unknown): (...args: unknown[]) => unknown {
    const target = arguments.length < 2 ? this : receiver;
    return (...args) => this.step(callback, target, ...args);
  }

  step_func_done(callback?: Callback, receiver?: unknown): (...args: unknown[]) => void {
    const target = arguments.length < 2 ? this : receiver;
    return (...args) => {
      if (callback !== undefined) this.step(callback, target, ...args);
      this.done();
    };
  }

  step_timeout(callback: Callback, delay = 0, ...args: unknown[]): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => this.step(callback, this, ...args), delay);
    this.timers.push(timer);
    return timer;
  }

  unreached_func(message = "unreachable callback called"): () => unknown {
    return this.step_func(() => assert.fail(message));
  }

  fail(error: unknown): void {
    if (this.ending) {
      if (this.result.status === "pass") this.harness.recordError(error);
      return;
    }
    this.result.status = "fail";
    this.result.error = error;
    this.done();
  }

  block(reason: string): void {
    this.result.status = "blocked";
    this.result.reason = reason;
    this.done();
  }

  done(): void {
    if (this.ending) return;
    this.ending = true;
    clearTimeout(this.timeout);
    for (const timer of this.timers) clearTimeout(timer);
    // WPT invokes cleanup callbacks in registration order, including on failure.
    const pending: Promise<unknown>[] = [];
    for (const cleanup of this.cleanups) {
      try {
        const result = this.harness.inTest(this, cleanup);
        if (this.kind === "promise" && isThenable(result)) {
          pending.push(Promise.resolve(result).catch((error: unknown) => {
            this.harness.cleanupErrors.push(error);
          }));
        } else {
          if (isThenable(result)) {
            // Observe even an invalid cleanup promise, avoiding an unhandled rejection.
            void Promise.resolve(result).catch((error: unknown) => this.harness.recordError(error));
          }
          assert.equal(result, undefined, "cleanup must return undefined, or a promise for promise_test");
        }
      } catch (error) {
        this.harness.cleanupErrors.push(error);
      }
    }
    if (pending.length === 0) this.complete();
    else {
      this.timeout = setTimeout(() => {
        this.harness.cleanupErrors.push(new Error(`WPT cleanup timed out: ${this.result.name}`));
        this.complete();
      }, this.timeoutMilliseconds);
      void Promise.all(pending).then(() => this.complete());
    }
  }

  private complete(): void {
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timeout);
    this.resolve();
  }
}

/** Test-only runner; the public implementation is supplied by the host provider. */
export class WptHarness {
  active: WptTest | null = null;
  readonly cleanupErrors: unknown[] = [];
  private readonly tests: WptTest[] = [];
  private readonly blocks: Readonly<Record<string, WptBlock>>;
  private readonly seenBlocks = new Set<string>();
  private readonly names = new Set<string>();
  private readonly context: Context;
  private readonly errors: unknown[] = [];
  private readonly asyncTest = new AsyncLocalStorage<WptTest>();
  private promiseQueue: Promise<void> = Promise.resolve();
  private explicitDone = false;
  private readonly registrationDone = Promise.withResolvers<void>();
  private registrationClosed = false;
  private readonly timeout: number;
  private readonly globalTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    globals: Record<string, unknown>,
    blocks: Readonly<Record<string, WptBlock>> = {},
    timeout = 10000,
    options: WptHarnessOptions = {},
  ) {
    this.blocks = blocks;
    assert.ok(Number.isSafeInteger(timeout) && timeout > 0, "WPT timeout must be positive integer milliseconds");
    this.timeout = timeout;
    this.context = createContext({ ...globals });
    const fixtureGlobal = new Script("globalThis").runInContext(this.context) as object;
    if (options.exposeSelf) Object.assign(this.context, { self: fixtureGlobal });
    const harness = this;
    function stepTimeout(this: unknown, callback: Callback, delay = 0, ...args: unknown[]): ReturnType<typeof setTimeout> {
      assert.equal(typeof callback, "function", "step_timeout requires a callback");
      // Upstream's global helper is non-strict and preserves its call receiver.
      const receiver = this === undefined || this === null ? fixtureGlobal : Object(this);
      const timer = setTimeout(() => {
        harness.globalTimers.delete(timer);
        try { apply(callback, receiver, args); }
        catch (error) { harness.reportError(error); }
      }, delay);
      harness.globalTimers.add(timer);
      return timer;
    }
    const realmErrors = new Script("({ Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError, AggregateError })").runInContext(
      this.context,
    ) as Record<string, unknown>;
    const hostErrors = { Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError, AggregateError };
    const throwsJs = (constructor: ErrorConstructor, callback: Callback, message?: string): void => {
      assert.equal(typeof constructor, "function", "expected an Error constructor");
      let parent: object | null = constructor;
      while (parent !== null) {
        if (typeof parent === "function" && parent.name === "Error") break;
        parent = Object.getPrototypeOf(parent) as object | null;
      }
      assert.notEqual(parent, null, "constructor is not an Error subtype");
      assert.throws(callback, (error: unknown) => {
        if (typeof error !== "object" || error === null) return false;
        if (!("constructor" in error) || !("name" in error)) return false;
        // Host implementation exceptions and VM intrinsic exceptions are distinct realms.
        const host = Object.values(hostErrors).find((value) => value === constructor);
        const alternate = host === undefined ? undefined : realmErrors[constructor.name];
        return (error.constructor === constructor ||
          (alternate !== undefined && error.constructor === alternate)) &&
          error.name === constructor.name;
      }, message);
    };
    const throwsDom = (
      type: string | number, callbackOrConstructor: Callback,
      messageOrCallback?: string | Callback, maybeMessage?: string,
    ): void => {
      assert.ok(typeof type === "string" || typeof type === "number", "expected a DOMException name or code");
      const explicitConstructor = callbackOrConstructor.name === "DOMException";
      const constructor = explicitConstructor ? callbackOrConstructor : globals.DOMException;
      const callback = explicitConstructor ? messageOrCallback : callbackOrConstructor;
      const message = explicitConstructor ? maybeMessage : messageOrCallback;
      assert.equal(typeof constructor, "function", "inject the implementation's DOMException constructor");
      assert.equal(typeof callback, "function", "expected a throwing callback");
      assert.ok(message === undefined || typeof message === "string", "expected an assertion description");
      if (!explicitConstructor) assert.equal(maybeMessage, undefined, "unexpected DOM assertion argument");
      let name: string | undefined;
      if (typeof type === "number") {
        assert.notEqual(type, 0, "DOMException code zero is ambiguous");
        name = Object.keys(domExceptionCodes).find((key) => domExceptionCodes[key] === type);
      } else name = domExceptionAliases[type] ?? type;
      assert.ok(name !== undefined && Object.hasOwn(domExceptionCodes, name), "unsupported DOMException name or code");
      const code = domExceptionCodes[name];
      assert.throws(callback as Callback, (error: unknown) => {
        if (typeof error !== "object" || error === null || !("code" in error)) return false;
        // The pinned assertion compares legacy DOMException codes with ==.
        if (error.constructor !== constructor || error.code != code) return false;
        if (code === 0) return "name" in error && error.name === name;
        if ("name" in error) {
          if (typeof error.name !== "string") return false;
          if (error.name !== error.name.toUpperCase() && error.name !== "DOMException") return error.name === name;
        }
        return true;
      }, message);
    };
    const rejects = (test: WptTest, promise: unknown, check: (reason: unknown) => void): Promise<void> => {
      assert.ok(test instanceof WptTest, "expected the owning WPT test");
      assert.ok(isThenable(promise), "expected a rejecting promise");
      const result = Promise.resolve(promise).then(
        () => assert.fail("expected promise to reject"), check,
      );
      // Record failure even if a fixture accidentally omits awaiting the assertion.
      void result.catch((error: unknown) => test.fail(error));
      return result;
    };
    Object.assign(this.context, hostErrors, {
      assert_equals: assert.strictEqual,
      assert_not_equals: assert.notStrictEqual,
      assert_true: (value: unknown, message?: string) => assert.equal(value, true, message),
      assert_false: (value: unknown, message?: string) => assert.equal(value, false, message),
      assert_greater_than: (actual: unknown, expected: unknown, message?: string) => {
        assert.ok(typeof actual === "number" || typeof actual === "bigint", message);
        assert.equal(typeof actual, typeof expected, message);
        assert.ok(actual > (expected as number | bigint), message);
      },
      assert_unreached: (message?: string) => assert.fail(message),
      assert_array_equals: (actual: unknown[], expected: unknown[], message?: string) => {
        assert.ok(typeof actual === "object" && actual !== null && "length" in actual, message);
        assert.equal(actual.length, expected.length, message);
        for (let i = 0; i < actual.length; i++) {
          assert.equal(Object.hasOwn(actual, i), Object.hasOwn(expected, i), message);
          assert.strictEqual(actual[i], expected[i], message);
        }
      },
      assert_object_equals: (actual: unknown, expected: unknown, message?: string) => objectEquals(actual, expected, message),
      assert_throws_exactly: (expected: unknown, callback: Callback, message?: string) => {
        assert.throws(callback, (error: unknown) => Object.is(error, expected), message);
      },
      assert_throws_js: throwsJs,
      assert_throws_dom: throwsDom,
      promise_rejects_js: (test: WptTest, constructor: ErrorConstructor, promise: unknown, message?: string) =>
        rejects(test, promise, (reason) => throwsJs(constructor, () => { throw reason; }, message)),
      promise_rejects_exactly: (test: WptTest, expected: unknown, promise: unknown, message?: string) =>
        rejects(test, promise, (reason) => assert.strictEqual(reason, expected, message)),
      promise_rejects_dom: (
        test: WptTest, type: string | number, promiseOrConstructor: unknown,
        messageOrPromise?: unknown, maybeMessage?: string,
      ) => {
        const explicit = typeof promiseOrConstructor === "function" && promiseOrConstructor.name === "DOMException";
        const promise = explicit ? messageOrPromise : promiseOrConstructor;
        const message = explicit ? maybeMessage : messageOrPromise;
        assert.ok(message === undefined || typeof message === "string", "expected an assertion description");
        if (!explicit) assert.equal(maybeMessage, undefined, "unexpected DOM rejection assertion argument");
        return rejects(test, promise, (reason) => {
          const callback = (): never => { throw reason; };
          if (explicit) throwsDom(type, promiseOrConstructor as Callback, callback, message);
          else throwsDom(type, callback, message);
        });
      },
      test: (callback: Callback, name?: string) => {
        const test = this.register(name, "sync");
        if (test.result.status === "blocked") return;
        this.checkSynchronousResult(test.step(callback, test, test), "test callback");
        test.done();
      },
      async_test: (callbackOrName?: Callback | string, name?: string) => {
        const callback = typeof callbackOrName === "function" ? callbackOrName : undefined;
        const test = this.register(callback === undefined ? callbackOrName as string : name, "async");
        if (test.result.status !== "blocked" && callback !== undefined) {
          this.checkSynchronousResult(test.step(callback, test, test), "async_test callback");
        }
        return test;
      },
      promise_test: (callback: Callback, name?: string) => {
        const test = this.register(name, "promise");
        if (test.result.status === "blocked") return;
        this.promiseQueue = this.promiseQueue.then(async () => {
          if (this.cleanupErrors.length !== 0 || this.errors.length !== 0) {
            test.fail(new Error("WPT aborted after a harness or cleanup error"));
            return;
          }
          test.start();
          const result = test.step(callback, test, test);
          test.step(() => assert.ok(isThenable(result), "promise_test callback must return a thenable"));
          void Promise.resolve(result).then(() => test.done(), (error: unknown) => test.fail(error));
          await test.completed;
        });
      },
      setup: (callbackOrOptions?: Callback | Record<string, unknown>, options?: Record<string, unknown>) => {
        assert.equal(this.tests.length, 0, "setup must precede test registration in this adapter");
        const callback = typeof callbackOrOptions === "function" ? callbackOrOptions : undefined;
        const properties = callback === undefined ? callbackOrOptions : options;
        if (properties !== undefined) {
          assert.ok(typeof properties === "object" && properties !== null, "setup options must be an object");
          for (const [key, value] of Object.entries(properties)) {
            assert.equal(key, "explicit_done", `unsupported WPT setup option: ${key}`);
            assert.ok(typeof value === "boolean", "explicit_done must be boolean");
            this.explicitDone = value;
          }
        }
        if (callback !== undefined) this.checkSynchronousResult(apply(callback, undefined, []), "setup callback");
      },
      done: () => this.closeRegistration(),
      step_timeout: stepTimeout,
    });
  }

  private register(explicitName: string | undefined, kind: TestKind): WptTest {
    assert.equal(this.registrationClosed, false, "test registered after done()");
    assert.equal(this.cleanupErrors.length, 0, "test registered after cleanup failure");
    const name = explicitName ?? `unnamed test ${this.tests.length + 1}`;
    assert.equal(this.names.has(name), false, `duplicate WPT test name: ${name}`);
    this.names.add(name);
    const test = new WptTest(this, name, this.timeout, kind);
    this.tests.push(test);
    const blocked = this.blocks[name];
    if (blocked !== undefined) {
      this.seenBlocks.add(name);
      test.block(`${blocked.category}: ${blocked.reason}`);
    }
    return test;
  }

  run(source: string, filename: string, lineOffset = 0): void {
    try {
      new Script(source, { filename, lineOffset }).runInContext(this.context, { timeout: this.timeout });
    } catch (error) {
      this.errors.push(error);
      for (const test of this.tests) test.fail(error);
    }
  }

  reportError(error: unknown): void {
    const test = this.active ?? this.asyncTest.getStore();
    if (test !== undefined && test !== null && !test.closed) test.fail(error);
    else this.recordError(error);
  }

  recordError(error: unknown): void { this.errors.push(error); }

  inTest<T>(test: WptTest, callback: () => T): T {
    return this.asyncTest.run(test, callback);
  }

  private checkSynchronousResult(result: unknown, description: string): void {
    if (isThenable(result)) {
      void Promise.resolve(result).catch((error: unknown) => this.recordError(error));
    }
    assert.equal(result, undefined, `${description} must return undefined`);
  }

  private closeRegistration(): void {
    this.registrationClosed = true;
    this.registrationDone.resolve();
  }

  async finish(): Promise<WptResult[]> {
    if (!this.explicitDone || this.errors.length !== 0) this.closeRegistration();
    const registrationTimeout = setTimeout(() => {
      this.recordError(new Error("WPT explicit_done setup requires a call to done()"));
      this.closeRegistration();
    }, this.timeout);
    try {
      await this.registrationDone.promise;
      clearTimeout(registrationTimeout);
      await this.promiseQueue;
      await Promise.all(this.tests.map((test) => test.completed));
      for (const name of Object.keys(this.blocks)) {
        assert.ok(this.seenBlocks.has(name), `stale WPT capability exclusion: ${name}`);
      }
      if (this.errors.length !== 0 || this.cleanupErrors.length !== 0) {
        throw new AggregateError([...this.errors, ...this.cleanupErrors], "WPT harness failed");
      }
      return this.tests.map((test) => test.result);
    } finally {
      clearTimeout(registrationTimeout);
      for (const timer of this.globalTimers) clearTimeout(timer);
      this.globalTimers.clear();
    }
  }
}
