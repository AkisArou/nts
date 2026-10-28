// The testharness.js subset used by the pinned events/abort fixtures. The fixture
// and its helpers run unchanged in a fresh VM; no browser objects are fabricated.
import assert from "node:assert/strict";
import { createContext, Script } from "node:vm";
import type { Context } from "node:vm";

type Callback = (this: unknown, ...args: unknown[]) => unknown;
type Cleanup = () => unknown;

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

class WptTest {
  readonly result: WptResult;
  readonly completed: Promise<void>;
  private resolve: () => void;
  private finished = false;
  private readonly cleanups: Cleanup[] = [];
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private readonly timeout: ReturnType<typeof setTimeout>;
  private readonly harness: WptHarness;

  constructor(harness: WptHarness, name: string, timeout: number) {
    this.harness = harness;
    this.result = { name, status: "pass" };
    const completion = Promise.withResolvers<void>();
    this.completed = completion.promise;
    this.resolve = completion.resolve;
    this.timeout = setTimeout(() => this.fail(new Error(`WPT timed out: ${name}`)), timeout);
  }

  add_cleanup(cleanup: Cleanup): void {
    assert.equal(this.finished, false, "cleanup registered after test completion");
    this.cleanups.push(cleanup);
  }

  step(callback: Callback, receiver?: unknown, ...args: unknown[]): unknown {
    if (this.finished) return undefined;
    const target = arguments.length < 2 ? this : receiver;
    const previous = this.harness.active;
    this.harness.active = this;
    try {
      return Function.prototype.apply.call(callback, target, args);
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

  step_timeout(callback: Callback, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(this.step_func(callback), delay);
    this.timers.push(timer);
    return timer;
  }

  unreached_func(message = "unreachable callback called"): () => unknown {
    return this.step_func(() => assert.fail(message));
  }

  fail(error: unknown): void {
    if (this.finished) return;
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
    if (this.finished) return;
    this.finished = true;
    clearTimeout(this.timeout);
    for (const timer of this.timers) clearTimeout(timer);
    // WPT invokes cleanup callbacks in registration order, including on failure.
    for (const cleanup of this.cleanups) {
      try {
        assert.equal(cleanup(), undefined, "test/async_test cleanup must return undefined");
      } catch (error) {
        this.harness.cleanupErrors.push(error);
      }
    }
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
  private registrationClosed = false;
  private readonly timeout: number;

  constructor(
    globals: Record<string, unknown>,
    blocks: Readonly<Record<string, WptBlock>> = {},
    timeout = 5000,
  ) {
    this.blocks = blocks;
    this.timeout = timeout;
    this.context = createContext({ ...globals });
    const realmErrors = new Script("({ Error, TypeError, RangeError })").runInContext(
      this.context,
    ) as Record<string, unknown>;
    const hostErrors = { Error, TypeError, RangeError };
    Object.assign(this.context, hostErrors, {
      assert_equals: assert.strictEqual,
      assert_not_equals: assert.notStrictEqual,
      assert_true: (value: unknown, message?: string) => assert.equal(value, true, message),
      assert_false: (value: unknown, message?: string) => assert.equal(value, false, message),
      assert_unreached: (message?: string) => assert.fail(message),
      assert_array_equals: (actual: unknown[], expected: unknown[], message?: string) => {
        assert.ok(typeof actual === "object" && actual !== null && "length" in actual, message);
        assert.equal(actual.length, expected.length, message);
        for (let i = 0; i < actual.length; i++) {
          assert.equal(Object.hasOwn(actual, i), Object.hasOwn(expected, i), message);
          assert.strictEqual(actual[i], expected[i], message);
        }
      },
      assert_throws_exactly: (expected: unknown, callback: Callback, message?: string) => {
        assert.throws(callback, (error: unknown) => Object.is(error, expected), message);
      },
      assert_throws_js: (constructor: ErrorConstructor, callback: Callback, message?: string) => {
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
          // Implementation errors originate in the host module realm; syntax errors
          // can originate in the VM. Accept only the exact corresponding intrinsic,
          // never an object merely named TypeError or an arbitrary error subclass.
          const host = Object.values(hostErrors).find((value) => value === constructor);
          const alternate = host === undefined ? undefined : realmErrors[constructor.name];
          return (error.constructor === constructor ||
            (alternate !== undefined && error.constructor === alternate)) &&
            error.name === constructor.name;
        }, message);
      },
      test: (callback: Callback, name?: string) => {
        const test = this.register(name);
        if (test.result.status === "blocked") return;
        assert.equal(test.step(callback, test, test), undefined, "test callback must return undefined");
        test.done();
      },
      async_test: (callbackOrName?: Callback | string, name?: string) => {
        const callback = typeof callbackOrName === "function" ? callbackOrName : undefined;
        const test = this.register(callback === undefined ? callbackOrName as string : name);
        if (test.result.status !== "blocked" && callback !== undefined) {
          assert.equal(test.step(callback, test, test), undefined, "async_test callback must return undefined");
        }
        return test;
      },
      // All selected fixtures register their cases while their scripts execute.
      // WPT's explicit done() marks the end of registration, not completion of
      // async tests; those still have to call their own t.done().
      done: () => { this.registrationClosed = true; },
    });
  }

  private register(explicitName?: string): WptTest {
    assert.equal(this.registrationClosed, false, "test registered after done()");
    assert.equal(this.cleanupErrors.length, 0, "test registered after cleanup failure");
    const name = explicitName ?? `unnamed test ${this.tests.length + 1}`;
    assert.equal(this.names.has(name), false, `duplicate WPT test name: ${name}`);
    this.names.add(name);
    const test = new WptTest(this, name, this.timeout);
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
      new Script(source, { filename, lineOffset }).runInContext(this.context, { timeout: 5000 });
    } catch (error) {
      this.errors.push(error);
      for (const test of this.tests) test.fail(error);
    }
  }

  reportError(error: unknown): void {
    if (this.active !== null) this.active.fail(error);
    else this.errors.push(error);
  }

  async finish(): Promise<WptResult[]> {
    this.registrationClosed = true;
    await Promise.all(this.tests.map((test) => test.completed));
    for (const name of Object.keys(this.blocks)) {
      assert.ok(this.seenBlocks.has(name), `stale WPT capability exclusion: ${name}`);
    }
    if (this.errors.length !== 0 || this.cleanupErrors.length !== 0) {
      throw new AggregateError([...this.errors, ...this.cleanupErrors], "WPT harness failed");
    }
    return this.tests.map((test) => test.result);
  }
}
