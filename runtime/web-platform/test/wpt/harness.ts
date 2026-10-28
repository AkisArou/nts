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

// Formatting is observable in the unchanged FileAPI registration names. Follow
// resources/testharness.js:1304-1497 at the pin above, including shared references,
// sparse arrays, control-character spelling and the 1000-character truncation.
const controlEscapes = [
  "0", "x01", "x02", "x03", "x04", "x05", "x06", "x07",
  "b", "t", "n", "v", "f", "r", "x0e", "x0f",
  "x10", "x11", "x12", "x13", "x14", "x15", "x16", "x17",
  "x18", "x19", "x1a", "x1b", "x1c", "x1d", "x1e", "x1f",
] as const;

function truncate(value: string, length: number): string {
  return value.length > length ? value.substring(0, length - 3) + "..." : value;
}

function isNode(value: object): boolean {
  try {
    if (!("nodeType" in value && "nodeName" in value && "nodeValue" in value && "childNodes" in value)) return false;
    void value.nodeType;
    return true;
  } catch {
    return false;
  }
}

function formatValue(value: unknown, seen: unknown[] = [], nodeConstants?: Record<string, unknown>): string {
  if (!seen) seen = [];
  if (typeof value === "object" && value !== null) {
    if (seen.indexOf(value) >= 0) return "[...]";
    seen.push(value);
  }
  if (Array.isArray(value)) {
    const array = value as unknown[] & { beginEllipsis?: unknown; endEllipsis?: unknown };
    let output = "[";
    if (array.beginEllipsis !== undefined) output += "…, ";
    output += array.map((item) => formatValue(item, seen, nodeConstants)).join(", ");
    if (array.endEllipsis !== undefined) output += ", …";
    return output + "]";
  }
  if (typeof value === "string") {
    return '"' + value.replace(/[\\"\u0000-\u001f\ufffd-\uffff]/g, (character) => {
      if (character === "\\") return "\\\\";
      if (character === '"') return '\\"';
      const unit = character.charCodeAt(0);
      return "\\" + (unit < 32 ? controlEscapes[unit] : "u" + unit.toString(16));
    }) + '"';
  }
  if (typeof value === "boolean" || typeof value === "undefined") return String(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (value === null) return "null";
  if (typeof value === "object" && isNode(value)) {
    // No DOM is fabricated. These descriptions are available only if a driver
    // explicitly supplies its real Node interface, as upstream requires.
    if (nodeConstants === undefined) throw new ReferenceError("Node is not defined");
    const node = value as Record<string, unknown>;
    switch (node.nodeType) {
      case nodeConstants.ELEMENT_NODE: {
        let text = "<" + node.localName;
        const attributes = node.attributes as ArrayLike<{ name: string; value: string }>;
        for (let i = 0; i < attributes.length; i++) {
          text += " " + attributes[i]!.name + '="' + attributes[i]!.value + '"';
        }
        text += ">" + node.innerHTML + "</" + node.localName + ">";
        return "Element node " + truncate(text, 60);
      }
      case nodeConstants.TEXT_NODE:
        return 'Text node "' + truncate(node.data as string, 60) + '"';
      case nodeConstants.PROCESSING_INSTRUCTION_NODE:
        return "ProcessingInstruction node with target " + formatValue(truncate(node.target as string, 60), undefined, nodeConstants) +
          " and data " + formatValue(truncate(node.data as string, 60), undefined, nodeConstants);
      case nodeConstants.COMMENT_NODE:
        return "Comment node <!--" + truncate(node.data as string, 60) + "-->";
      case nodeConstants.DOCUMENT_NODE: {
        const childNodes = node.childNodes as ArrayLike<unknown>;
        return "Document node with " + childNodes.length + (childNodes.length === 1 ? " child" : " children");
      }
      case nodeConstants.DOCUMENT_TYPE_NODE:
        return "DocumentType node";
      case nodeConstants.DOCUMENT_FRAGMENT_NODE: {
        const childNodes = node.childNodes as ArrayLike<unknown>;
        return "DocumentFragment node with " + childNodes.length + (childNodes.length === 1 ? " child" : " children");
      }
      default:
        return "Node object of unknown type";
    }
  }
  try {
    return typeof value + ' "' + truncate(String(value), 1000) + '"';
  } catch (error) {
    return "[stringifying object threw " + String(error) + " with type " + String(typeof error) + "]";
  }
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

/** Schedule a harness deadline and return its idempotent cancellation. */
export type WptDeadlineScheduler = (callback: () => void, milliseconds: number) => () => void;

const hostDeadline: WptDeadlineScheduler = (callback, milliseconds) => {
  const timer = setTimeout(callback, milliseconds);
  return () => clearTimeout(timer);
};

export interface WptHarnessOptions {
  exposeSelf?: boolean;
  globalAliases?: readonly string[];
  deadlineScheduler?: WptDeadlineScheduler;
  defaultTestName?: string;
}

class WptTest {
  readonly result: WptResult;
  readonly completed: Promise<void>;
  private resolve: () => void;
  private ending = false;
  private finished = false;
  private readonly cleanups: Cleanup[] = [];
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private timeout: (() => void) | undefined;
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
    this.timeout = this.harness.scheduleDeadline(() => {
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
      return this.harness.inTest(this, () => callback.apply(target, args));
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
    this.timeout?.();
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
      this.timeout = this.harness.scheduleDeadline(() => {
        this.harness.cleanupErrors.push(new Error(`WPT cleanup timed out: ${this.result.name}`));
        this.complete();
      }, this.timeoutMilliseconds);
      void Promise.all(pending).then(() => this.complete());
    }
  }

  private complete(): void {
    if (this.finished) return;
    this.finished = true;
    this.timeout?.();
    this.resolve();
  }
}

interface WatchedEvent { readonly type: string; }
interface WatchedTarget {
  addEventListener(type: string, callback: (event: WatchedEvent) => unknown, capture: boolean): void;
  removeEventListener(type: string, callback: (event: WatchedEvent) => unknown, capture: boolean): void;
}
type WatchedResult = WatchedEvent | WatchedEvent[] | null;
interface PendingEvents {
  types: string[];
  resolve(value: WatchedResult): void;
  reject(reason: unknown): void;
}

// resources/testharness.js:956-1072 at the pin above. In particular, an event
// arriving before wait_for(), between waits, or out of order fails immediately.
// Do not defer events to compensate for a provider's missing task checkpoints.
class EventWatcher {
  private waitingFor: PendingEvents | null = null;
  private recordedEvents: WatchedEvent[] | null = null;
  private readonly test: WptTest;
  private readonly timeoutPromise: (() => PromiseLike<unknown>) | undefined;
  readonly stop_watching: () => void;

  constructor(
    test: WptTest,
    watchedNode: WatchedTarget,
    eventTypes: string | string[],
    timeoutPromise?: () => PromiseLike<unknown>,
  ) {
    this.test = test;
    this.timeoutPromise = timeoutPromise;
    const types = typeof eventTypes === "string" ? [eventTypes] : eventTypes;
    const eventHandler = test.step_func((value: unknown) => {
      const event = value as WatchedEvent;
      assert.ok(this.waitingFor, "Not expecting event, but got " + event.type + " event");
      assert.equal(event.type, this.waitingFor.types[0],
        "Expected " + this.waitingFor.types[0] + " event, but got " + event.type + " event instead");
      if (Array.isArray(this.recordedEvents)) this.recordedEvents.push(event);
      if (this.waitingFor.types.length > 1) {
        this.waitingFor.types.shift();
        return;
      }
      const resolve = this.waitingFor.resolve;
      this.waitingFor = null;
      const result = this.recordedEvents || event;
      this.recordedEvents = null;
      resolve(result);
    });
    for (let i = 0; i < types.length; i++) watchedNode.addEventListener(types[i]!, eventHandler, false);
    this.stop_watching = () => {
      for (let i = 0; i < types.length; i++) watchedNode.removeEventListener(types[i]!, eventHandler, false);
    };
    // The adapter has one FIFO cleanup list; upstream's internal _add_cleanup
    // differs from add_cleanup only in harness diagnostic bookkeeping.
    test.add_cleanup(this.stop_watching);
  }

  wait_for(types: string | string[], options?: { record?: unknown }): Promise<WatchedResult> {
    if (this.waitingFor) return Promise.reject("Already waiting for an event or events");
    const expected = typeof types === "string" ? [types] : types;
    if (options && options.record && options.record === "all") this.recordedEvents = [];
    return new Promise((resolve, reject) => {
      const timeout = this.test.step_func(() => {
        if (!this.waitingFor || this.waitingFor.resolve !== resolve) return;
        assert.equal(this.waitingFor.types.length, 0, "Timed out waiting for " + this.waitingFor.types.join(", "));
        const result = this.recordedEvents;
        this.recordedEvents = null;
        const resolveWaiting = this.waitingFor.resolve;
        this.waitingFor = null;
        resolveWaiting(result);
      });
      const timeoutPromise = this.timeoutPromise;
      if (timeoutPromise) timeoutPromise().then(timeout);
      this.waitingFor = { types: expected, resolve, reject };
    });
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
  readonly scheduleDeadline: WptDeadlineScheduler;
  private readonly globalTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly defaultTestName: string | undefined;
  private defaultNameCount = 0;

  constructor(
    globals: Record<string, unknown>,
    blocks: Readonly<Record<string, WptBlock>> = {},
    timeout = 10000,
    options: WptHarnessOptions | readonly string[] = {},
  ) {
    this.blocks = blocks;
    const defaultTestName = "defaultTestName" in options ? options.defaultTestName : undefined;
    assert.ok(defaultTestName === undefined || typeof defaultTestName === "string",
      "WPT defaultTestName must be a string");
    this.defaultTestName = defaultTestName;
    assert.ok(Number.isSafeInteger(timeout) && timeout > 0, "WPT timeout must be positive integer milliseconds");
    this.timeout = timeout;
    this.scheduleDeadline = "deadlineScheduler" in options ? options.deadlineScheduler ?? hostDeadline : hostDeadline;
    assert.equal(typeof this.scheduleDeadline, "function", "WPT deadline scheduler must be a function");
    this.context = createContext({ ...globals });
    const fixtureGlobal = new Script("globalThis").runInContext(this.context) as object;
    // Keep the options-object and alias-list forms used by the two drivers.
    const aliases: readonly string[] = Array.isArray(options) ? options
      : "globalAliases" in options ? options.globalAliases ?? [] : [];
    const exposeSelf = "exposeSelf" in options && options.exposeSelf;
    const globalAliases = exposeSelf && !aliases.includes("self") ? ["self", ...aliases] : aliases;
    const harness = this;
    function stepTimeout(this: unknown, callback: Callback, delay = 0, ...args: unknown[]): ReturnType<typeof setTimeout> {
      assert.equal(typeof callback, "function", "step_timeout requires a callback");
      // Upstream's global helper is non-strict and preserves its call receiver.
      const receiver = this === undefined || this === null ? fixtureGlobal : Object(this);
      const timer = setTimeout(() => {
        harness.globalTimers.delete(timer);
        try { callback.apply(receiver, args); }
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
      // resources/testharness.js at a8f306ee4399724f33399dfdcac7da296f3cc05a:
      // primitive numeric types must match; no string/boxed-number coercion.
      assert_approx_equals: (actual: unknown, expected: number, epsilon: number, message?: string) => {
        assert.equal(typeof actual, "number", message);
        // Pinned testharness.js uses coercing isFinite for the expected value,
        // then exact equality when both operands are non-finite (NaN included).
        if (isFinite(actual as number) || isFinite(expected)) {
          assert.ok(Math.abs((actual as number) - expected) <= epsilon, message);
        } else assert.equal(actual, expected, message);
      },
      assert_greater_than: (actual: unknown, expected: unknown, message?: string) => {
        assert.ok(typeof actual === "number" || typeof actual === "bigint", message);
        assert.equal(typeof actual, typeof expected, message);
        assert.ok(actual > (expected as number | bigint), message);
      },
      assert_less_than: (actual: unknown, expected: unknown, message?: string) => {
        assert.ok(typeof actual === "number" || typeof actual === "bigint", message);
        assert.equal(typeof actual, typeof expected, message);
        assert.ok(actual < (expected as number | bigint), message);
      },
      assert_less_than_equal: (actual: unknown, expected: unknown, message?: string) => {
        assert.ok(typeof actual === "number" || typeof actual === "bigint", message);
        assert.equal(typeof actual, typeof expected, message);
        assert.ok(actual <= (expected as number | bigint), message);
      },
      assert_greater_than_equal: (actual: unknown, expected: unknown, message?: string) => {
        assert.ok(typeof actual === "number" || typeof actual === "bigint", message);
        assert.equal(typeof actual, typeof expected, message);
        assert.ok(actual >= (expected as number | bigint), message);
      },
      assert_regexp_match: (actual: string, expected: RegExp, message?: string) => {
        assert.ok(expected.test(actual), message);
      },
      assert_true: (value: unknown, message?: string) => assert.equal(value, true, message),
      assert_false: (value: unknown, message?: string) => assert.equal(value, false, message),
      assert_class_string: (value: unknown, classString: string, message?: string) => {
        assert.equal(Object.prototype.toString.call(value), "[object " + classString + "]", message);
      },
      format_value: (value: unknown, seen?: unknown[]) =>
        formatValue(value, seen, globals.Node as Record<string, unknown> | undefined),
      EventWatcher,
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
        if (callback !== undefined) this.checkSynchronousResult(callback.apply(undefined, []), "setup callback");
      },
      done: () => this.closeRegistration(),
      step_timeout: stepTimeout,
    });
    // Alias the actual context global, not the host's globals dictionary. This
    // preserves self === globalThis and never exposes Node's competing Web APIs.
    const realmGlobal = new Script("globalThis").runInContext(this.context) as Record<string, unknown>;
    for (const alias of globalAliases) {
      assert.match(alias, /^[A-Za-z_$][\w$]*$/, "invalid WPT global alias");
      assert.ok(!(alias in realmGlobal), `WPT alias would replace an existing global: ${alias}`);
      this.context[alias] = realmGlobal;
    }
  }

  private register(explicitName: string | undefined, kind: TestKind): WptTest {
    assert.equal(this.registrationClosed, false, "test registered after done()");
    assert.equal(this.cleanupErrors.length, 0, "test registered after cleanup failure");
    let name = explicitName;
    if (name === undefined) {
      if (this.defaultTestName === undefined) name = `unnamed test ${this.tests.length + 1}`;
      else {
        name = this.defaultTestName + (this.defaultNameCount === 0 ? "" : " " + this.defaultNameCount);
        this.defaultNameCount++;
      }
    }
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
    const cancelRegistrationTimeout = this.scheduleDeadline(() => {
      this.recordError(new Error("WPT explicit_done setup requires a call to done()"));
      this.closeRegistration();
    }, this.timeout);
    try {
      await this.registrationDone.promise;
      cancelRegistrationTimeout();
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
      cancelRegistrationTimeout();
      for (const timer of this.globalTimers) clearTimeout(timer);
      this.globalTimers.clear();
    }
  }
}
